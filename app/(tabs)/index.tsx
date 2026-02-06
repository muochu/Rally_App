import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { availabilityApi, busyBlocksApi, SUPABASE_URL, SUPABASE_ANON_KEY, proposalsApi, matchAttendanceApi } from '@/lib/supabase';
import { SettingsModal } from '@/components/settings-modal';
import { syncCalendarEvents, getCalendarPermissionStatus } from '@/lib/calendar';
import type { AvailabilityWindow, Proposal } from '@/lib/types';
import { MatchAttendanceModal } from '@/components/match-attendance-modal';
import { WeekRings } from '@/components/week-rings';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const { user, session, googleCalendarConnected } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [showSettings, setShowSettings] = useState(false);
  const [appleCalendarSynced, setAppleCalendarSynced] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [ongoingMatches, setOngoingMatches] = useState<Proposal[]>([]);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [currentMatchProposal, setCurrentMatchProposal] = useState<Proposal | null>(null);
  const [attendanceChecked, setAttendanceChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    checkAppleCalendar();
  }, []);

  // Check for ongoing matches and match-time notifications
  useEffect(() => {
    if (!userId) return;

    const checkMatches = async () => {
      try {
        // Get ongoing matches
        const ongoing = await proposalsApi.listOngoing(userId);
        setOngoingMatches(ongoing);

        // Check for matches starting now (within 1 minute of start time)
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

        for (const match of ongoing) {
          const matchStart = new Date(match.start_ts_utc);
          const matchId = match.id;

          // Show notification if match started within the last minute and we haven't checked it yet
          if (
            matchStart >= oneMinuteAgo &&
            matchStart <= oneMinuteFromNow &&
            !attendanceChecked.has(matchId)
          ) {
            // Check if user already confirmed attendance
            const hasConfirmed = await matchAttendanceApi.hasConfirmed(matchId, userId);
            if (!hasConfirmed) {
              setCurrentMatchProposal(match);
              setShowAttendanceModal(true);
              setAttendanceChecked(prev => new Set(prev).add(matchId));
            }
          }
        }
      } catch (err) {
        console.error('Failed to check matches:', err);
      }
    };

    // Check immediately
    checkMatches();

    // Check every 30 seconds for match start times
    const interval = setInterval(checkMatches, 30000);
    return () => clearInterval(interval);
  }, [userId, attendanceChecked]);

  const loadAvailability = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await availabilityApi.list(userId);
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const filtered = data.filter((a) => {
        const end = new Date(a.end_ts_utc);
        const start = new Date(a.start_ts_utc);
        return end > now && start < sevenDaysLater;
      }).sort((a, b) => new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime());
      setAvailability(filtered);
    } catch (e) {
      console.warn('Failed to load availability:', e);
    }
  }, [userId]);

  // Auto-sync calendars and load availability on focus
  useFocusEffect(
    useCallback(() => {
      loadAvailability();

      // Auto-sync calendars in background (best practice: on app focus)
      const autoSync = async () => {
        if (googleCalendarConnected && session?.access_token) {
          try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/google-calendar-sync`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ action: 'sync', horizonDays: 7 }),
            });
            if (res.ok) {
              console.log('[AutoSync] Google calendar synced');
            }
          } catch (e) {
            console.warn('[AutoSync] Google sync failed:', e);
          }
        }

        if (appleCalendarSynced && userId) {
          try {
            const blocks = await syncCalendarEvents();
            await busyBlocksApi.upsertFromCalendar(userId, blocks);
            console.log('[AutoSync] Apple calendar synced');
          } catch (e) {
            console.warn('[AutoSync] Apple sync failed:', e);
          }
        }
      };

      autoSync();
    }, [loadAvailability, googleCalendarConnected, appleCalendarSynced, userId, session?.access_token])
  );

  const checkAppleCalendar = async () => {
    const status = await getCalendarPermissionStatus();
    setAppleCalendarSynced(status === 'granted');
  };

  const handleConfirmAttendance = async () => {
    if (!currentMatchProposal || !userId) return;
    
    try {
      await matchAttendanceApi.confirmAttendance(currentMatchProposal.id, userId);
      setShowAttendanceModal(false);
      // Refresh ongoing matches
      const ongoing = await proposalsApi.listOngoing(userId);
      setOngoingMatches(ongoing);
    } catch (err: any) {
      console.error('Failed to confirm attendance:', err);
      const errorMessage = err?.message || 'Failed to confirm attendance. Please try again.';
      Alert.alert('Error', errorMessage);
    }
  };

  const handleDismissAttendance = () => {
    setShowAttendanceModal(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.main}>
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Text style={[styles.logo, { color: colors.text }]}>RALLY</Text>
          </View>

          {/* Ongoing Match Section */}
          {ongoingMatches.length > 0 && (
            <View style={[styles.ongoingMatchCard, { backgroundColor: '#4caf50' }]}>
              <Text style={styles.ongoingMatchTitle}>🎾 Match in Progress</Text>
              {ongoingMatches.map((match) => {
                const opponent = match.to_user_id === userId
                  ? match.from_user
                  : match.to_user;
                const opponentName = opponent?.display_name || opponent?.email?.split('@')[0] || 'Opponent';
                const courtName = match.court?.name || 'Court';
                const startTime = new Date(match.start_ts_utc);
                const endTime = new Date(match.end_ts_utc);
                const now = new Date();
                const elapsed = Math.round((now.getTime() - startTime.getTime()) / (1000 * 60));
                const remaining = Math.round((endTime.getTime() - now.getTime()) / (1000 * 60));

                return (
                  <TouchableOpacity
                    key={match.id}
                    style={styles.ongoingMatchContent}
                    onPress={() => {
                      router.push(`/booking/${match.id}?isProposalId=true`);
                    }}
                  >
                    <Text style={styles.ongoingMatchText}>
                      vs {opponentName} at {courtName}
                    </Text>
                    <Text style={styles.ongoingMatchTime}>
                      {elapsed} min elapsed • {remaining} min remaining
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Week/Month Availability View */}
          <WeekRings availability={availability} showMonthToggle />
        </View>
      </ScrollView>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
      <MatchAttendanceModal
        visible={showAttendanceModal}
        proposal={currentMatchProposal}
        onConfirm={handleConfirmAttendance}
        onDismiss={handleDismissAttendance}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: { fontSize: 18 },

  // Main content
  main: { flex: 1, paddingHorizontal: 24 },
  logoContainer: { alignItems: 'center', marginTop: 8, marginBottom: 40 },
  logo: { fontSize: 42, fontWeight: '900', letterSpacing: 6 },

  // Ongoing Match Card
  ongoingMatchCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  ongoingMatchTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  ongoingMatchContent: {
    paddingVertical: 8,
  },
  ongoingMatchText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  ongoingMatchTime: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
  },
});
