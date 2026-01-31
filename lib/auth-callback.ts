/**
 * Auth Callback Handler for Supabase OAuth
 */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

export type AuthCallbackResult = {
  success: boolean;
  error?: string;
};

type ParsedCallback = {
  accessToken?: string;
  refreshToken?: string;
  providerToken?: string;
  providerRefreshToken?: string;
  expiresIn?: number;
  error?: string;
  errorDescription?: string;
};

function parseCallbackUrl(url: string): ParsedCallback {
  try {
    const urlObj = new URL(url);
    const hash = urlObj.hash?.startsWith('#') ? urlObj.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hash);
    const queryParams = urlObj.searchParams;

    const get = (key: string) => hashParams.get(key) || queryParams.get(key) || undefined;

    const parsed: ParsedCallback = {
      accessToken: get('access_token'),
      refreshToken: get('refresh_token'),
      providerToken: get('provider_token'),
      providerRefreshToken: get('provider_refresh_token'),
      expiresIn: get('expires_in') ? parseInt(get('expires_in')!, 10) : undefined,
      error: get('error'),
      errorDescription: get('error_description'),
    };

    console.log('[Auth] Parsed callback:', {
      hasAccessToken: !!parsed.accessToken,
      hasRefreshToken: !!parsed.refreshToken,
      hasProviderToken: !!parsed.providerToken,
      hasProviderRefresh: !!parsed.providerRefreshToken,
    });

    return parsed;
  } catch (err) {
    console.error('[Auth] Parse error:', err);
    return { error: 'invalid_url' };
  }
}

export async function handleAuthCallback(url: string): Promise<AuthCallbackResult> {
  console.log('[Auth] Processing callback...');

  if (!url.includes('auth/callback')) {
    return { success: false, error: 'Not an auth callback URL' };
  }

  const parsed = parseCallbackUrl(url);

  if (parsed.error) {
    return { success: false, error: parsed.errorDescription || parsed.error };
  }

  if (!parsed.accessToken || !parsed.refreshToken) {
    return { success: false, error: 'Missing tokens in callback' };
  }

  // Set Supabase session
  const { data, error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });

  if (error || !data.session) {
    console.error('[Auth] setSession failed:', error?.message);
    return { success: false, error: error?.message || 'Failed to set session' };
  }

  const supabaseJwt = data.session.access_token;
  console.log('[Auth] Session set for:', data.session.user?.email);
  console.log('[Auth] JWT (first 20 chars):', supabaseJwt?.substring(0, 20));
  console.log('[Auth] SUPABASE_URL:', SUPABASE_URL);
  console.log('[Auth] ANON_KEY (first 20 chars):', SUPABASE_ANON_KEY?.substring(0, 20));

  // Store Google provider tokens if present
  if (parsed.providerToken && parsed.providerRefreshToken) {
    console.log('[Auth] Saving Google tokens...');

    const expiresAt = new Date(Date.now() + (parsed.expiresIn ?? 3600) * 1000).toISOString();

    try {
      // Use fetch with explicit headers since supabase client auth state may not be ready
      const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth-save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${supabaseJwt}`,
        },
        body: JSON.stringify({
          access_token: parsed.providerToken,
          refresh_token: parsed.providerRefreshToken,
          expires_at: expiresAt,
        }),
      });

      const text = await res.text();
      console.log('[Auth] google-oauth-save response:', res.status, text);

      if (!res.ok) {
        console.warn('[Auth] google-oauth-save failed:', res.status);
      } else {
        console.log('[Auth] Google tokens saved successfully');
      }
    } catch (e) {
      console.warn('[Auth] google-oauth-save error:', e);
    }
  }

  return { success: true };
}

export function isAuthCallbackUrl(url: string): boolean {
  return url.includes('auth/callback') && (url.includes('access_token') || url.includes('error'));
}
