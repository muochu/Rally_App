import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { CourtSelectionProvider } from '@/hooks/use-court-selection';
import { Colors } from '@/constants/theme';
import { ProfileSetupModal } from '@/components/profile-setup-modal';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, profileLoading, isProfileComplete, updateProfile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isInviteRoute = segments[0] === 'invite';

    // Allow invite route without auth - it handles its own auth state
    if (isInviteRoute) return;

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to main app
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, loading, segments]);

  // Handle profile setup completion
  const handleProfileComplete = async (displayName: string, discoverable: boolean) => {
    await updateProfile({ display_name: displayName, discoverable });
  };

  if (loading || (isAuthenticated && profileLoading)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors[colorScheme].background }}>
        <ActivityIndicator size="large" color={Colors[colorScheme].tint} />
      </View>
    );
  }

  // Show profile setup modal if authenticated but profile incomplete
  const showProfileSetup = isAuthenticated && !isProfileComplete;

  return (
    <>
      {children}
      <ProfileSetupModal
        visible={showProfileSetup}
        onComplete={handleProfileComplete}
      />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <CourtSelectionProvider>
        <AuthGate>
          <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="invite" options={{ headerShown: false }} />
            <Stack.Screen name="friend/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="booking/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        </AuthGate>
        <StatusBar style="auto" />
      </CourtSelectionProvider>
    </ThemeProvider>
  );
}
