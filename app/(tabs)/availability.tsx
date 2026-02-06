import { useFocusEffect } from '@react-navigation/native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlinePicker } from '@/components/inline-picker';
import { SettingsModal } from '@/components/settings-modal';
import { WeekRings } from '@/components/week-rings';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { handleAuthCallback } from '@/lib/auth-callback';
import {
  getCalendarPermissionStatus,
  requestCalendarPermission,
  syncCalendarEvents,
} from '@/lib/calendar';
import { availabilityApi, busyBlocksApi, supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';
import type { AvailabilityWindow, BusyBlock } from '@/lib/types';

type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening';
type WhenOption = 'today' | 'tomorrow' | 'weekdays' | 'weekends' | 'thisWeek';
type TimeOfDayOption = 'morning' | 'midday' | 'afternoon' | 'evening' | 'anytime';

const TIME_RANGES: Record<TimeOfDay, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 10, label: 'Morning (6a-10a)' },
  noon: { start: 10, end: 13, label: 'Noon (10a-1p)' },
  afternoon: { start: 13, end: 17, label: 'Afternoon (1p-5p)' },
  evening: { start: 17, end: 21, label: 'Evening (5p-9p)' },
};

const SCHEDULE_TIME_RANGES: Record<TimeOfDayOption, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 10, label: 'Morning' },
  midday: { start: 10, end: 13, label: 'Midday' },
  afternoon: { start: 13, end: 17, label: 'Afternoon' },
  evening: { start: 17, end: 21, label: 'Evening' },
  anytime: { start: 6, end: 21, label: 'Anytime' },
};

const WHEN_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: 'This week', value: 'thisWeek' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekends', value: 'weekends' },
];

