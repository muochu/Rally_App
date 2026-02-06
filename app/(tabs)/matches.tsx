import { useRouter } from 'expo-router';
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

import { MatchAttendanceModal } from '@/components/match-attendance-modal';
import { SettingsModal } from '@/components/settings-modal';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { bookingsApi, matchAttendanceApi, proposalsApi } from '@/lib/supabase';
import type { Booking, Proposal } from '@/lib/types';

type Tab = 'pending' | 'upcoming' | 'past';

export default function MatchesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [currentMatchProposal, setCurrentMatchProposal] = useState<Proposal | null>(null);
  const [attendanceChecked, setAttendanceChecked] = useState<Set<string>>(new Set());

  const loadMatches = useCallback(async () => {
    if (!userId) return;
    try {
      // Load all proposals with user data included
      const allProposals = await proposalsApi.listAll(userId);
      // Also load ongoing matches to ensure they're included
      const ongoing = await proposalsApi.listOngoing(userId);
      // Merge and deduplicate
      const proposalMap = new Map<string, Proposal>();
      [...allProposals, ...ongoing].forEach(p => {
        if (!proposalMap.has(p.id)) {
          proposalMap.set(p.id, p);
        }
      });
      setProposals(Array.from(proposalMap.values()));

      // Load bookings separately - fail gracefully
      try {
        const userBookings = await bookingsApi.listForUser(userId);
        setBookings(userBookings);
      } catch (bookingsErr) {
        console.warn('[Matches] Failed to load bookings:', bookingsErr);
        setBookings([]);
      }
    } catch (e: any) {
      // NEVER swallow errors - always log full details
      const errorMessage = e?.message || e?.toString() || 'Unknown error';
      const errorCode = e?.code || 'no-code';
      console.error('[Matches] Failed to load proposals:', {
        code: errorCode,
        message: errorMessage,
        error: e,
        userId,
        stack: e?.stack,
      });
      // Could show error to user here if needed
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Check for match-time notifications
  useEffect(() => {
    if (!userId) return;

    const checkMatchNotifications = async () => {
      try {
        const ongoing = await proposalsApi.listOngoing(userId);
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

        for (const match of ongoing) {
          const matchStart = new Date(match.start_ts_utc);
          const matchId = match.id;

          if (
            matchStart >= oneMinuteAgo &&
            matchStart <= oneMinuteFromNow &&
            !attendanceChecked.has(matchId)
          ) {
            const hasConfirmed = await matchAttendanceApi.hasConfirmed(matchId, userId);
            if (!hasConfirmed) {
              setCurrentMatchProposal(match);
              setShowAttendanceModal(true);
              setAttendanceChecked(prev => new Set(prev).add(matchId));
            }
          }
        }
      } catch (err) {
        console.error('Failed to check match notifications:', err);
      }
    };

    checkMatchNotifications();
    const interval = setInterval(checkMatchNotifications, 30000);
    return () => clearInterval(interval);
  }, [userId, attendanceChecked]);

  const handleConfirmAttendance = async () => {
    if (!currentMatchProposal || !userId) return;
    
    try {
      await matchAttendanceApi.confirmAttendance(currentMatchProposal.id, userId);
      setShowAttendanceModal(false);
      loadMatches(); // Refresh matches
    } catch (err: any) {
      console.error('Failed to confirm attendance:', err);
      const errorMessage = err?.message || 'Failed to confirm attendance. Please try again.';
      Alert.alert('Error', errorMessage);
    }
  };

  const handleDismissAttendance = () => {
    setShowAttendanceModal(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadMatches();
  };

  const handleAccept = async (proposal: Proposal) => {
    setActionLoading(proposal.id);
    try {
      const bookingId = await proposalsApi.accept(proposal.id);
      Alert.alert('Match Confirmed!', 'The match has been added to your schedule.');
      loadMatches();
      router.push(`/booking/${bookingId}`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to accept proposal');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (proposal: Proposal) => {
    Alert.alert('Decline Match', 'Are you sure you want to decline this match?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(proposal.id);
          try {
            await proposalsApi.decline(proposal.id);
            loadMatches();
          } catch (e) {
            Alert.alert('Error', 'Failed to decline proposal');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const handleCancel = async (proposal: Proposal) => {
    Alert.alert('Cancel Match', 'Are you sure you want to cancel this match request?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Match',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(proposal.id);
          try {
            await proposalsApi.cancel(proposal.id);
            loadMatches();
          } catch (e) {
            Alert.alert('Error', 'Failed to cancel proposal');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const filterProposals = (tab: Tab): Proposal[] => {
    const now = new Date();
    return proposals.filter((p) => {
      const matchStart = new Date(p.start_ts_utc);
      const matchEnd = new Date(p.end_ts_utc);
      const isOngoing = p.status === 'accepted' && matchStart <= now && matchEnd > now;
      
      if (tab === 'pending') {
        return p.status === 'pending';
      } else if (tab === 'upcoming') {
        return p.status === 'accepted' && matchStart > now;
      } else {
        // Past tab: show both past matches and ongoing matches
        return p.status === 'accepted' && (matchEnd <= now || isOngoing);
      }
    });
  };

  // Get ongoing matches separately for banner
  const ongoingMatches = proposals.filter((p) => {
    if (p.status !== 'accepted') return false;
    const matchStart = new Date(p.start_ts_utc);
    const matchEnd = new Date(p.end_ts_utc);
    const now = new Date();
    return matchStart <= now && matchEnd > now;
  });

  const filtered = filterProposals(activeTab);
  const pendingCount = proposals.filter((p) => p.status === 'pending').length;
  const upcomingCount = proposals.filter((p) => {
    const matchTime = new Date(p.start_ts_utc);
    return p.status === 'accepted' && matchTime > new Date();
  }).length;

  const formatMatch = (p: Proposal) => {
    const date = new Date(p.start_ts_utc);
    const end = new Date(p.end_ts_utc);
    const durationMins = Math.round((end.getTime() - date.getTime()) / 60000);
    return {
      date: date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      time: date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      duration: `${durationMins} min`,
      court: p.court?.name || 'TBD',
      isIncoming: p.to_user_id === userId,
      opponent: p.to_user_id === userId
        ? (p.from_user?.display_name || p.from_user?.email?.split('@')[0] || 'Someone')
        : (p.to_user?.display_name || p.to_user?.email?.split('@')[0] || 'Someone'),
    };
  };

  const TabButton = ({ tab, label, badge }: { tab: Tab; label: string; badge?: number }) => (
    <TouchableOpacity
      style={[
        styles.tabButton,
        activeTab === tab && styles.tabButtonActive,
        activeTab === tab && { backgroundColor: isDark ? '#333' : '#fff' },
      ]}
      onPress={() => setActiveTab(tab)}
    >
      <View style={styles.tabContent}>
        <Text
          style={[
            styles.tabButtonText,
            { color: activeTab === tab ? colors.text : colors.icon },
            activeTab === tab && styles.tabButtonTextActive,
          ]}
        >
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View style={[styles.badge, { backgroundColor: '#e53935' }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>Matches</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>Your tennis schedule</Text>
          </View>
          <TouchableOpacity
            style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0' }]}>
          <TabButton tab="pending" label="Pending" badge={pendingCount} />
          <TabButton tab="upcoming" label="Upcoming" badge={upcomingCount} />
          <TabButton tab="past" label="Past" />
        </View>

        {/* Ongoing Match Banner (Past Tab) */}
        {activeTab === 'past' && ongoingMatches.length > 0 && (
          <View style={[styles.ongoingBanner, { backgroundColor: '#4caf50' }]}>
            <Text style={styles.ongoingBannerTitle}>🎾 Match in Progress</Text>
            {ongoingMatches.map((match) => {
              const { date, time, duration, court, opponent } = formatMatch(match);
              const startTime = new Date(match.start_ts_utc);
              const endTime = new Date(match.end_ts_utc);
              const now = new Date();
              const elapsed = Math.round((now.getTime() - startTime.getTime()) / (1000 * 60));
              const remaining = Math.round((endTime.getTime() - now.getTime()) / (1000 * 60));

              return (
                <TouchableOpacity
                  key={match.id}
                  style={styles.ongoingBannerContent}
                  onPress={() => {
                    const booking = bookings.find((b) => b.proposal_id === match.id);
                    if (booking) router.push(`/booking/${booking.id}`);
                  }}
                >
                  <View style={styles.ongoingBannerInfo}>
                    <Text style={styles.ongoingBannerText}>
                      {date} • {time} • vs {opponent}
                    </Text>
                    <Text style={styles.ongoingBannerTime}>
                      {elapsed} min elapsed • {remaining} min remaining
                    </Text>
                  </View>
                  <Text style={styles.ongoingBannerArrow}>→</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Content */}
        {filtered.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emptyIcon}>
              {activeTab === 'pending' ? '📬' : activeTab === 'upcoming' ? '🎾' : '📜'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.text }]}>
              {activeTab === 'pending' && 'No pending invites'}
              {activeTab === 'upcoming' && 'No upcoming matches'}
              {activeTab === 'past' && 'No past matches yet'}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.icon }]}>
              {activeTab === 'pending' && 'Send a match invite from the Find tab'}
              {activeTab === 'upcoming' && 'Accept an invite or schedule a match'}
              {activeTab === 'past' && 'Your completed matches will appear here'}
            </Text>
          </View>
        ) : (
          filtered.map((p) => {
            const { date, time, duration, court, isIncoming, opponent } = formatMatch(p);
            const isLoading = actionLoading === p.id;

            return (
              <View
                key={p.id}
                style={[styles.matchCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              >
                {/* Direction badge */}
                {activeTab === 'pending' && (
                  <View style={[styles.directionBadge, { backgroundColor: isIncoming ? '#4caf5020' : colors.tint + '20' }]}>
                    <Text style={[styles.directionText, { color: isIncoming ? '#4caf50' : colors.tint }]}>
                      {isIncoming ? 'Incoming' : 'Sent'}
                    </Text>
                  </View>
                )}

                <View style={styles.matchInfo}>
                  <View style={styles.matchHeader}>
                    <Text style={[styles.matchDate, { color: colors.text }]}>{date}</Text>
                    <Text style={[styles.matchDuration, { color: colors.icon }]}>{duration}</Text>
                  </View>
                  <Text style={[styles.matchTime, { color: colors.icon }]}>{time}</Text>
                  <Text style={[styles.matchCourt, { color: colors.tint }]}>{court}</Text>
                  <Text style={[styles.matchOpponent, { color: colors.icon }]}>vs {opponent}</Text>
                </View>

                {/* Actions */}
                {activeTab === 'pending' && isIncoming && (
                  <View style={styles.matchActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.acceptBtn]}
                      onPress={() => handleAccept(p)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.declineBtn]}
                      onPress={() => handleDecline(p)}
                      disabled={isLoading}
                    >
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {activeTab === 'pending' && !isIncoming && (
                  <View style={styles.matchActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.cancelBtn]}
                      onPress={() => handleCancel(p)}
                      disabled={isLoading}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {activeTab === 'upcoming' && (
                  <TouchableOpacity
                    style={[styles.viewBtn, { backgroundColor: colors.tint }]}
                    onPress={() => {
                      const booking = bookings.find((b) => b.proposal_id === p.id);
                      if (booking) router.push(`/booking/${booking.id}`);
                    }}
                  >
                    <Text style={styles.viewBtnText}>View Details</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
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

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabButtonText: { fontSize: 14, fontWeight: '500' },
  tabButtonTextActive: { fontWeight: '600' },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Empty state
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Match card
  matchCard: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
  },
  directionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 10,
  },
  directionText: { fontSize: 12, fontWeight: '600' },
  matchInfo: { marginBottom: 12 },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  matchDate: { fontSize: 16, fontWeight: '600' },
  matchDuration: { fontSize: 12 },
  matchTime: { fontSize: 14, marginTop: 2 },
  matchCourt: { fontSize: 14, fontWeight: '500', marginTop: 6 },
  matchOpponent: { fontSize: 13, marginTop: 4 },

  // Actions
  matchActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  acceptBtn: { backgroundColor: '#4caf50' },
  acceptBtnText: { color: '#fff', fontWeight: '600' },
  declineBtn: { backgroundColor: 'rgba(229, 57, 53, 0.1)' },
  declineBtnText: { color: '#e53935', fontWeight: '600' },
  cancelBtn: { backgroundColor: 'rgba(158, 158, 158, 0.15)' },
  cancelBtnText: { color: '#666', fontWeight: '600' },
  viewBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  viewBtnText: { color: '#fff', fontWeight: '600' },
  ongoingBanner: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  ongoingBannerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  ongoingBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  ongoingBannerInfo: {
    flex: 1,
  },
  ongoingBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  ongoingBannerTime: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.9,
  },
  ongoingBannerArrow: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginLeft: 12,
  },
});
