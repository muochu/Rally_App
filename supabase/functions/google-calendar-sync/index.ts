/**
 * Edge Function: google-calendar-sync
 * Syncs Google Calendar busy times into busy_blocks table.
 *
 * Actions:
 *   - sync: Fetches FreeBusy from Google Calendar and upserts into busy_blocks
 *
 * Requires stored refresh_token in google_accounts table.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Built-in Supabase env vars
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Google OAuth credentials (set these in Supabase Dashboard > Edge Functions > Secrets)
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserFromJwt(jwt: string, supabaseAdmin: ReturnType<typeof createClient>) {
  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user) {
    return { error: error?.message ?? "Invalid token" };
  }
  return { userId: data.user.id };
}

async function refreshGoogleAccessToken(refreshToken: string) {
  console.log("[google-calendar-sync] GOOGLE_CLIENT_ID set:", !!GOOGLE_CLIENT_ID);
  console.log("[google-calendar-sync] GOOGLE_CLIENT_SECRET set:", !!GOOGLE_CLIENT_SECRET);

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { error: "Google OAuth credentials not configured" };
  }

  const form = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await res.json();
  console.log("[google-calendar-sync] Token refresh response:", res.status, res.ok ? "ok" : JSON.stringify(data));

  if (!res.ok) {
    return { error: data?.error_description ?? data?.error ?? "Token refresh failed" };
  }

  return { accessToken: data.access_token as string, expiresIn: data.expires_in as number };
}

async function fetchGoogleFreeBusy(accessToken: string, timeMin: string, timeMax: string) {
  console.log("[google-calendar-sync] FreeBusy request:", { timeMin, timeMax });

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: "primary" }],
    }),
  });

  const data = await res.json();
  console.log("[google-calendar-sync] FreeBusy raw response:", JSON.stringify(data));

  if (!res.ok) {
    return { error: data?.error?.message ?? "FreeBusy API error" };
  }

  const busy: Array<{ start: string; end: string }> = data?.calendars?.primary?.busy ?? [];
  return { busy };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  // Extract JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!jwt) {
    return jsonResponse(401, { ok: false, error: "Missing Authorization Bearer token" });
  }

  // Parse body
  let body: { action?: string; horizonDays?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Verify user
  const userResult = await getUserFromJwt(jwt, supabaseAdmin);
  if ("error" in userResult) {
    console.error("[google-calendar-sync] JWT error:", userResult.error);
    return jsonResponse(401, { ok: false, error: userResult.error });
  }

  const userId = userResult.userId;
  console.log("[google-calendar-sync] User:", userId, "Action:", body.action);

  // Only support "sync" action
  if (body.action !== "sync") {
    return jsonResponse(400, { ok: false, error: "Unknown action. Use { action: 'sync' }" });
  }

  const horizonDays = body.horizonDays ?? 14;

  // Get stored refresh token
  const { data: acct, error: acctErr } = await supabaseAdmin
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (acctErr) {
    console.error("[google-calendar-sync] DB error:", acctErr.message);
    return jsonResponse(500, { ok: false, error: acctErr.message });
  }

  if (!acct?.refresh_token) {
    return jsonResponse(400, { ok: false, error: "Google Calendar not connected. Please connect first." });
  }

  // Refresh access token
  const tokenResult = await refreshGoogleAccessToken(acct.refresh_token);
  if ("error" in tokenResult) {
    console.error("[google-calendar-sync] Token refresh failed:", tokenResult.error);
    return jsonResponse(400, { ok: false, error: tokenResult.error });
  }

  const accessToken = tokenResult.accessToken;

  // Fetch busy times
  const now = new Date();
  const end = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const timeMin = now.toISOString();
  const timeMax = end.toISOString();

  const busyResult = await fetchGoogleFreeBusy(accessToken, timeMin, timeMax);
  if ("error" in busyResult) {
    console.error("[google-calendar-sync] FreeBusy error:", busyResult.error);
    return jsonResponse(400, { ok: false, error: busyResult.error });
  }

  const busy = busyResult.busy;
  console.log("[google-calendar-sync] Got", busy.length, "busy blocks from Google");

  // Delete existing google blocks in range
  await supabaseAdmin
    .from("busy_blocks")
    .delete()
    .eq("user_id", userId)
    .eq("source", "google")
    .gte("start_ts_utc", timeMin)
    .lte("end_ts_utc", timeMax);

  // Insert new blocks
  if (busy.length > 0) {
    const rows = busy.map((b) => ({
      user_id: userId,
      start_ts_utc: b.start,
      end_ts_utc: b.end,
      source: "google",
    }));

    const { error: insErr } = await supabaseAdmin.from("busy_blocks").insert(rows);
    if (insErr) {
      console.error("[google-calendar-sync] Insert error:", insErr.message);
      return jsonResponse(500, { ok: false, error: insErr.message });
    }
  }

  console.log("[google-calendar-sync] Synced", busy.length, "blocks for user", userId);
  return jsonResponse(200, { ok: true, synced: busy.length });
});