const TIME_OPTIONS = [
  { label: 'Morning', value: 'morning' },
  { label: 'Midday', value: 'midday' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
  { label: 'Anytime', value: 'anytime' },
];

export default function AvailabilityScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user, session, googleCalendarConnected, refreshGoogleCalendarStatus } = useAuth();
  const userId = user?.id;

  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<AvailabilityWindow | null>(null);
  const [editTimeOfDay, setEditTimeOfDay] = useState<TimeOfDay>('morning');

  // Collapsible section states
  const [showAvailability, setShowAvailability] = useState(false); // Collapsed - week rings shows summary
  const [showBusyBlocks, setShowBusyBlocks] = useState(false);
  const [showRallyAhead, setShowRallyAhead] = useState(false);
  const [showCalendarStatus, setShowCalendarStatus] = useState(false);

  // Rally Ahead state
  const [selectedWhen, setSelectedWhen] = useState<WhenOption>('today');
  const [selectedTime, setSelectedTime] = useState<TimeOfDayOption>('evening');
  const [addingSlot, setAddingSlot] = useState(false);

  // Calendar sync state
  const [appleCalendarSynced, setAppleCalendarSynced] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [syncingApple, setSyncingApple] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const [availData, busyData] = await Promise.all([
        availabilityApi.list(userId),
        busyBlocksApi.list(userId),
      ]);

      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const filteredAvail = availData.filter((a) => {
        const start = new Date(a.start_ts_utc);
        const end = new Date(a.end_ts_utc);
        return end > now && start < sevenDaysLater;
      }).sort((a, b) =>
        new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime()
      );

      const filteredBusy = busyData.filter((b) => {
        const start = new Date(b.start_ts_utc);
        const end = new Date(b.end_ts_utc);
        return end > now && start < sevenDaysLater;
      });

      setAvailability(filteredAvail);
      setBusyBlocks(filteredBusy);
    } catch (e) {
      console.error('Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
    checkAppleCalendar();
  }, [loadData]);

  const checkAppleCalendar = async () => {
    const status = await getCalendarPermissionStatus();
    setAppleCalendarSynced(status === 'granted');
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );


  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove Slot', 'Remove this availability?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await availabilityApi.delete(id);
            setAvailability((prev) => prev.filter((a) => a.id !== id));
            loadData();
          } catch (e) {
            Alert.alert('Error', 'Failed to remove');
          }
        },
      },
    ]);
  };


  const handleClearAll = () => {
    if (availability.length === 0) return;
    Alert.alert('Clear All', 'Remove all your availability?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          try {
            for (const a of availability) {
              await availabilityApi.delete(a.id);
            }
            setAvailability([]);
            loadData();
          } catch (e) {
            Alert.alert('Error', 'Failed to clear');
          }
        },
      },
    ]);
  };

  const handleEditSlot = (slot: AvailabilityWindow) => {
    const hour = new Date(slot.start_ts_utc).getHours();
    let timeOfDay: TimeOfDay = 'morning';
    if (hour >= 17) timeOfDay = 'evening';
    else if (hour >= 13) timeOfDay = 'afternoon';
    else if (hour >= 10) timeOfDay = 'noon';
    setEditTimeOfDay(timeOfDay);
    setEditingSlot(slot);
  };

  const handleSaveEdit = async () => {
    if (!editingSlot || !userId) return;
    setSavingSlot(editingSlot.id);
    try {
      const slotDate = new Date(editingSlot.start_ts_utc);
      const range = TIME_RANGES[editTimeOfDay];
      const newStart = new Date(slotDate);
      newStart.setHours(range.start, 0, 0, 0);
      const newEnd = new Date(slotDate);
      newEnd.setHours(range.end, 0, 0, 0);

      await availabilityApi.delete(editingSlot.id);
      const result = await availabilityApi.create({
        user_id: userId,
        start_ts_utc: newStart.toISOString(),
        end_ts_utc: newEnd.toISOString(),
      });
      if (result) {
        setAvailability((prev) =>
          [...prev.filter((a) => a.id !== editingSlot.id), result].sort((a, b) =>
            new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime()
          )
        );
      }
      setEditingSlot(null);
    } catch (e) {
      Alert.alert('Error', 'Failed to update');
    } finally {
      setSavingSlot(null);
    }
  };

  const formatSlot = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = s.toDateString() === now.toDateString();
    const isTomorrow = s.toDateString() === tomorrow.toDateString();

    const dateStr = isToday ? 'Today' : isTomorrow ? 'Tomorrow' :
      s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    const timeStr = `${s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

    return { date: dateStr, time: timeStr };
  };

  const getTimeOfDayLabel = (start: string) => {
    const hour = new Date(start).getHours();
    if (hour < 10) return 'Morning';
    if (hour < 13) return 'Noon';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  };

  // Rally Ahead - schedule availability
  const handleSchedule = async () => {
    if (!userId) return;
    setAddingSlot(true);
    try {
      const slots = getSlots(selectedWhen, selectedTime);
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
        Alert.alert('Added!', `${added} time slot${added !== 1 ? 's' : ''} added to your availability.`);
        loadData();
      } else {
        Alert.alert('No changes', 'These times were already in your availability.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to schedule');
    } finally {
      setAddingSlot(false);
    }
  };

  const getSlots = (when: WhenOption, time: TimeOfDayOption) => {
    const slots: { start: Date; end: Date }[] = [];
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const timeRanges = time === 'anytime'
      ? (['morning', 'midday', 'afternoon', 'evening'] as TimeOfDayOption[])
      : [time];

    for (const t of timeRanges) {
      const range = SCHEDULE_TIME_RANGES[t];

      if (when === 'today') {
        const start = new Date(today);
        start.setHours(range.start, 0, 0, 0);
        const end = new Date(today);
        end.setHours(range.end, 0, 0, 0);
        if (start > now) slots.push({ start, end });
      } else if (when === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const start = new Date(tomorrow);
        start.setHours(range.start, 0, 0, 0);
        const end = new Date(tomorrow);
        end.setHours(range.end, 0, 0, 0);
        slots.push({ start, end });
      } else if (when === 'thisWeek') {
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          const start = new Date(date);
          start.setHours(range.start, 0, 0, 0);
          const end = new Date(date);
          end.setHours(range.end, 0, 0, 0);
          if (start > now) slots.push({ start, end });
        }
      } else if (when === 'weekdays') {
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          const day = date.getDay();
          if (day >= 1 && day <= 5) {
            const start = new Date(date);
            start.setHours(range.start, 0, 0, 0);
            const end = new Date(date);
            end.setHours(range.end, 0, 0, 0);
            if (start > now) slots.push({ start, end });
          }
        }
      } else if (when === 'weekends') {
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          const day = date.getDay();
          if (day === 0 || day === 6) {
            const start = new Date(date);
            start.setHours(range.start, 0, 0, 0);
            const end = new Date(date);
            end.setHours(range.end, 0, 0, 0);
            if (start > now) slots.push({ start, end });
          }
        }
      }
    }
    return slots;
  };

  // Calendar sync functions
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
        Alert.alert('Synced', `Google Calendar synced${data.synced > 0 ? ` - ${data.synced} busy blocks` : ''}`);
        loadData();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (e: any) {
      Alert.alert('Error', 'Google sync failed');
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
      Alert.alert('Synced', `iCloud synced${blocks.length > 0 ? ` - ${blocks.length} busy blocks` : ''}`);
      loadData();
    } catch (e) {
      Alert.alert('Error', 'iCloud sync failed');
    } finally {
      setSyncingApple(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      setAddingSlot(true);
      let redirectUri = AuthSession.makeRedirectUri();
      if (!redirectUri.includes('/auth/callback')) {
        redirectUri = `${redirectUri}/auth/callback`;
      }
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
          scopes: 'openid email https://www.googleapis.com/auth/calendar.readonly',
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (error || !data?.url) throw error;
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      const resultUrl = result.type === 'success' ? (result as { url?: string }).url : null;
      if (result.type === 'success' && resultUrl) {
        await handleAuthCallback(resultUrl);
        setTimeout(() => {
          refreshGoogleCalendarStatus();
          syncGoogleCalendar();
        }, 1000);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to connect');
    } finally {
      setAddingSlot(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>Availability</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>Next 7 days</Text>
          </View>
          <TouchableOpacity
            style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        {/* Week Overview Rings */}
        <View style={[styles.weekRingsCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
          <WeekRings availability={availability} onDeleteSlot={handleDelete} />
        </View>

        {/* Rally Ahead Section - Quick Add Availability */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.sectionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
            onPress={() => setShowRallyAhead(!showRallyAhead)}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Rally Ahead</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.icon }]}>Quickly add availability</Text>
              </View>
              <View style={styles.sectionRight}>
                <Text style={[styles.chevron, { color: colors.icon }]}>{showRallyAhead ? '▲' : '▼'}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {showRallyAhead && (
            <View style={[styles.sectionContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              <View style={styles.rallyAheadRow}>
                <Text style={[styles.rallyAheadLabel, { color: colors.text }]}>I&apos;m free</Text>
                <InlinePicker
                  label=""
                  options={WHEN_OPTIONS}
                  selectedValue={selectedWhen}
                  onValueChange={(v) => setSelectedWhen(v as WhenOption)}
                />
              </View>
              <View style={styles.rallyAheadRow}>
                <Text style={[styles.rallyAheadLabel, { color: colors.text }]}>in the</Text>
                <InlinePicker
                  label=""
                  options={TIME_OPTIONS}
                  selectedValue={selectedTime}
                  onValueChange={(v) => setSelectedTime(v as TimeOfDayOption)}
                />
              </View>
              <TouchableOpacity
                style={[styles.addSlotButton, { backgroundColor: colors.tint }]}
                onPress={handleSchedule}
                disabled={addingSlot}
              >
                {addingSlot ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addSlotButtonText}>+ Add to Availability</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Calendar Status Section */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.sectionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
            onPress={() => setShowCalendarStatus(!showCalendarStatus)}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Calendar Sync</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.icon }]}>
                  {googleCalendarConnected || appleCalendarSynced
                    ? 'Syncing automatically'
                    : 'Connect your calendars'}
                </Text>
              </View>
              <View style={styles.sectionRight}>
                {(googleCalendarConnected || appleCalendarSynced) && (
                  <View style={[styles.badge, { backgroundColor: '#4caf50' + '20' }]}>
                    <Text style={[styles.badgeText, { color: '#4caf50' }]}>
                      {(googleCalendarConnected ? 1 : 0) + (appleCalendarSynced ? 1 : 0)}
                    </Text>
                  </View>
                )}
                <Text style={[styles.chevron, { color: colors.icon }]}>{showCalendarStatus ? '▲' : '▼'}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {showCalendarStatus && (
            <View style={[styles.sectionContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              {/* Google Calendar */}
              <View style={[styles.calendarRow, { borderBottomWidth: 1, borderBottomColor: isDark ? '#333' : '#f0f0f0' }]}>
                <View style={styles.calendarInfo}>
                  <View style={styles.calendarHeader}>
                    <Text style={[styles.calendarName, { color: colors.text }]}>Google Calendar</Text>
                    {googleCalendarConnected && (
                      <View style={[styles.statusDot, { backgroundColor: '#4caf50' }]} />
                    )}
                  </View>
                  <Text style={[styles.calendarStatus, { color: colors.icon }]}>
                    {googleCalendarConnected ? 'Connected' : 'Not connected'}
                  </Text>
                </View>
                {googleCalendarConnected ? (
                  <TouchableOpacity
                    style={[styles.syncBtn, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]}
                    onPress={syncGoogleCalendar}
                    disabled={syncingGoogle}
                  >
                    {syncingGoogle ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : (
                      <Text style={[styles.syncBtnText, { color: colors.tint }]}>Sync</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.connectBtn, { backgroundColor: colors.tint }]}
                    onPress={handleConnectGoogle}
                  >
                    <Text style={styles.connectBtnText}>Connect</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Apple Calendar */}
              <View style={styles.calendarRow}>
                <View style={styles.calendarInfo}>
                  <View style={styles.calendarHeader}>
                    <Text style={[styles.calendarName, { color: colors.text }]}>iCloud Calendar</Text>
                    {appleCalendarSynced && (
                      <View style={[styles.statusDot, { backgroundColor: '#4caf50' }]} />
                    )}
                  </View>
                  <Text style={[styles.calendarStatus, { color: colors.icon }]}>
                    {appleCalendarSynced ? 'Connected' : 'Not connected'}
                  </Text>
                </View>
                {appleCalendarSynced ? (
                  <TouchableOpacity
                    style={[styles.syncBtn, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]}
                    onPress={syncAppleCalendar}
                    disabled={syncingApple}
                  >
                    {syncingApple ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : (
                      <Text style={[styles.syncBtnText, { color: colors.tint }]}>Sync</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.connectBtn, { backgroundColor: colors.tint }]}
                    onPress={syncAppleCalendar}
                  >
                    <Text style={styles.connectBtnText}>Connect</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Your Availability (collapsible) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.sectionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
            onPress={() => setShowAvailability(!showAvailability)}
            activeOpacity={0.7}
          >
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Availability</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.icon }]}>Tap to edit, swipe to delete</Text>
              </View>
              <View style={styles.sectionRight}>
                <View style={[styles.badge, { backgroundColor: colors.tint + '20' }]}>
                  <Text style={[styles.badgeText, { color: colors.tint }]}>{availability.length}</Text>
                </View>
                <Text style={[styles.chevron, { color: colors.icon }]}>{showAvailability ? '▲' : '▼'}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {showAvailability && (
            <View style={[styles.sectionContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              {availability.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📅</Text>
                  <Text style={[styles.emptyText, { color: colors.text }]}>No availability set</Text>
                  <Text style={[styles.emptyHint, { color: colors.icon }]}>
                    Set when you can play using Rally Ahead above
                  </Text>
                </View>
              ) : (
                <>
                  {availability.map((item, idx) => {
                    const { date, time } = formatSlot(item.start_ts_utc, item.end_ts_utc);
                    const timeOfDay = getTimeOfDayLabel(item.start_ts_utc);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.slotRow,
                          idx < availability.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#333' : '#f0f0f0' },
                        ]}
                        onPress={() => handleEditSlot(item)}
                        onLongPress={() => handleDelete(item.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.slotInfo}>
                          <View style={styles.slotHeaderRow}>
                            <Text style={[styles.slotDate, { color: colors.text }]}>{date}</Text>
                            <View style={[styles.timeBadge, { backgroundColor: colors.tint + '15' }]}>
                              <Text style={[styles.timeBadgeText, { color: colors.tint }]}>{timeOfDay}</Text>
                            </View>
                          </View>
                          <Text style={[styles.slotTime, { color: colors.icon }]}>{time}</Text>
                        </View>
                        <Text style={[styles.editChevron, { color: colors.icon }]}>›</Text>
                      </TouchableOpacity>
                    );
                  })}

                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.clearBtn} onPress={handleClearAll}>
                      <Text style={styles.clearBtnText}>Clear all</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          )}
        </View>

        {/* Calendar Busy Times (collapsible, collapsed by default) */}
        {busyBlocks.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.sectionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onPress={() => setShowBusyBlocks(!showBusyBlocks)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Calendar Busy Times</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.icon }]}>Imported from connected calendars</Text>
                </View>
                <View style={styles.sectionRight}>
                  <View style={[styles.badge, { backgroundColor: isDark ? '#333' : '#eee' }]}>
                    <Text style={[styles.badgeText, { color: colors.icon }]}>{busyBlocks.length}</Text>
                  </View>
                  <Text style={[styles.chevron, { color: colors.icon }]}>{showBusyBlocks ? '▲' : '▼'}</Text>
                </View>
              </View>
            </TouchableOpacity>

            {showBusyBlocks && (
              <View style={[styles.sectionContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
                {busyBlocks.slice(0, 10).map((block, idx) => {
                  const start = new Date(block.start_ts_utc);
                  const end = new Date(block.end_ts_utc);
                  const now = new Date();
                  const isToday = start.toDateString() === now.toDateString();
                  const dateStr = isToday ? 'Today' : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                  const timeStr = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
                  const isGoogle = block.source === 'google';

                  return (
                    <View
                      key={block.id || idx}
                      style={[
                        styles.busyRow,
                        idx < Math.min(busyBlocks.length, 10) - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#333' : '#f0f0f0' },
                      ]}
                    >
                      <View style={[styles.busyIndicator, { backgroundColor: isGoogle ? '#4285f4' : '#ff9500' }]} />
                      <View style={styles.busyInfo}>
                        <Text style={[styles.busyDate, { color: colors.text }]}>{dateStr}</Text>
                        <Text style={[styles.busyTime, { color: colors.icon }]}>{timeStr}</Text>
                      </View>
                      <View style={[styles.sourceTag, { backgroundColor: isGoogle ? '#4285f415' : '#ff950015' }]}>
                        <Text style={[styles.sourceTagText, { color: isGoogle ? '#4285f4' : '#ff9500' }]}>
                          {isGoogle ? 'Google' : 'iCloud'}
                        </Text>
                      </View>
                    </View>
                  );
                })}

                {busyBlocks.length > 10 && (
                  <Text style={[styles.moreText, { color: colors.icon }]}>
                    +{busyBlocks.length - 10} more
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={!!editingSlot} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Time Slot</Text>
            {editingSlot && (
              <Text style={[styles.modalDate, { color: colors.icon }]}>
                {new Date(editingSlot.start_ts_utc).toLocaleDateString(undefined, {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </Text>
            )}

            <View style={styles.timeOptions}>
              {(['morning', 'noon', 'afternoon', 'evening'] as TimeOfDay[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.timeOption,
                    { backgroundColor: isDark ? '#222' : '#f5f5f5' },
                    editTimeOfDay === t && { backgroundColor: colors.tint },
                  ]}
                  onPress={() => setEditTimeOfDay(t)}
                >
                  <Text style={[styles.timeOptionText, { color: editTimeOfDay === t ? '#fff' : colors.text }]}>
                    {TIME_RANGES[t].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: isDark ? '#333' : '#eee' }]}
                onPress={() => setEditingSlot(null)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.tint }]}
                onPress={handleSaveEdit}
                disabled={savingSlot === editingSlot?.id}
              >
                {savingSlot === editingSlot?.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                if (editingSlot) {
                  handleDelete(editingSlot.id);
                  setEditingSlot(null);
                }
              }}
            >
              <Text style={styles.deleteBtnText}>Delete this slot</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerText: { flex: 1 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 4 },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: { fontSize: 18 },

  // Week Rings Card
  weekRingsCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },

  // Sections
  section: { marginBottom: 16 },
  sectionCard: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  sectionSubtitle: { fontSize: 12, marginTop: 2 },
  sectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: { fontSize: 13, fontWeight: '600' },
  chevron: { fontSize: 12 },
  sectionContent: {
    marginTop: 2,
    borderRadius: 14,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 18,
    paddingVertical: 4,
  },

  // Recommendations
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  recInfo: { flex: 1 },
  recLabel: { fontSize: 15, fontWeight: '600' },
  recTime: { fontSize: 13, marginTop: 2 },
  recReason: { fontSize: 12, marginTop: 4, fontWeight: '500' },
  addBtnSmall: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  addBtnSmallText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  showMoreRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  showMoreText: { fontSize: 14, fontWeight: '600' },

  // Availability slots
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  slotInfo: { flex: 1 },
  slotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slotDate: { fontSize: 15, fontWeight: '600' },
  timeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  timeBadgeText: { fontSize: 11, fontWeight: '600' },
  slotTime: { fontSize: 13, marginTop: 4 },
  editChevron: { fontSize: 22, fontWeight: '300' },
  actionRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  clearBtn: {},
  clearBtnText: { color: '#e53935', fontSize: 14, fontWeight: '500' },

  // Empty state
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptyHint: { fontSize: 13, textAlign: 'center' },

  // Rally Ahead
  rallyAheadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  rallyAheadLabel: {
    fontSize: 18,
    fontWeight: '400',
    marginRight: 8,
  },
  addSlotButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  addSlotButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Calendar Status
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  calendarInfo: {
    flex: 1,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calendarName: {
    fontSize: 15,
    fontWeight: '500',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calendarStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  syncBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    minWidth: 60,
    alignItems: 'center',
  },
  syncBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  connectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // Busy blocks
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  busyIndicator: {
    width: 4,
    height: 36,
    borderRadius: 2,
    marginRight: 12,
  },
  busyInfo: { flex: 1 },
  busyDate: { fontSize: 14, fontWeight: '500' },
  busyTime: { fontSize: 12, marginTop: 2 },
  sourceTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sourceTagText: { fontSize: 11, fontWeight: '600' },
  moreText: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#ccc',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  modalDate: { fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 24 },
  timeOptions: { gap: 10 },
  timeOption: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  timeOptionText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnText: { fontSize: 16, fontWeight: '600' },
  deleteBtn: {
    marginTop: 20,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#e53935', fontSize: 14, fontWeight: '500' },
});
