import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { handleAuthCallback } from '@/lib/auth-callback';
import { authApi, supabase } from '@/lib/supabase';

/**
 * Login Screen with Magic Link and Google SSO
 *
 * Google SSO Flow (Supabase-native):
 * 1. User taps "Continue with Google"
 * 2. We call supabase.auth.signInWithOAuth({ provider: 'google' })
 * 3. Supabase returns a URL to their OAuth endpoint
 * 4. We open it with WebBrowser.openAuthSessionAsync()
 * 5. User signs in with Google
 * 6. Google redirects to Supabase: https://<PROJECT_REF>.supabase.co/auth/v1/callback
 * 7. Supabase redirects to our app: rallyapp://auth/callback#access_token=...
 * 8. openAuthSessionAsync returns the URL, we parse tokens and set session
 * 9. useAuth hook detects session change and updates app state
 *
 * Required Configuration:
 * - Google Cloud Console: Add authorized redirect URI:
 *   https://<PROJECT_REF>.supabase.co/auth/v1/callback
 * - Supabase Dashboard (Authentication > URL Configuration):
 *   Add allowed redirect URL: rallyapp://auth/callback
 */

// App deep link scheme for OAuth callback
const REDIRECT_URL = 'rallyapp://auth/callback';

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGooglePress = async () => {
    setError(null);
    setGoogleLoading(true);

    try {
      // Start Supabase OAuth flow
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_URL,
          skipBrowserRedirect: true,
          scopes: 'https://www.googleapis.com/auth/calendar.readonly',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthError) {
        throw oauthError;
      }

      if (!data?.url) {
        throw new Error('No OAuth URL returned from Supabase');
      }

      console.log('[Login] Opening OAuth URL...');

      // Open the OAuth URL in a browser session
      // This will return when the browser redirects back to our app
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        REDIRECT_URL
      );

      console.log('[Login] WebBrowser result type:', result.type);

      if (result.type === 'success' && result.url) {
        // Browser returned with a URL - parse and set session
        console.log('[Login] Processing callback URL...');
        const callbackResult = await handleAuthCallback(result.url);

        if (!callbackResult.success) {
          setError(callbackResult.error || 'Sign-in failed. Please try again.');
        }
        // Success: useAuth hook will detect the session change
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // User cancelled the flow
        console.log('[Login] User cancelled OAuth flow');
      } else {
        // Unexpected result type
        console.log('[Login] Unexpected result:', result);
      }
    } catch (err) {
      console.error('[Login] Google sign-in error:', err);
      const message = err instanceof Error ? err.message : 'Failed to sign in with Google.';
      setError(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSendMagicLink = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setError(null);
      setLoading(true);
      await authApi.signInWithMagicLink(trimmedEmail);
      setSent(true);
    } catch (err) {
      console.error('[Login] Magic link error:', err);
      const message = err instanceof Error ? err.message : 'Failed to send magic link.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  if (sent) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>Check Your Email</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>
            We sent a magic link to {email}
          </Text>
          <Text style={[styles.hint, { color: colors.icon }]}>
            Tap the link in the email to sign in.
          </Text>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => {
              setSent(false);
              setEmail('');
              setError(null);
            }}
          >
            <Text style={[styles.resetText, { color: colors.tint }]}>
              Use a different email
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <Text style={[styles.logo, { color: colors.tint }]}>Rally</Text>
        <Text style={[styles.title, { color: colors.text }]}>Sign In</Text>
        <Text style={[styles.subtitle, { color: colors.icon }]}>
          Continue with Google or use a magic link
        </Text>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={clearError}>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Google Sign In Button */}
        <TouchableOpacity
          style={[
            styles.googleButton,
            { backgroundColor: '#fff' },
            googleLoading && styles.buttonDisabled,
          ]}
          onPress={handleGooglePress}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <ActivityIndicator size="small" color="#4285F4" />
          ) : (
            <>
              <GoogleIcon />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.icon }]} />
          <Text style={[styles.dividerText, { color: colors.icon }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.icon }]} />
        </View>

        {/* Email Input */}
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colorScheme === 'dark' ? '#222' : '#f5f5f5',
              color: colors.text,
              borderColor: colors.icon,
            },
          ]}
          placeholder="Email address"
          placeholderTextColor={colors.icon}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (error) clearError();
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          editable={!loading}
        />

        {/* Magic Link Button */}
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.tint },
            loading && styles.buttonDisabled,
          ]}
          onPress={handleSendMagicLink}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Magic Link</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Simple Google "G" icon component
function GoogleIcon() {
  return (
    <View style={styles.googleIcon}>
      <Text style={styles.googleIconText}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  hint: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 22,
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  errorDismiss: {
    color: '#c62828',
    fontSize: 14,
    fontWeight: '600',
  },
  googleButton: {
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dadce0',
    marginBottom: 16,
  },
  googleButtonText: {
    color: '#3c4043',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
  },
  googleIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  input: {
    height: 52,
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: {
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resetButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  resetText: {
    fontSize: 16,
  },
});
