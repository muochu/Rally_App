import { handleAuthCallback, isAuthCallbackUrl } from '@/lib/auth-callback';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

export type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  googleCalendarConnected: boolean;
  googleCalendarLoading: boolean;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(false);

  // Check if user has Google Calendar connected
  const checkGoogleCalendarConnection = useCallback(async (userId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('google_accounts')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[GCAL] Check failed:', error.message);
        return false;
      }

      return !!data;
    } catch (e) {
      console.warn('[GCAL] Check error:', e);
      return false;
    }
  }, []);

  // Refresh Google Calendar status manually
  const refreshGoogleCalendarStatus = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;

    setGoogleCalendarLoading(true);
    try {
      const isConnected = await checkGoogleCalendarConnection(userId);
      setGoogleCalendarConnected(isConnected);
    } catch (e) {
      console.warn('[GCAL] Refresh error:', e);
    } finally {
      setGoogleCalendarLoading(false);
    }
  }, [user?.id, checkGoogleCalendarConnection]);

  // Disconnect Google Calendar
  const disconnectGoogleCalendar = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;

    try {
      await supabase.from('google_accounts').delete().eq('user_id', userId);
      await supabase.from('busy_blocks').delete().eq('user_id', userId).eq('source', 'google');
      setGoogleCalendarConnected(false);
    } catch (e) {
      console.warn('[GCAL] Disconnect error:', e);
    }
  }, [user?.id]);

  // EFFECT 1: Auth session management
  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      if (!isMounted) return;
      console.log('[Auth] Initial session:', sess ? 'authenticated' : 'none');
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!isMounted) return;
      console.log('[Auth] State changed:', _event);
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // EFFECT 2: Check Google Calendar connection after user changes
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setGoogleCalendarConnected(false);
      setGoogleCalendarLoading(false);
      return;
    }

    let isMounted = true;

    const check = async () => {
      setGoogleCalendarLoading(true);
      try {
        const isConnected = await checkGoogleCalendarConnection(userId);
        if (isMounted) {
          setGoogleCalendarConnected(isConnected);
        }
      } catch {
        if (isMounted) {
          setGoogleCalendarConnected(false);
        }
      } finally {
        if (isMounted) setGoogleCalendarLoading(false);
      }
    };

    check();
    return () => { isMounted = false; };
  }, [user?.id, checkGoogleCalendarConnection]);

  // EFFECT 3: Handle OAuth deep links
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      const { url } = event;
      if (isAuthCallbackUrl(url)) {
        console.log('[Auth] Handling callback URL...');
        const result = await handleAuthCallback(url);
        if (result.success) {
          // Refresh Google Calendar status after successful OAuth
          setTimeout(() => refreshGoogleCalendarStatus(), 500);
        } else {
          console.error('[Auth] Callback failed:', result.error);
        }
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url && isAuthCallbackUrl(url)) handleUrl({ url });
    });

    const subscription = Linking.addEventListener('url', handleUrl);
    return () => subscription.remove();
  }, [refreshGoogleCalendarStatus]);

  const signOut = useCallback(async () => {
    setGoogleCalendarConnected(false);
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    session,
    loading,
    googleCalendarConnected,
    googleCalendarLoading,
    signOut,
    isAuthenticated: !!user,
    refreshGoogleCalendarStatus,
    disconnectGoogleCalendar,
  };
}
