import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
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

const TIME_RANGES: Record<TimeOfDay, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 10, label: 'Morning (6a-10a)' },
  noon: { start: 10, end: 13, label: 'Noon (10a-1p)' },
  afternoon: { start: 13, end: 17, label: 'Afternoon (1p-5p)' },
  evening: { start: 17, end: 21, label: 'Evening (5p-9p)' },
};

// Get available time options based on current time
const getAvailableTimeOptions = (when: WhenOption): TimeOfDay[] => {
  if (when !== 'later') {
    // For weekdays/weekends, all options available
    return ['morning', 'noon', 'afternoon', 'evening'];
  }

  const now = new Date();
  const currentHour = now.getHours();
  const available: TimeOfDay[] = [];

  // Morning available if before 10am
  if (currentHour < 10) available.push('morning');
  // Noon available if before 1pm
  if (currentHour < 13) available.push('noon');
  // Afternoon available if before 5pm
  if (currentHour < 17) available.push('afternoon');
  // Evening available if before 9pm
  if (currentHour < 21) available.push('evening');

  return available;
};

const REDIRECT_URL = 'rallyapp://auth/callback';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const {
    user,
    session,
    googleCalendarConnected,
    googleCalendarEmail,
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

  useEffect(() => {
    checkAppleCalendar();
  }, []);

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

  const syncAll = () => {
    if (googleCalendarConnected) syncGoogleCalendar();
    if (appleCalendarSynced) syncAppleCalendar();
  };

  const syncGoogleCalendar = async () => {
    if (!session?.access_token) return;
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
      }
    } catch (e) {
      console.warn('[Sync] Google failed:', e);
      Alert.alert('Sync Failed', 'Could not sync Google Calendar.');
    } finally {
      setSyncingGoogle(false);
    }
  };

  const syncAppleCalendar = async () => {
    if (!userId) return;
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
    } catch (e) {
      console.warn('[Sync] Apple failed:', e);
      Alert.alert('Sync Failed', 'Could not sync iCloud Calendar.');
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
        loadAvailability(); // Refresh the display
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

  // Get available time options for current selection
  const hasLaterSelected = selectedWhen.includes('later');
  const availableTimeOptions = hasLaterSelected ? getAvailableTimeOptions('later') : ['morning', 'noon', 'afternoon', 'evening'] as TimeOfDay[];

  // Auto-filter selected times if "later" is selected and some are no longer valid
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header with Profile */}
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

          {/* Collapsible Calendar Sync */}
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setShowCalendars(!showCalendars)}
          >
            <Text style={[styles.sectionTitle, { color: colors.icon }]}>Sync Calendars</Text>
            <View style={styles.sectionRight}>
              {(googleCalendarConnected || appleCalendarSynced) && (
                <TouchableOpacity onPress={syncAll} style={styles.refreshBtn}>
                  <Text style={[styles.refreshText, { color: colors.tint }]}>↻</Text>
                </TouchableOpacity>
              )}
              <Text style={[styles.chevron, { color: colors.icon }]}>{showCalendars ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>

          {showCalendars && (
            <View style={[styles.calendarList, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              {/* Google Calendar Row */}
              <TouchableOpacity
                style={styles.calendarItem}
                onPress={googleCalendarConnected ? syncGoogleCalendar : handleConnectGoogle}
                disabled={syncingGoogle}
              >
                <View style={styles.calendarInfo}>
                  <Text style={[styles.calendarName, { color: colors.text }]}>Google Calendar</Text>
                  {googleCalendarConnected ? (
                    <>
                      <Text style={[styles.calendarEmail, { color: colors.icon }]}>
                        {googleCalendarEmail || 'Connected'}
                      </Text>
                      {googleLastSync && (
                        <Text style={[styles.syncTime, { color: colors.icon }]}>Synced {googleLastSync}</Text>
                      )}
                    </>
                  ) : (
                    <Text style={[styles.calendarEmail, { color: colors.icon }]}>Tap to connect</Text>
                  )}
                </View>
                {syncingGoogle ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : googleCalendarConnected ? (
                  <Text style={[styles.calendarStatus, { color: '#4caf50' }]}>✓</Text>
                ) : (
                  <Text style={[styles.calendarStatus, { color: colors.tint }]}>Connect</Text>
                )}
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: isDark ? '#333' : '#eee' }]} />

              {/* iCloud Calendar Row */}
              <TouchableOpacity
                style={styles.calendarItem}
                onPress={syncAppleCalendar}
                disabled={syncingApple}
              >
                <View style={styles.calendarInfo}>
                  <Text style={[styles.calendarName, { color: colors.text }]}>iCloud Calendar</Text>
                  {appleCalendarSynced ? (
                    <>
                      <Text style={[styles.calendarEmail, { color: colors.icon }]}>Device calendars</Text>
                      {appleLastSync && (
                        <Text style={[styles.syncTime, { color: colors.icon }]}>Synced {appleLastSync}</Text>
                      )}
                    </>
                  ) : (
                    <Text style={[styles.calendarEmail, { color: colors.icon }]}>Tap to connect</Text>
                  )}
                </View>
                {syncingApple ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : appleCalendarSynced ? (
                  <Text style={[styles.calendarStatus, { color: '#4caf50' }]}>✓</Text>
                ) : (
                  <Text style={[styles.calendarStatus, { color: colors.tint }]}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Schedule a match */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowSchedule(!showSchedule)}>
            <Text style={[styles.sectionTitle, { color: colors.icon }]}>Schedule a match</Text>
            <Text style={[styles.chevron, { color: colors.icon }]}>{showSchedule ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {/* Schedule Options */}
          {showSchedule && (
            <View style={[styles.scheduleCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              <Text style={[styles.scheduleLabel, { color: colors.icon }]}>When (select multiple)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                <Pill label="Later today" selected={selectedWhen.includes('later')} onPress={() => toggleWhen('later')} />
                <Pill label="Weekdays" selected={selectedWhen.includes('weekdays')} onPress={() => toggleWhen('weekdays')} />
                <Pill label="Weekends" selected={selectedWhen.includes('weekends')} onPress={() => toggleWhen('weekends')} />
              </ScrollView>

              <Text style={[styles.scheduleLabel, { color: colors.icon, marginTop: 16 }]}>
                Time of day {hasLaterSelected && availableTimeOptions.length < 4 && '(based on current time)'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                <Pill
                  label="Morning"
                  selected={selectedTimes.includes('morning')}
                  onPress={() => toggleTime('morning')}
                  disabled={hasLaterSelected && !availableTimeOptions.includes('morning')}
                />
                <Pill
                  label="Noon"
                  selected={selectedTimes.includes('noon')}
                  onPress={() => toggleTime('noon')}
                  disabled={hasLaterSelected && !availableTimeOptions.includes('noon')}
                />
                <Pill
                  label="Afternoon"
                  selected={selectedTimes.includes('afternoon')}
                  onPress={() => toggleTime('afternoon')}
                  disabled={hasLaterSelected && !availableTimeOptions.includes('afternoon')}
                />
                <Pill
                  label="Evening"
                  selected={selectedTimes.includes('evening')}
                  onPress={() => toggleTime('evening')}
                  disabled={hasLaterSelected && !availableTimeOptions.includes('evening')}
                />
              </ScrollView>

              <TouchableOpacity
                style={[styles.confirmButton, { backgroundColor: colors.tint }]}
                onPress={handleSchedule}
                disabled={saving || selectedWhen.length === 0 || selectedTimes.length === 0}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmButtonText}>Add to availability</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Your Availability - Read-only display */}
          {availability.length > 0 && (
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => router.push('/availability')}
            >
              <Text style={[styles.sectionTitle, { color: colors.icon }]}>
                Your Availability ({availability.length})
              </Text>
              <Text style={[styles.editLink, { color: colors.tint }]}>Edit</Text>
            </TouchableOpacity>
          )}

          {availability.length > 0 && (
            <View style={[styles.availabilityList, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              {availability.slice(0, 4).map((item) => {
                const start = new Date(item.start_ts_utc);
                const end = new Date(item.end_ts_utc);
                const now = new Date();
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const isToday = start.toDateString() === now.toDateString();
                const isTomorrow = start.toDateString() === tomorrow.toDateString();
                const dateStr = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

                return (
                  <View key={item.id} style={[styles.availItem, { borderBottomColor: isDark ? '#333' : '#eee' }]}>
                    <Text style={[styles.availDate, { color: colors.text }]}>{dateStr}</Text>
                    <Text style={[styles.availTime, { color: colors.icon }]}>{timeStr}</Text>
                  </View>
                );
              })}
              {availability.length > 4 && (
                <Text style={[styles.moreText, { color: colors.icon }]}>+{availability.length - 4} more</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
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
  main: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 48, fontWeight: '900', letterSpacing: 8 },

  // Section headers (consistent style)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chevron: { fontSize: 10 },
  editLink: { fontSize: 13, fontWeight: '600' },
  refreshBtn: { padding: 4 },
  refreshText: { fontSize: 18, fontWeight: '600' },

  // Calendar list (settings style)
  calendarList: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  calendarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  calendarInfo: { flex: 1 },
  calendarName: { fontSize: 15, fontWeight: '500' },
  calendarEmail: { fontSize: 12, marginTop: 2 },
  syncTime: { fontSize: 11, marginTop: 1 },
  calendarStatus: { fontSize: 16, fontWeight: '500' },
  divider: { height: 1, marginLeft: 16 },

  // Schedule card
  scheduleCard: {
    padding: 20,
    borderRadius: 12,
    marginBottom: 8,
  },
  scheduleLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  pillText: { fontSize: 14, fontWeight: '600' },
  confirmButton: { marginTop: 20, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Availability list (read-only)
  availabilityList: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  availItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  availDate: { fontSize: 14, fontWeight: '500' },
  availTime: { fontSize: 13 },
  moreText: { fontSize: 12, textAlign: 'center', paddingVertical: 10 },
});
