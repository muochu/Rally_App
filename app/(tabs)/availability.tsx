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
  const [editTimeOfDay, setEditTimeOfDay] = useState<TimeOfDay>('morning');

  // Collapsible section states
  const [showSuggested, setShowSuggested] = useState(true);
  const [showAvailability, setShowAvailability] = useState(true);
  const [showBusyBlocks, setShowBusyBlocks] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const generateRecommendations = (busy: BusyBlock[], existing: AvailabilityWindow[]): RecommendedSlot[] => {
    const recs: RecommendedSlot[] = [];
    const now = new Date();
    let lastRecEndHour = -1;
    let lastRecDate = '';

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

      const dayBusy = busy.filter((b) => {
        const bStart = new Date(b.start_ts_utc);
        const bEnd = new Date(b.end_ts_utc);
        return bStart < dayEnd && bEnd > dayStart;
      });

      const dayAvail = existing.filter((a) => {
        const aStart = new Date(a.start_ts_utc);
        const aEnd = new Date(a.end_ts_utc);
        return aStart < dayEnd && aEnd > dayStart;
      });

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

        if (windowEnd <= now) continue;
        if (dateKey === lastRecDate && window.start <= lastRecEndHour) continue;

        const effectiveStart = windowStart < now ? now : windowStart;

        const isBusy = dayBusy.some((b) => {
          const bStart = new Date(b.start_ts_utc);
          const bEnd = new Date(b.end_ts_utc);
          return bStart < windowEnd && bEnd > effectiveStart;
        });

        const hasAvail = dayAvail.some((a) => {
          const aStart = new Date(a.start_ts_utc);
          const aEnd = new Date(a.end_ts_utc);
          return aStart < windowEnd && aEnd > effectiveStart;
        });

        if (!isBusy && !hasAvail) {
          const dayLabel = dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' :
            date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

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

          lastRecEndHour = window.end;
          lastRecDate = dateKey;

          if (recs.length >= 9) return recs;
        }
      }

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
  const visibleRecs = recommendations.slice(recOffset, recOffset + 3);

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

        {/* SECTION 1: Suggested Times (collapsible) */}
        {hasCalendarSync && recommendations.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.sectionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              onPress={() => setShowSuggested(!showSuggested)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Suggested Times</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.icon }]}>Based on your calendar</Text>
                </View>
                <View style={styles.sectionRight}>
                  <View style={[styles.badge, { backgroundColor: '#4caf50' + '20' }]}>
                    <Text style={[styles.badgeText, { color: '#4caf50' }]}>{recommendations.length}</Text>
                  </View>
                  <Text style={[styles.chevron, { color: colors.icon }]}>{showSuggested ? '▲' : '▼'}</Text>
                </View>
              </View>
            </TouchableOpacity>

            {showSuggested && (
              <View style={[styles.sectionContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
                {visibleRecs.map((rec, idx) => (
                  <TouchableOpacity
                    key={rec.start.toISOString()}
                    style={[
                      styles.recRow,
                      idx < visibleRecs.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#333' : '#f0f0f0' },
                    ]}
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
                      <View style={[styles.addBtnSmall, { backgroundColor: '#4caf50' }]}>
                        <Text style={styles.addBtnSmallText}>Add</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}

                {recommendations.length > 3 && (
                  <TouchableOpacity
                    style={styles.showMoreRow}
                    onPress={() => setRecOffset((prev) => (prev + 3 >= recommendations.length ? 0 : prev + 3))}
                  >
                    <Text style={[styles.showMoreText, { color: colors.tint }]}>
                      {recOffset + 3 >= recommendations.length ? 'Show first 3' : `Show more →`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* SECTION 2: Your Availability (collapsible) */}
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
                    {hasCalendarSync ? 'Add a suggested time above' : 'Set when you can play from the home tab'}
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

        {/* Add Availability Button */}
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push('/')}
        >
          <Text style={styles.addButtonText}>+ Add Availability</Text>
        </TouchableOpacity>

        {/* SECTION 3: Calendar Busy Times (collapsible, collapsed by default) */}
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

  // Add button
  addButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

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
