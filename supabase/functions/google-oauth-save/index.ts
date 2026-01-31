/**
 * Edge Function: google-oauth-save
 * Stores Google OAuth tokens (access + refresh) for a Supabase user.
 *
 * Called from client after OAuth callback with:
 *   Authorization: Bearer <Supabase JWT>
 *   Body: { access_token, refresh_token, expires_at }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Built-in Supabase env vars (auto-injected, always available)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  // Extract JWT from Authorization header
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!jwt) {
    console.error("[google-oauth-save] No JWT in Authorization header");
    return jsonResponse(401, { ok: false, error: "Missing Authorization Bearer token" });
  }

  console.log("[google-oauth-save] Validating JWT...");

  // Create admin client with service role (bypasses RLS)
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Validate JWT and extract user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);

  if (userErr || !userData?.user) {
    console.error("[google-oauth-save] JWT validation failed:", userErr?.message ?? "No user");
    return jsonResponse(401, {
      ok: false,
      error: "Invalid JWT",
      details: userErr?.message ?? "Could not get user from token",
    });
  }

  const userId = userData.user.id;
  console.log("[google-oauth-save] User verified:", userId);

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const access_token = body.access_token as string | undefined;
  const refresh_token = body.refresh_token as string | undefined;
  const expires_at = body.expires_at as string | undefined;

  if (!access_token || !refresh_token || !expires_at) {
    console.error("[google-oauth-save] Missing required fields");
    return jsonResponse(400, {
      ok: false,
      error: "Missing required fields: access_token, refresh_token, expires_at",
    });
  }

  // Upsert into google_accounts
  const { error: upsertErr } = await supabaseAdmin
    .from("google_accounts")
    .upsert(
      {
        user_id: userId,
        access_token,
        refresh_token,
        expires_at,
      },
      { onConflict: "user_id" }
    );

  if (upsertErr) {
    console.error("[google-oauth-save] DB upsert failed:", upsertErr.message);
    return jsonResponse(500, {
      ok: false,
      error: "Database error",
      details: upsertErr.message,
    });
  }

  console.log("[google-oauth-save] Tokens saved for user:", userId);
  return jsonResponse(200, { ok: true, userId, saved: true });
});
