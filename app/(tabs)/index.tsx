import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { availabilityApi, busyBlocksApi, supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { handleAuthCallback } from '@/lib/auth-callback';
import { SettingsModal } from '@/components/settings-modal';
import {
  requestCalendarPermission,
  syncCalendarEvents,
  getCalendarPermissionStatus,
} from '@/lib/calendar';
import type { AvailabilityWindow } from '@/lib/types';

type WhenOption = 'later' | 'weekdays' | 'weekends';
type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening';

type SyncFeedback = {
  type: 'success' | 'error';
  message: string;
  source: 'google' | 'apple';
} | null;

const TIME_RANGES: Record<TimeOfDay, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 10, label: 'Morning (6a-10a)' },
  noon: { start: 10, end: 13, label: 'Noon (10a-1p)' },
  afternoon: { start: 13, end: 17, label: 'Afternoon (1p-5p)' },
  evening: { start: 17, end: 21, label: 'Evening (5p-9p)' },
};

const getAvailableTimeOptions = (when: WhenOption): TimeOfDay[] => {
  if (when !== 'later') {
    return ['morning', 'noon', 'afternoon', 'evening'];
  }
  const now = new Date();
  const currentHour = now.getHours();
  const available: TimeOfDay[] = [];
  if (currentHour < 10) available.push('morning');
  if (currentHour < 13) available.push('noon');
  if (currentHour < 17) available.push('afternoon');
  if (currentHour < 21) available.push('evening');
  return available;
};

