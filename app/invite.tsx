import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { inviteTokensApi, contactsApi } from '@/lib/supabase';

type RedeemState = 'loading' | 'needs_auth' | 'redeeming' | 'success' | 'error';

export default function InviteScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [state, setState] = useState<RedeemState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      setState('loading');
      return;
    }

    if (!isAuthenticated) {
      setState('needs_auth');
      return;
    }

    if (!token) {
      setState('error');
      setErrorMessage('No invite token provided');
      return;
    }

    // Auto-redeem when authenticated
    redeemInvite();
  }, [authLoading, isAuthenticated, token]);

  const redeemInvite = async () => {
    if (!token || !user?.id) return;

    setState('redeeming');
    setErrorMessage(null);

    try {
      // Validate token first
      const tokenData = await inviteTokensApi.validate(token);
      if (!tokenData) {
        setState('error');
        setErrorMessage('This invite link is invalid or has expired.');
        return;
      }

      // Check if user is trying to use their own invite
      if (tokenData.inviter_id === user.id) {
        setState('error');
        setErrorMessage("You can't use your own invite link.");
        return;
      }

      // Use the token (marks it as used and returns inviter ID)
      const inviterId = await inviteTokensApi.use(token);

      // Create friend request from inviter to redeemer
      // This makes them instantly connected (pending request that can be accepted)
      try {
        await contactsApi.sendRequest(inviterId, user.id);
      } catch (contactErr: any) {
        // Ignore duplicate errors - they may already be friends
        if (contactErr?.code !== '23505') {
          console.warn('[Invite] Contact creation warning:', contactErr);
        }
      }

      setState('success');
      setInviterName('your friend'); // Could fetch profile name here
    } catch (e: any) {
      console.error('[Invite] Redeem failed:', e);
      setState('error');

      if (e?.message?.includes('already used')) {
        setErrorMessage('This invite link has already been used.');
      } else if (e?.message?.includes('expired')) {
        setErrorMessage('This invite link has expired.');
      } else if (e?.message?.includes('Invalid')) {
        setErrorMessage('This invite link is invalid.');
      } else {
        setErrorMessage('Failed to redeem invite. Please try again.');
      }
    }
  };

  const handleGoToLogin = () => {
    router.replace('/(auth)/login');
  };

  const handleGoToContacts = () => {
    router.replace('/(tabs)/contacts');
  };

  const handleGoHome = () => {
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Loading State */}
        {(state === 'loading' || state === 'redeeming') && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.statusText, { color: colors.icon }]}>
              {state === 'loading' ? 'Loading...' : 'Joining Rally...'}
            </Text>
          </View>
        )}

        {/* Needs Auth State */}
        {state === 'needs_auth' && (
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emoji}>🎾</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              You've been invited to Rally!
            </Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              Sign in or create an account to connect with your friend.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.tint }]}
              onPress={handleGoToLogin}
            >
              <Text style={styles.primaryBtnText}>Sign In to Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Success State */}
        {state === 'success' && (
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emoji}>🎉</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              You're connected!
            </Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              You've been added as a friend. Check your pending requests to confirm.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.tint }]}
              onPress={handleGoToContacts}
            >
              <Text style={styles.primaryBtnText}>View Contacts</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleGoHome}>
              <Text style={[styles.secondaryBtnText, { color: colors.tint }]}>
                Go to Home
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error State */}
        {state === 'error' && (
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emoji}>😕</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Couldn't use invite
            </Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              {errorMessage || 'Something went wrong. Please try again.'}
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.tint }]}
              onPress={handleGoHome}
            >
              <Text style={styles.primaryBtnText}>Go to Home</Text>
            </TouchableOpacity>
            {token && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={redeemInvite}>
                <Text style={[styles.secondaryBtnText, { color: colors.tint }]}>
                  Try Again
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  centered: {
    alignItems: 'center',
    gap: 16,
  },
  statusText: {
    fontSize: 16,
    marginTop: 8,
  },
  card: {
    padding: 32,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
