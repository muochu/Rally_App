import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { availabilityApi, busyBlocksApi } from '@/lib/supabase';
import { SettingsModal } from '@/components/settings-modal';
import type { AvailabilityWindow, BusyBlock } from '@/lib/types';

type RecommendedSlot = {
  start: Date;
  end: Date;
  label: string;
  reason: string;
};

type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening';

const TIME_RANGES: Record<TimeOfDay, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 10, label: 'Morning (6a-10a)' },
  noon: { start: 10, end: 13, label: 'Noon (10a-1p)' },
  afternoon: { start: 13, end: 17, label: 'Afternoon (1p-5p)' },
  evening: { start: 17, end: 21, label: 'Evening (5p-9p)' },
};

export default function AvailabilityScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user, googleCalendarConnected } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendedSlot[]>([]);
  const [recOffset, setRecOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<AvailabilityWindow | null>(null);
  const [editTimeOfDay, setEditTimeOfDay] = useState<'morning' | 'noon' | 'afternoon' | 'evening'>('morning');

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const [availData, busyData] = await Promise.all([
        availabilityApi.list(userId),
        busyBlocksApi.list(userId),
      ]);

      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Filter availability to next 7 days
      const filteredAvail = availData.filter((a) => {
        const start = new Date(a.start_ts_utc);
        const end = new Date(a.end_ts_utc);
        return end > now && start < sevenDaysLater;
      }).sort((a, b) =>
        new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime()
      );

      // Filter busy blocks to next 7 days
      const filteredBusy = busyData.filter((b) => {
        const start = new Date(b.start_ts_utc);
        const end = new Date(b.end_ts_utc);
        return end > now && start < sevenDaysLater;
      });

      setAvailability(filteredAvail);
      setBusyBlocks(filteredBusy);

      // Generate recommendations based on busy blocks
      const recs = generateRecommendations(filteredBusy, filteredAvail);
      setRecommendations(recs);
      setRecOffset(0);
    } catch (e) {
      console.error('Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reload when tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const generateRecommendations = (busy: BusyBlock[], existing: AvailabilityWindow[]): RecommendedSlot[] => {
    const recs: RecommendedSlot[] = [];
    const now = new Date();

    // Track last recommended end time to avoid consecutive slots
    let lastRecEndHour = -1;
    let lastRecDate = '';

    // Look at the next 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);

      const dayOfWeek = date.getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const dateKey = date.toDateString();

      const dayStart = new Date(date);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      // Get busy blocks for this day
      const dayBusy = busy.filter((b) => {
        const bStart = new Date(b.start_ts_utc);
        const bEnd = new Date(b.end_ts_utc);
        return bStart < dayEnd && bEnd > dayStart;
      });

      // Get existing availability for this day
      const dayAvail = existing.filter((a) => {
        const aStart = new Date(a.start_ts_utc);
        const aEnd = new Date(a.end_ts_utc);
        return aStart < dayEnd && aEnd > dayStart;
      });

      // Consistent time ranges across the app:
      // Morning: 6am-10am, Noon: 10am-1pm, Afternoon: 1pm-5pm, Evening: 5pm-9pm
      // Weekdays: prefer outside 9-5 work hours (morning before 9, evening after 5)
      // Weekends: all times are fair game
      const windows = isWeekday ? [
        { start: 6, end: 10, label: 'Morning', reason: 'Before work' },
        { start: 17, end: 21, label: 'Evening', reason: 'After work hours' },
      ] : [
        { start: 6, end: 10, label: 'Morning', reason: 'Weekend morning' },
        { start: 10, end: 13, label: 'Noon', reason: 'Weekend midday' },
        { start: 13, end: 17, label: 'Afternoon', reason: 'Weekend afternoon' },
        { start: 17, end: 21, label: 'Evening', reason: 'Weekend evening' },
      ];

      for (const window of windows) {
        const windowStart = new Date(date);
        windowStart.setHours(window.start, 0, 0, 0);
        const windowEnd = new Date(date);
        windowEnd.setHours(window.end, 0, 0, 0);

        // Skip if in the past
        if (windowEnd <= now) continue;

        // Skip consecutive slots on the same day (e.g., don't show both After work and Evening)
        if (dateKey === lastRecDate && window.start <= lastRecEndHour) continue;

        // Adjust start if partially in the past
        const effectiveStart = windowStart < now ? now : windowStart;

        // Check if this window overlaps with any busy block
        const isBusy = dayBusy.some((b) => {
          const bStart = new Date(b.start_ts_utc);
          const bEnd = new Date(b.end_ts_utc);
          return bStart < windowEnd && bEnd > effectiveStart;
        });

        // Check if already have availability in this window
        const hasAvail = dayAvail.some((a) => {
          const aStart = new Date(a.start_ts_utc);
          const aEnd = new Date(a.end_ts_utc);
          return aStart < windowEnd && aEnd > effectiveStart;
        });

        if (!isBusy && !hasAvail) {
          const dayLabel = dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' :
            date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

          // Customize reason based on surrounding busy blocks
          let reason = window.reason;
          const beforeBusy = dayBusy.find((b) => {
            const bEnd = new Date(b.end_ts_utc);
            return bEnd <= effectiveStart && bEnd.getTime() > effectiveStart.getTime() - 2 * 60 * 60 * 1000;
          });
          const afterBusy = dayBusy.find((b) => {
            const bStart = new Date(b.start_ts_utc);
            return bStart >= windowEnd && bStart.getTime() < windowEnd.getTime() + 2 * 60 * 60 * 1000;
          });

          if (beforeBusy && afterBusy) {
            reason = 'Free between commitments';
          } else if (afterBusy) {
            reason = 'Before your next commitment';
          } else if (beforeBusy) {
            reason = 'After your last commitment';
          }

          recs.push({
            start: effectiveStart,
            end: windowEnd,
            label: `${dayLabel} ${window.label}`,
            reason,
          });

          // Track this to avoid consecutive recommendations
          lastRecEndHour = window.end;
          lastRecDate = dateKey;

          // Limit to 4 recommendations
          if (recs.length >= 9) return recs;
        }
      }

      // Reset tracking for next day
      if (dateKey !== lastRecDate) {
        lastRecEndHour = -1;
      }
    }

    return recs;
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove', 'Remove this availability?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await availabilityApi.delete(id);
            setAvailability((prev) => prev.filter((a) => a.id !== id));
          } catch (e) {
            Alert.alert('Error', 'Failed to remove');
          }
        },
      },
    ]);
  };

  const handleAddRecommendation = async (rec: RecommendedSlot) => {
    if (!userId) return;
    const key = rec.start.toISOString();
    setSavingSlot(key);
    try {
      const result = await availabilityApi.create({
        user_id: userId,
        start_ts_utc: rec.start.toISOString(),
        end_ts_utc: rec.end.toISOString(),
      });
      if (result) {
        setAvailability((prev) => [...prev, result].sort((a, b) =>
          new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime()
        ));
        setRecommendations((prev) => prev.filter((r) => r.start.toISOString() !== key));
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to add');
    } finally {
      setSavingSlot(null);
    }
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
            loadData(); // Regenerate recommendations
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

    let dateStr: string;
    if (isToday) {
      dateStr = 'Today';
    } else if (isTomorrow) {
      dateStr = 'Tomorrow';
    } else {
      dateStr = s.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }

    const timeStr = `${s.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })} – ${e.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`;

    return { date: dateStr, time: timeStr };
  };

  const getTimeOfDayLabel = (start: string) => {
    const hour = new Date(start).getHours();
    if (hour < 10) return 'Morning';
    if (hour < 13) return 'Noon';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
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

  const hasCalendarSync = googleCalendarConnected || busyBlocks.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Header with Profile */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>AVAILABILITY</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>Next 7 days</Text>
          </View>
          <TouchableOpacity
            style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        {/* Smart Recommendations based on calendar */}
        {hasCalendarSync && recommendations.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Suggested Times</Text>
              <Text style={[styles.sectionHint, { color: colors.icon }]}>Based on your calendar</Text>
            </View>

            {recommendations.slice(recOffset, recOffset + 3).map((rec, idx) => (
              <TouchableOpacity
                key={rec.start.toISOString()}
                style={[styles.recCard, { backgroundColor: isDark ? '#1a2a1a' : '#e8f5e9' }]}
                onPress={() => handleAddRecommendation(rec)}
                disabled={savingSlot === rec.start.toISOString()}
              >
                <View style={styles.recInfo}>
                  <Text style={[styles.recLabel, { color: colors.text }]}>{rec.label}</Text>
                  <Text style={[styles.recTime, { color: colors.icon }]}>
                    {rec.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – {rec.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Text style={[styles.recReason, { color: '#4caf50' }]}>{rec.reason}</Text>
                </View>
                {savingSlot === rec.start.toISOString() ? (
                  <ActivityIndicator size="small" color="#4caf50" />
                ) : (
                  <Text style={styles.recAdd}>+ Add</Text>
                )}
              </TouchableOpacity>
            ))}

            {recommendations.length > 3 && (
              <TouchableOpacity
                style={styles.showMoreBtn}
                onPress={() => setRecOffset((prev) => (prev + 3 >= recommendations.length ? 0 : prev + 3))}
              >
                <Text style={[styles.showMoreText, { color: colors.tint }]}>
                  {recOffset + 3 >= recommendations.length ? 'Show first 3' : `Show more (${recommendations.length - recOffset - 3} left)`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Current Availability */}
        {availability.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No availability set
            </Text>
            <Text style={[styles.emptyHint, { color: colors.icon }]}>
              {hasCalendarSync
                ? 'Tap a suggested time above or add from the home tab'
                : 'Set when you can play from the home tab'
              }
            </Text>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.tint }]}
              onPress={() => router.push('/')}
            >
              <Text style={styles.addButtonText}>⚡ Set Availability</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={[styles.count, { color: colors.text }]}>
                Your availability ({availability.length})
              </Text>
              <TouchableOpacity onPress={handleClearAll}>
                <Text style={styles.clearAll}>Clear all</Text>
              </TouchableOpacity>
            </View>

            {availability.map((item) => {
              const { date, time } = formatSlot(item.start_ts_utc, item.end_ts_utc);
              const timeOfDay = getTimeOfDayLabel(item.start_ts_utc);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.slotCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  onPress={() => handleEditSlot(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.slotInfo}>
                    <View style={styles.slotHeader}>
                      <Text style={[styles.slotDate, { color: colors.text }]}>{date}</Text>
                      <View style={[styles.timeBadge, { backgroundColor: colors.tint + '20' }]}>
                        <Text style={[styles.timeBadgeText, { color: colors.tint }]}>{timeOfDay}</Text>
                      </View>
                    </View>
                    <Text style={[styles.slotTime, { color: colors.icon }]}>{time}</Text>
                  </View>
                  <Text style={[styles.editHint, { color: colors.icon }]}>Edit</Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.addMoreButton, { borderColor: colors.tint }]}
              onPress={() => router.push('/')}
            >
              <Text style={[styles.addMoreText, { color: colors.tint }]}>+ Add more availability</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Calendar sync status with details */}
        {busyBlocks.length > 0 && (
          <View style={[styles.busySection, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
            <Text style={[styles.busySectionTitle, { color: colors.text }]}>
              📅 Calendar Busy Times ({busyBlocks.length})
            </Text>
            <Text style={[styles.busySectionHint, { color: colors.icon }]}>
              Imported from your connected calendars
            </Text>

            {busyBlocks.slice(0, 10).map((block, idx) => {
              const start = new Date(block.start_ts_utc);
              const end = new Date(block.end_ts_utc);
              const now = new Date();
              const isToday = start.toDateString() === now.toDateString();
              const dateStr = isToday ? 'Today' : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
              const timeStr = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

              return (
                <View key={block.id || idx} style={[styles.busyBlock, { borderLeftColor: block.source === 'google' ? '#4285f4' : '#666' }]}>
                  <View style={styles.busyBlockInfo}>
                    <Text style={[styles.busyBlockDate, { color: colors.text }]}>{dateStr}</Text>
                    <Text style={[styles.busyBlockTime, { color: colors.icon }]}>{timeStr}</Text>
                  </View>
                  <View style={[styles.sourceTag, { backgroundColor: block.source === 'google' ? '#4285f420' : '#66666620' }]}>
                    <Text style={[styles.sourceTagText, { color: block.source === 'google' ? '#4285f4' : '#666' }]}>
                      {block.source === 'google' ? 'Google' : 'Apple'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {busyBlocks.length > 10 && (
              <Text style={[styles.moreBlocks, { color: colors.icon }]}>
                +{busyBlocks.length - 10} more
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Edit Time Modal */}
      <Modal visible={!!editingSlot} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Time</Text>
            {editingSlot && (
              <Text style={[styles.modalDate, { color: colors.icon }]}>
                {new Date(editingSlot.start_ts_utc).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
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
                  <Text
                    style={[
                      styles.timeOptionText,
                      { color: editTimeOfDay === t ? '#fff' : colors.text },
                    ]}
                  >
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
  content: { padding: 24 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerText: { flex: 1 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: 3 },
  subtitle: { fontSize: 15, marginTop: 4 },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: { fontSize: 18 },
  sectionHeader: { marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionHint: { fontSize: 13, marginTop: 2 },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  recInfo: { flex: 1 },
  recLabel: { fontSize: 15, fontWeight: '600' },
  recTime: { fontSize: 13, marginTop: 2 },
  recReason: { fontSize: 12, marginTop: 4, fontWeight: '500' },
  recAdd: { color: '#4caf50', fontSize: 14, fontWeight: '700' },
  showMoreBtn: { alignItems: 'center', paddingVertical: 12, marginBottom: 8 },
  showMoreText: { fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  count: { fontSize: 15, fontWeight: '600' },
  clearAll: { color: '#e53935', fontSize: 14, fontWeight: '500' },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', marginBottom: 20 },
  addButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  slotInfo: { flex: 1 },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  slotDate: { fontSize: 16, fontWeight: '600' },
  timeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  timeBadgeText: { fontSize: 12, fontWeight: '600' },
  slotTime: { fontSize: 14, marginTop: 4 },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#e53935', fontSize: 14, fontWeight: '600' },
  addMoreButton: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  addMoreText: { fontSize: 15, fontWeight: '600' },
  busySection: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
  },
  busySectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  busySectionHint: { fontSize: 12, marginBottom: 12 },
  busyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginBottom: 8,
  },
  busyBlockInfo: { flex: 1 },
  busyBlockDate: { fontSize: 14, fontWeight: '500' },
  busyBlockTime: { fontSize: 12, marginTop: 2 },
  sourceTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceTagText: { fontSize: 11, fontWeight: '600' },
  moreBlocks: { fontSize: 12, textAlign: 'center', marginTop: 8 },
  editHint: { fontSize: 13, fontWeight: '500' },

  // Edit Modal
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
  modalTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  modalDate: { fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  timeOptions: { gap: 10 },
  timeOption: {
    paddingVertical: 14,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnText: { fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    marginTop: 16,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#e53935', fontSize: 14, fontWeight: '500' },
});
