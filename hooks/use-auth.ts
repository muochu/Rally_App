import { handleAuthCallback, isAuthCallbackUrl } from '@/lib/auth-callback';
import { supabase, profilesApi } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import type { Profile } from '@/lib/types';

export type AuthState = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  googleCalendarConnected: boolean;
  googleCalendarLoading: boolean;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
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
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!isMounted) return;
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

  // EFFECT 3: Load/ensure profile exists after authentication
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let isMounted = true;

    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        // First try to get existing profile
        let userProfile = await profilesApi.get(userId);

        // If no profile, try to ensure one exists (calls RPC)
        if (!userProfile) {
          try {
            userProfile = await profilesApi.ensureExists();
          } catch {
            // RPC might not be deployed yet, profile may come from DB trigger
            userProfile = await profilesApi.get(userId);
          }
        }

        if (isMounted) {
          setProfile(userProfile);
        }
      } catch {
        if (isMounted) {
          setProfile(null);
        }
      } finally {
        if (isMounted) setProfileLoading(false);
      }
    };

    loadProfile();
    return () => { isMounted = false; };
  }, [user?.id]);

  // EFFECT 4: Handle OAuth deep links
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      const { url } = event;
      if (isAuthCallbackUrl(url)) {
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
    setProfile(null);
    await supabase.auth.signOut();
  }, []);

  // Update profile in state after saving changes
  const updateProfile = useCallback(async (updates: Partial<Pick<Profile, 'display_name' | 'discoverable'>>) => {
    if (!user?.id) throw new Error('Not authenticated');
    await profilesApi.update(user.id, updates);
    // Refresh profile state
    const updated = await profilesApi.get(user.id);
    setProfile(updated);
  }, [user?.id]);

  // Check if profile setup is complete (has display_name)
  const isProfileComplete = Boolean(profile?.display_name?.trim());

  return {
    user,
    session,
    profile,
    loading,
    profileLoading,
    googleCalendarConnected,
    googleCalendarLoading,
    signOut,
    updateProfile,
    isAuthenticated: !!user,
    isProfileComplete,
    refreshGoogleCalendarStatus,
    disconnectGoogleCalendar,
  };
}
