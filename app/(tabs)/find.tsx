import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { useCourtSelection } from '@/hooks/use-court-selection';
import { Colors } from '@/constants/theme';
import { availabilityApi, busyBlocksApi, proposalsApi } from '@/lib/supabase';
import { requestCalendarPermission, syncCalendarEvents, getCalendarPermissionStatus } from '@/lib/calendar';
import { getFreeSlots, toTimeSlot, formatTimeSlot } from '@/lib/scheduling';
import type { TimeSlot } from '@/lib/types';

type Duration = 60 | 90;
type Horizon = 7 | 14;

export default function FindScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useAuth();
  const { selectedCourt } = useCourtSelection();

  const [freeSlots, setFreeSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingProposal, setCreatingProposal] = useState(false);

  // Controls
  const [duration, setDuration] = useState<Duration>(60);
  const [horizon, setHorizon] = useState<Horizon>(14);

  const userId = user?.id;

  const loadFreeSlots = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const [availData, busyData] = await Promise.all([
        availabilityApi.list(userId),
        busyBlocksApi.list(userId),
      ]);

      // Filter by horizon
      const now = new Date();
      const horizonDate = new Date(now.getTime() + horizon * 24 * 60 * 60 * 1000);

      const filteredAvail = availData.filter(a => {
        const start = new Date(a.start_ts_utc);
        return start >= now && start <= horizonDate;
      });

      const filteredBusy = busyData.filter(b => {
        const start = new Date(b.start_ts_utc);
        return start <= horizonDate;
      });

      const availSlots = filteredAvail.map(a => toTimeSlot(a.start_ts_utc, a.end_ts_utc));
      const busySlots = filteredBusy.map(b => toTimeSlot(b.start_ts_utc, b.end_ts_utc));

      const free = getFreeSlots(availSlots, busySlots, duration);
      setFreeSlots(free);
    } catch (err) {
      console.error('Failed to load free slots:', err);
      setError('Failed to load availability data');
    } finally {
      setLoading(false);
    }
  }, [userId, duration, horizon]);

  useEffect(() => {
    loadFreeSlots();
  }, [loadFreeSlots]);

  const handleSyncCalendar = async () => {
    if (!userId) return;

    try {
      setSyncing(true);
      setError(null);

      let permission = await getCalendarPermissionStatus();
      if (permission !== 'granted') {
        permission = await requestCalendarPermission();
        if (permission !== 'granted') {
          Alert.alert('Permission Required', 'Calendar access is needed to sync your busy times.');
          return;
        }
      }

      const blocks = await syncCalendarEvents();
      await busyBlocksApi.upsertFromCalendar(userId, blocks);
      setLastSyncTime(new Date());

      // Reload free slots
      await loadFreeSlots();

      Alert.alert('Synced', `Imported ${blocks.length} busy blocks from your calendar.`);
    } catch (err) {
      console.error('Calendar sync failed:', err);
      setError('Calendar sync failed');
      Alert.alert('Sync Failed', 'Could not sync calendar. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSlotPress = async (slot: TimeSlot) => {
    if (!userId) return;

    if (!selectedCourt) {
      Alert.alert(
        'Select a Court',
        'Please select a court from the Courts tab before creating a proposal.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Confirm with user
    Alert.alert(
      'Create Proposal',
      `Create a tennis proposal for:\n\n${formatTimeSlot(slot)}\nat ${selectedCourt.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            try {
              setCreatingProposal(true);

              await proposalsApi.create({
                from_user_id: userId,
                to_user_id: null, // Open proposal for now
                court_id: selectedCourt.id,
                start_ts_utc: slot.start.toISOString(),
                end_ts_utc: slot.end.toISOString(),
              });

              Alert.alert('Proposal Created', 'Your proposal has been sent to your inbox.');
            } catch (err) {
              console.error('Failed to create proposal:', err);
              Alert.alert('Error', 'Failed to create proposal. Please try again.');
            } finally {
              setCreatingProposal(false);
            }
          },
        },
      ]
    );
  };

  const formatLastSync = () => {
    if (!lastSyncTime) return 'Never synced';
    return `Last sync: ${lastSyncTime.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Find Time</Text>

      {/* Selected Court */}
      {selectedCourt ? (
        <View style={[styles.courtBadge, { backgroundColor: colors.tint + '20' }]}>
          <Text style={[styles.courtBadgeText, { color: colors.tint }]}>
            Court: {selectedCourt.name}
          </Text>
        </View>
      ) : (
        <View style={[styles.courtWarning, { backgroundColor: '#ff980020' }]}>
          <Text style={[styles.courtWarningText, { color: '#ff9800' }]}>
            Select a court in the Courts tab to create proposals
          </Text>
        </View>
      )}

      {/* Calendar Sync */}
      <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? '#222' : '#f5f5f5' }]}>
        <Text style={[styles.syncStatus, { color: colors.icon }]}>{formatLastSync()}</Text>
        <TouchableOpacity
          style={[styles.syncButton, { borderColor: colors.tint }]}
          onPress={handleSyncCalendar}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <Text style={[styles.syncButtonText, { color: colors.tint }]}>
              Sync Apple Calendar
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.controlGroup}>
          <Text style={[styles.controlLabel, { color: colors.icon }]}>Duration</Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[
                styles.segment,
                duration === 60 && { backgroundColor: colors.tint },
              ]}
              onPress={() => setDuration(60)}
            >
              <Text style={[styles.segmentText, duration === 60 && styles.segmentTextActive]}>
                60 min
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segment,
                duration === 90 && { backgroundColor: colors.tint },
              ]}
              onPress={() => setDuration(90)}
            >
              <Text style={[styles.segmentText, duration === 90 && styles.segmentTextActive]}>
                90 min
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.controlGroup}>
          <Text style={[styles.controlLabel, { color: colors.icon }]}>Horizon</Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[
                styles.segment,
                horizon === 7 && { backgroundColor: colors.tint },
              ]}
              onPress={() => setHorizon(7)}
            >
              <Text style={[styles.segmentText, horizon === 7 && styles.segmentTextActive]}>
                7 days
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segment,
                horizon === 14 && { backgroundColor: colors.tint },
              ]}
              onPress={() => setHorizon(14)}
            >
              <Text style={[styles.segmentText, horizon === 14 && styles.segmentTextActive]}>
                14 days
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Error State */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadFreeSlots}>
            <Text style={[styles.retryText, { color: colors.tint }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading State */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      )}

      {/* Free Slots List */}
      {!loading && !error && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Available Slots ({freeSlots.length})
          </Text>
          <FlatList
            data={freeSlots}
            keyExtractor={(_, i) => `slot-${i}`}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.slotItem, { backgroundColor: colors.tint + '15' }]}
                onPress={() => handleSlotPress(item)}
                disabled={creatingProposal}
              >
                <View style={styles.slotContent}>
                  <Text style={[styles.slotText, { color: colors.text }]}>
                    {formatTimeSlot(item)}
                  </Text>
                  <Text style={[styles.slotDuration, { color: colors.icon }]}>
                    {Math.round((item.end.getTime() - item.start.getTime()) / (1000 * 60))} min
                  </Text>
                </View>
                <Text style={[styles.slotAction, { color: colors.tint }]}>
                  Propose
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: colors.icon }]}>
                  No available slots found.
                </Text>
                <Text style={[styles.emptyHint, { color: colors.icon }]}>
                  Add availability windows and sync your calendar to find free time.
                </Text>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  courtBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  courtBadgeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  courtWarning: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  courtWarningText: {
    fontSize: 13,
    fontWeight: '500',
  },
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  syncStatus: {
    fontSize: 12,
    marginBottom: 8,
  },
  syncButton: {
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  syncButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  controls: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  controlGroup: {
    flex: 1,
  },
  controlLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  segmentTextActive: {
    color: '#fff',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  list: {
    flex: 1,
  },
  slotItem: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slotContent: {
    flex: 1,
  },
  slotText: {
    fontSize: 15,
  },
  slotDuration: {
    fontSize: 13,
    marginTop: 2,
  },
  slotAction: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
  },
  errorText: {
    color: '#e53935',
    marginBottom: 8,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
