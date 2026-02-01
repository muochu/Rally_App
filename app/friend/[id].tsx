import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TimeDurationPickerModal } from '@/components/time-duration-picker-modal';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCourtSelection } from '@/hooks/use-court-selection';
import { availabilityApi, contactsApi, friendAvailabilityApi, matchInvitesApi, proposalsApi } from '@/lib/supabase';
import type { AvailabilityWindow, Profile } from '@/lib/types';

export default function FriendProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { id: friendId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { selectedCourt } = useCourtSelection();

  const [friend, setFriend] = useState<Profile | null>(null);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [myAvailability, setMyAvailability] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);
  const [pendingProposals, setPendingProposals] = useState<Map<string, boolean>>(new Map());
  const [acceptedProposals, setAcceptedProposals] = useState<Map<string, boolean>>(new Map());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilityWindow | null>(null);

  const loadData = useCallback(async () => {
    if (!friendId || !user?.id) return;

    try {
      // Check if they're actually friends
      const areFriends = await contactsApi.areFriends(user.id, friendId);
      setIsFriend(areFriends);

      if (!areFriends) {
        setLoading(false);
        return;
      }

      // Load friend profile and availability, plus my own availability for comparison
      const [profile, slots, mySlots, sentProposals] = await Promise.all([
        friendAvailabilityApi.getFriendProfile(friendId),
        friendAvailabilityApi.getForFriend(friendId, 7),
        availabilityApi.list(user.id),
        proposalsApi.listSent(user.id),
      ]);

      // Filter my availability to next 7 days
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const myFilteredSlots = mySlots.filter(slot => {
        const start = new Date(slot.start_ts_utc);
        return start >= now && start < sevenDaysLater;
      });

      // Create maps of pending and accepted proposals for each slot
      // Use slot ID as key and store proposal status
      const pendingMap = new Map<string, boolean>();
      const acceptedMap = new Map<string, boolean>();
      
      sentProposals
        .filter(p => p.to_user_id === friendId)
        .forEach(p => {
          // Find which slot(s) this proposal overlaps with
          slots.forEach(slot => {
            const proposalStart = new Date(p.start_ts_utc);
            const proposalEnd = new Date(p.end_ts_utc);
            const slotStart = new Date(slot.start_ts_utc);
            const slotEnd = new Date(slot.end_ts_utc);
            
            // Check if proposal overlaps with slot (proposal time is within or overlaps slot time)
            const overlaps = proposalStart < slotEnd && proposalEnd > slotStart;
            
            if (overlaps) {
              if (p.status === 'pending') {
                pendingMap.set(slot.id, true);
              } else if (p.status === 'accepted') {
                // Only show as "upcoming" if the match hasn't happened yet
                if (proposalStart > now) {
                  acceptedMap.set(slot.id, true);
                }
              }
            }
          });
        });

      setFriend(profile);
      setAvailability(slots);
      setMyAvailability(myFilteredSlots);
      setPendingProposals(pendingMap);
      setAcceptedProposals(acceptedMap);
    } catch (e: any) {
      const errorMessage = e?.message || e?.toString() || 'Unknown error';
      const errorCode = e?.code || 'no-code';
      
      console.error('[FriendProfile] Load failed:', {
        code: errorCode,
        message: errorMessage,
        friendId,
      });
      
      Alert.alert(
        'Error Loading Friend Profile',
        `Failed to load friend profile: ${errorMessage}\n\nError code: ${errorCode}`,
        [{ text: 'OK' }]
      );
      
      setAvailability([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [friendId, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh data when screen comes into focus (e.g., after accepting an invite)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleBack = () => {
    router.back();
  };

  const handleInviteToPlay = async (slot: AvailabilityWindow) => {
    if (!user?.id || !friendId || !friend) return;

    const key = `${slot.start_ts_utc}_${slot.end_ts_utc}`;
    if (pendingProposals.has(key)) {
      return; // Already has pending invite
    }

    // Show time picker modal
    setSelectedSlot(slot);
    setShowTimePicker(true);
  };

  const handleTimePickerConfirm = async (selectedTime: Date, durationMinutes: number) => {
    if (!user?.id || !friendId || !friend || !selectedSlot) return;

    setShowTimePicker(false);
    
    const startTime = new Date(selectedTime);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    
    // Validate that the selected time is within the availability window
    const slotStart = new Date(selectedSlot.start_ts_utc);
    const slotEnd = new Date(selectedSlot.end_ts_utc);
    
    if (startTime < slotStart) {
      startTime.setTime(slotStart.getTime());
    }
    if (endTime > slotEnd) {
      endTime.setTime(slotEnd.getTime());
    }
    if (startTime >= endTime) {
      Alert.alert('Invalid Time', 'Selected time must be within the availability window.');
      return;
    }

    const timeStr = startTime.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const courtName = selectedCourt?.name || 'TBD';
    const inviteMessage = selectedCourt
      ? `Invite ${friend.display_name || 'friend'} to play at ${selectedCourt.name} on ${timeStr} for ${durationMinutes} minutes?`
      : `Invite ${friend.display_name || 'friend'} to play on ${timeStr} for ${durationMinutes} minutes?\n\nCourt can be selected later.`;

    Alert.alert(
      'Invite to Play',
      inviteMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(selectedCourt ? [] : [{
          text: 'Select Court',
          onPress: () => {
            router.push('/(tabs)/courts');
            // After returning from courts, user can tap invite again
          },
        }]),
        {
          text: 'Send Invite',
          onPress: async () => {
            setSendingInvite(selectedSlot.id);
            try {
              await matchInvitesApi.sendInvite(
                user.id,
                friendId,
                selectedCourt?.id ?? null,
                startTime.toISOString(),
                endTime.toISOString()
              );
              // Update pending proposals map
              const key = `${selectedSlot.start_ts_utc}_${selectedSlot.end_ts_utc}`;
              setPendingProposals(prev => new Map(prev).set(key, true));
              Alert.alert('Invite Sent!', `${friend.display_name || 'Your friend'} will be notified.`);
            } catch (e: any) {
              const errorMessage = e?.message || e?.toString() || 'Unknown error';
              const errorCode = e?.code || 'no-code';
              
              console.error('[FriendProfile] Invite failed:', {
                code: errorCode,
                message: errorMessage,
              });
              
              if (errorCode === '23505') {
                Alert.alert('Already Sent', 'You already have a pending invite for this time.');
              } else {
                Alert.alert(
                  'Error Sending Invite',
                  `Failed to send invite: ${errorMessage}\n\nError code: ${errorCode}`
                );
              }
            } finally {
              setSendingInvite(null);
              setSelectedSlot(null);
            }
          },
        },
      ]
    );
  };

  const formatSlot = (slot: AvailabilityWindow) => {
    const start = new Date(slot.start_ts_utc);
    const end = new Date(slot.end_ts_utc);
    const durationMins = Math.round((end.getTime() - start.getTime()) / 60000);

    return {
      date: start.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      time: start.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      duration: `${durationMins} min`,
    };
  };

  // Check if a slot overlaps with my availability (common time)
  const hasCommonAvailability = (slot: AvailabilityWindow): boolean => {
    const slotStart = new Date(slot.start_ts_utc).getTime();
    const slotEnd = new Date(slot.end_ts_utc).getTime();
    
    return myAvailability.some(mySlot => {
      const myStart = new Date(mySlot.start_ts_utc).getTime();
      const myEnd = new Date(mySlot.end_ts_utc).getTime();
      // Check if slots overlap
      return slotStart < myEnd && slotEnd > myStart;
    });
  };

  // Group availability by date
  const groupedAvailability = availability.reduce((acc, slot) => {
    const date = new Date(slot.start_ts_utc).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(slot);
    return acc;
  }, {} as Record<string, AvailabilityWindow[]>);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isFriend) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={[styles.backText, { color: colors.tint }]}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorEmoji}>🔒</Text>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Not Friends</Text>
          <Text style={[styles.errorText, { color: colors.icon }]}>
            You must be friends to view this profile.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={[styles.backText, { color: colors.tint }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {friend?.display_name || 'Friend'}
        </Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
          <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
            <Text style={styles.avatarText}>
              {(friend?.display_name || friend?.email || 'F').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.friendName, { color: colors.text }]}>
            {friend?.display_name || 'Unknown'}
          </Text>
          <Text style={[styles.friendEmail, { color: colors.icon }]}>
            {friend?.email}
          </Text>
        </View>

        {/* Selected Court Badge */}
        {selectedCourt ? (
          <View style={[styles.courtBadge, { backgroundColor: colors.tint + '20' }]}>
            <Text style={[styles.courtBadgeText, { color: colors.tint }]}>
              📍 {selectedCourt.name}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/courts')}>
              <Text style={[styles.changeText, { color: colors.tint }]}>Change</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.selectCourtBtn, { borderColor: colors.tint }]}
            onPress={() => router.push('/(tabs)/courts')}
          >
            <Text style={[styles.selectCourtText, { color: colors.tint }]}>
              Select a court to send invites
            </Text>
          </TouchableOpacity>
        )}

        {/* Availability Section */}
        <Text style={[styles.sectionTitle, { color: colors.icon }]}>
          AVAILABILITY (NEXT 7 DAYS)
        </Text>

        {Object.keys(groupedAvailability).length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No availability set
            </Text>
            <Text style={[styles.emptyHint, { color: colors.icon }]}>
              {friend?.display_name || 'This user'} hasn't added any available times yet.
            </Text>
          </View>
        ) : (
          Object.entries(groupedAvailability).map(([date, slots]) => (
            <View key={date} style={styles.dayGroup}>
              <Text style={[styles.dayLabel, { color: colors.text }]}>
                {new Date(date).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              {slots.map((slot) => {
                const { time, duration } = formatSlot(slot);
                const isSending = sendingInvite === slot.id;
                const isCommon = hasCommonAvailability(slot);
                const hasPendingInvite = pendingProposals.has(slot.id);
                const hasAcceptedInvite = acceptedProposals.has(slot.id);
                const hasAnyInvite = hasPendingInvite || hasAcceptedInvite;
                
                let buttonText = 'Invite';
                let buttonBg = colors.tint;
                let buttonTextColor = '#fff';
                
                if (hasAcceptedInvite) {
                  buttonText = 'Upcoming';
                  buttonBg = '#4caf50';
                  buttonTextColor = '#fff';
                } else if (hasPendingInvite) {
                  buttonText = 'Pending';
                  buttonBg = isDark ? '#333' : '#f0f0f0';
                  buttonTextColor = colors.icon;
                }

                return (
                  <TouchableOpacity
                    key={slot.id}
                    style={[styles.slotCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                    onPress={() => handleInviteToPlay(slot)}
                    disabled={isSending || hasAnyInvite}
                    activeOpacity={0.7}
                  >
                    <View style={styles.slotInfo}>
                      <View style={styles.slotTimeRow}>
                        <Text style={[styles.slotTime, { color: colors.text }]}>{time}</Text>
                        {isCommon && <Text style={styles.commonEmoji}>🎾</Text>}
                      </View>
                      <Text style={[styles.slotDuration, { color: colors.icon }]}>{duration}</Text>
                    </View>
                    <View style={[styles.inviteBtn, { backgroundColor: buttonBg }]}>
                      {isSending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={[styles.inviteBtnText, { color: buttonTextColor }]}>{buttonText}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {/* Time & Duration Picker Modal */}
      {selectedSlot && (
        <TimeDurationPickerModal
          visible={showTimePicker}
          onClose={() => {
            setShowTimePicker(false);
            setSelectedSlot(null);
          }}
          onConfirm={handleTimePickerConfirm}
          initialDate={new Date(selectedSlot.start_ts_utc)}
          initialDuration={Math.round((new Date(selectedSlot.end_ts_utc).getTime() - new Date(selectedSlot.start_ts_utc).getTime()) / 60000)}
          minTime={new Date(selectedSlot.start_ts_utc)}
          maxTime={new Date(selectedSlot.end_ts_utc)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 60 },
  backText: { fontSize: 16, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '600' },
  content: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },

  // Profile card
  profileCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  friendName: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  friendEmail: { fontSize: 14 },

  // Court badge
  courtBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 20,
  },
  courtBadgeText: { fontSize: 14, fontWeight: '500' },
  changeText: { fontSize: 14, fontWeight: '600' },
  selectCourtBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  selectCourtText: { fontSize: 14, fontWeight: '500' },

  // Section
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },

  // Empty state
  emptyCard: {
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Day group
  dayGroup: { marginBottom: 20 },
  dayLabel: { fontSize: 14, fontWeight: '600', marginBottom: 10, marginLeft: 4 },

  // Slot card
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  slotInfo: { flex: 1 },
  slotTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotTime: { fontSize: 15, fontWeight: '600' },
  slotDuration: { fontSize: 13, marginTop: 2 },
  commonEmoji: { fontSize: 16 },
  inviteBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 70,
    alignItems: 'center',
  },
  inviteBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Error state
  errorEmoji: { fontSize: 48, marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  errorText: { fontSize: 14, textAlign: 'center' },
});