const REDIRECT_URL = 'rallyapp://auth/callback';
const PREVIEW_SLOTS = 3;

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const {
    user,
    session,
    googleCalendarConnected,
    refreshGoogleCalendarStatus,
  } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [showSchedule, setShowSchedule] = useState(false);
  const [showCalendars, setShowCalendars] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedWhen, setSelectedWhen] = useState<WhenOption[]>(['later']);
  const [selectedTimes, setSelectedTimes] = useState<TimeOfDay[]>(['evening']);
  const [saving, setSaving] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [syncingApple, setSyncingApple] = useState(false);
  const [appleCalendarSynced, setAppleCalendarSynced] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null);
  const [appleLastSync, setAppleLastSync] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback>(null);
  const [feedbackOpacity] = useState(new Animated.Value(0));

  useEffect(() => {
    checkAppleCalendar();
  }, []);

  // Show feedback banner with auto-dismiss
  const showFeedback = useCallback((feedback: SyncFeedback) => {
    setSyncFeedback(feedback);
    Animated.sequence([
      Animated.timing(feedbackOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(feedbackOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setSyncFeedback(null));
  }, [feedbackOpacity]);

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

  useFocusEffect(
    useCallback(() => {
      loadAvailability();
    }, [loadAvailability])
  );

  const checkAppleCalendar = async () => {
    const status = await getCalendarPermissionStatus();
    setAppleCalendarSynced(status === 'granted');
  };

  const formatSyncTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const syncGoogleCalendar = async () => {
    if (!session?.access_token || syncingGoogle) return;
    setSyncingGoogle(true);
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
      const data = await res.json();
      if (res.ok && data.synced !== undefined) {
        setGoogleLastSync(formatSyncTime(new Date()));
        showFeedback({
          type: 'success',
          message: `Google Calendar synced${data.synced > 0 ? ` • ${data.synced} busy blocks` : ''}`,
          source: 'google',
        });
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (e: any) {
      console.warn('[Sync] Google failed:', e);
      showFeedback({
        type: 'error',
        message: 'Google sync failed',
        source: 'google',
      });
    } finally {
      setSyncingGoogle(false);
    }
  };

  const syncAppleCalendar = async () => {
    if (!userId || syncingApple) return;
    setSyncingApple(true);
    try {
      let permission = await getCalendarPermissionStatus();
      if (permission !== 'granted') {
        permission = await requestCalendarPermission();
        if (permission !== 'granted') {
          Alert.alert('Permission Required', 'Calendar access is needed.');
          setSyncingApple(false);
          return;
        }
      }
      const blocks = await syncCalendarEvents();
      await busyBlocksApi.upsertFromCalendar(userId, blocks);
      setAppleCalendarSynced(true);
      setAppleLastSync(formatSyncTime(new Date()));
      showFeedback({
        type: 'success',
        message: `iCloud synced${blocks.length > 0 ? ` • ${blocks.length} busy blocks` : ''}`,
        source: 'apple',
      });
    } catch (e) {
      console.warn('[Sync] Apple failed:', e);
      showFeedback({
        type: 'error',
        message: 'iCloud sync failed',
        source: 'apple',
      });
    } finally {
      setSyncingApple(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      setSaving(true);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_URL,
          skipBrowserRedirect: true,
          scopes: 'openid email https://www.googleapis.com/auth/calendar.readonly',
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error || !data?.url) throw error;
      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
      if (result.type === 'success' && result.url) {
        await handleAuthCallback(result.url);
        setTimeout(() => {
          refreshGoogleCalendarStatus();
          syncGoogleCalendar();
        }, 1000);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!userId || selectedWhen.length === 0 || selectedTimes.length === 0) return;
    setSaving(true);
    try {
      const slots = getSlots(selectedWhen, selectedTimes);
      let added = 0;
      for (const slot of slots) {
        const result = await availabilityApi.create({
          user_id: userId,
          start_ts_utc: slot.start.toISOString(),
          end_ts_utc: slot.end.toISOString(),
        });
        if (result) added++;
      }
      if (added > 0) {
        Alert.alert('Scheduled!', `${added} new time slot${added !== 1 ? 's' : ''} added.`);
        loadAvailability();
      } else {
        Alert.alert('No changes', 'All selected times were already in your availability.');
      }
      setShowSchedule(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to schedule');
    } finally {
      setSaving(false);
    }
  };

  const getSlots = (whenOptions: WhenOption[], timeOptions: TimeOfDay[]) => {
    const slots: { start: Date; end: Date }[] = [];
    const today = new Date();

    for (const time of timeOptions) {
      const range = TIME_RANGES[time];

      for (const when of whenOptions) {
        if (when === 'later') {
          const start = new Date(today);
          start.setHours(range.start, 0, 0, 0);
          if (start < today) start.setDate(start.getDate() + 1);
          const end = new Date(start);
          end.setHours(range.end, 0, 0, 0);
          slots.push({ start, end });
        } else {
          for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const day = date.getDay();
            const isWeekday = day >= 1 && day <= 5;
            const isWeekend = day === 0 || day === 6;

            if ((when === 'weekdays' && isWeekday) || (when === 'weekends' && isWeekend)) {
              const start = new Date(date);
              start.setHours(range.start, 0, 0, 0);
              const end = new Date(date);
              end.setHours(range.end, 0, 0, 0);
              if (start > today) slots.push({ start, end });
            }
          }
        }
      }
    }
    return slots;
  };

  const toggleWhen = (option: WhenOption) => {
    setSelectedWhen((prev) => {
      if (prev.includes(option)) {
        return prev.length > 1 ? prev.filter((w) => w !== option) : prev;
      }
      return [...prev, option];
    });
  };

  const toggleTime = (option: TimeOfDay) => {
    setSelectedTimes((prev) => {
      if (prev.includes(option)) {
        return prev.length > 1 ? prev.filter((t) => t !== option) : prev;
      }
      return [...prev, option];
    });
  };

  const Pill = ({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity
      style={[
        styles.pill,
        selected ? { backgroundColor: colors.tint } : { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' },
        disabled && { opacity: 0.4 },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.pillText, { color: selected ? '#fff' : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  const hasLaterSelected = selectedWhen.includes('later');
  const availableTimeOptions = hasLaterSelected ? getAvailableTimeOptions('later') : ['morning', 'noon', 'afternoon', 'evening'] as TimeOfDay[];

  useEffect(() => {
    if (hasLaterSelected) {
      const validTimes = selectedTimes.filter((t) => availableTimeOptions.includes(t));
      if (validTimes.length === 0 && availableTimeOptions.length > 0) {
        setSelectedTimes([availableTimeOptions[0]]);
      } else if (validTimes.length !== selectedTimes.length) {
        setSelectedTimes(validTimes);
      }
    }
  }, [hasLaterSelected, availableTimeOptions, selectedTimes]);

  const formatSlot = (item: AvailabilityWindow) => {
    const start = new Date(item.start_ts_utc);
    const end = new Date(item.end_ts_utc);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === tomorrow.toDateString();
    const dateStr = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    return { dateStr, timeStr };
  };

  const anyCalendarConnected = googleCalendarConnected || appleCalendarSynced;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sync Feedback Banner */}
      {syncFeedback && (
        <Animated.View
          style={[
            styles.feedbackBanner,
            { opacity: feedbackOpacity },
            syncFeedback.type === 'success'
              ? { backgroundColor: isDark ? '#1b4332' : '#d4edda' }
              : { backgroundColor: isDark ? '#4a1515' : '#f8d7da' },
          ]}
        >
          <Text
            style={[
              styles.feedbackText,
              { color: syncFeedback.type === 'success' ? (isDark ? '#95d5b2' : '#155724') : (isDark ? '#f5a5a5' : '#721c24') },
            ]}
          >
            {syncFeedback.message}
          </Text>
        </Animated.View>
      )}

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

          {/* Schedule a Match - Primary Action */}
          <TouchableOpacity
            style={[styles.primarySection, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
            onPress={() => setShowSchedule(!showSchedule)}
            activeOpacity={0.7}
          >
            <View style={styles.primaryHeader}>
              <Text style={[styles.primaryTitle, { color: colors.text }]}>Schedule a Match</Text>
              <Text style={[styles.chevron, { color: colors.icon }]}>{showSchedule ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>

          {showSchedule && (
            <View style={[styles.scheduleCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              <Text style={[styles.scheduleLabel, { color: colors.icon }]}>When</Text>
              <View style={styles.pillRow}>
                <Pill label="Later today" selected={selectedWhen.includes('later')} onPress={() => toggleWhen('later')} />
                <Pill label="Weekdays" selected={selectedWhen.includes('weekdays')} onPress={() => toggleWhen('weekdays')} />
                <Pill label="Weekends" selected={selectedWhen.includes('weekends')} onPress={() => toggleWhen('weekends')} />
              </View>

              <Text style={[styles.scheduleLabel, { color: colors.icon, marginTop: 20 }]}>
                Time of day {hasLaterSelected && availableTimeOptions.length < 4 && '(based on current time)'}
              </Text>
              <View style={styles.pillRow}>
                <Pill label="Morning" selected={selectedTimes.includes('morning')} onPress={() => toggleTime('morning')} disabled={hasLaterSelected && !availableTimeOptions.includes('morning')} />
                <Pill label="Noon" selected={selectedTimes.includes('noon')} onPress={() => toggleTime('noon')} disabled={hasLaterSelected && !availableTimeOptions.includes('noon')} />
                <Pill label="Afternoon" selected={selectedTimes.includes('afternoon')} onPress={() => toggleTime('afternoon')} disabled={hasLaterSelected && !availableTimeOptions.includes('afternoon')} />
                <Pill label="Evening" selected={selectedTimes.includes('evening')} onPress={() => toggleTime('evening')} disabled={hasLaterSelected && !availableTimeOptions.includes('evening')} />
              </View>

              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.tint }, (saving || selectedWhen.length === 0 || selectedTimes.length === 0) && { opacity: 0.6 }]}
                onPress={handleSchedule}
                disabled={saving || selectedWhen.length === 0 || selectedTimes.length === 0}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmButtonText}>Add to Availability</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Your Availability - Compact Preview */}
          {availability.length > 0 && (
            <View style={styles.sectionSpacing}>
              <TouchableOpacity
                style={[styles.compactSection, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                onPress={() => router.push('/availability')}
                activeOpacity={0.7}
              >
                <View style={styles.compactHeader}>
                  <Text style={[styles.compactTitle, { color: colors.text }]}>Your Availability</Text>
                  <View style={styles.compactBadge}>
                    <Text style={[styles.compactBadgeText, { color: colors.tint }]}>{availability.length}</Text>
                  </View>
                </View>

                {availability.slice(0, PREVIEW_SLOTS).map((item, idx) => {
                  const { dateStr, timeStr } = formatSlot(item);
                  return (
                    <View key={item.id} style={[styles.slotRow, idx < PREVIEW_SLOTS - 1 && idx < availability.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#333' : '#f0f0f0' }]}>
                      <Text style={[styles.slotDate, { color: colors.text }]}>{dateStr}</Text>
                      <Text style={[styles.slotTime, { color: colors.icon }]}>{timeStr}</Text>
                    </View>
                  );
                })}

                {availability.length > PREVIEW_SLOTS && (
                  <View style={styles.seeAllRow}>
                    <Text style={[styles.seeAllText, { color: colors.tint }]}>See all {availability.length} slots →</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Calendar Sync - Collapsed by default */}
          <View style={styles.sectionSpacing}>
            <TouchableOpacity
              style={[styles.compactSection, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onPress={() => setShowCalendars(!showCalendars)}
              activeOpacity={0.7}
            >
              <View style={styles.compactHeader}>
                <Text style={[styles.compactTitle, { color: colors.text }]}>Sync Calendars</Text>
                <View style={styles.calendarHeaderRight}>
                  {anyCalendarConnected && (
                    <View style={[styles.connectedDot, { backgroundColor: '#4caf50' }]} />
                  )}
                  <Text style={[styles.chevron, { color: colors.icon }]}>{showCalendars ? '▲' : '▼'}</Text>
                </View>
              </View>

              {!showCalendars && anyCalendarConnected && (
                <Text style={[styles.calendarSummary, { color: colors.icon }]}>
                  {[googleCalendarConnected && 'Google', appleCalendarSynced && 'iCloud'].filter(Boolean).join(' + ')} connected
                </Text>
              )}
            </TouchableOpacity>

            {showCalendars && (
              <View style={[styles.calendarList, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
                {/* Google Calendar */}
                <View style={styles.calendarRow}>
                  <View style={styles.calendarInfo}>
                    <View style={styles.calendarNameRow}>
                      <Text style={[styles.calendarName, { color: colors.text }]}>Google Calendar</Text>
                      {googleCalendarConnected && <View style={[styles.statusDot, { backgroundColor: '#4caf50' }]} />}
                    </View>
                    <Text style={[styles.calendarStatus, { color: colors.icon }]}>
                      {googleCalendarConnected ? (googleLastSync ? `Synced ${googleLastSync}` : 'Connected') : 'Not connected'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.calendarAction, googleCalendarConnected ? { backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5' } : { backgroundColor: colors.tint }]}
                    onPress={googleCalendarConnected ? syncGoogleCalendar : handleConnectGoogle}
                    disabled={syncingGoogle || saving}
                  >
                    {syncingGoogle ? (
                      <ActivityIndicator size="small" color={googleCalendarConnected ? colors.tint : '#fff'} />
                    ) : (
                      <Text style={[styles.calendarActionText, { color: googleCalendarConnected ? colors.tint : '#fff' }]}>
                        {googleCalendarConnected ? 'Refresh' : 'Connect'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={[styles.calendarDivider, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]} />

                {/* iCloud Calendar */}
                <View style={styles.calendarRow}>
                  <View style={styles.calendarInfo}>
                    <View style={styles.calendarNameRow}>
                      <Text style={[styles.calendarName, { color: colors.text }]}>iCloud Calendar</Text>
                      {appleCalendarSynced && <View style={[styles.statusDot, { backgroundColor: '#4caf50' }]} />}
                    </View>
                    <Text style={[styles.calendarStatus, { color: colors.icon }]}>
                      {appleCalendarSynced ? (appleLastSync ? `Synced ${appleLastSync}` : 'Connected') : 'Not connected'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.calendarAction, appleCalendarSynced ? { backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5' } : { backgroundColor: colors.tint }]}
                    onPress={syncAppleCalendar}
                    disabled={syncingApple}
                  >
                    {syncingApple ? (
                      <ActivityIndicator size="small" color={appleCalendarSynced ? colors.tint : '#fff'} />
                    ) : (
                      <Text style={[styles.calendarActionText, { color: appleCalendarSynced ? colors.tint : '#fff' }]}>
                        {appleCalendarSynced ? 'Refresh' : 'Connect'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // Feedback Banner
  feedbackBanner: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    zIndex: 100,
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },

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
  main: { flex: 1, paddingHorizontal: 20 },
  logoContainer: { alignItems: 'center', marginTop: 8, marginBottom: 32 },
  logo: { fontSize: 48, fontWeight: '900', letterSpacing: 8 },

  // Primary section (Schedule)
  primarySection: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  primaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primaryTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  chevron: { fontSize: 12 },

  // Schedule card
  scheduleCard: {
    marginTop: 2,
    padding: 18,
    borderRadius: 14,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  scheduleLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  pillText: { fontSize: 14, fontWeight: '600' },
  confirmButton: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Compact sections (Availability, Calendars)
  sectionSpacing: { marginTop: 16 },
  compactSection: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  compactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  compactTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  compactBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  compactBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Availability slots
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  slotDate: { fontSize: 15, fontWeight: '500' },
  slotTime: { fontSize: 14 },
  seeAllRow: {
    paddingTop: 12,
    alignItems: 'center',
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Calendar section
  calendarHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calendarSummary: {
    fontSize: 13,
    marginTop: 4,
  },
  calendarList: {
    marginTop: 2,
    borderRadius: 14,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  calendarInfo: { flex: 1 },
  calendarNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calendarName: { fontSize: 15, fontWeight: '500' },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  calendarStatus: { fontSize: 12, marginTop: 2 },
  calendarAction: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 80,
    alignItems: 'center',
  },
  calendarActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  calendarDivider: {
    height: 1,
  },
});
