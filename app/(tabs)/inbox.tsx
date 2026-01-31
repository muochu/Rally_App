import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { proposalsApi } from '@/lib/supabase';
import { formatTimeSlot, toTimeSlot } from '@/lib/scheduling';
import type { Proposal, ProposalStatus } from '@/lib/types';

type Tab = 'received' | 'sent';

export default function InboxScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('received');
  const [receivedProposals, setReceivedProposals] = useState<Proposal[]>([]);
  const [sentProposals, setSentProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const userId = user?.id;

  const loadProposals = useCallback(async (isRefresh = false) => {
    if (!userId) return;

    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const [received, sent] = await Promise.all([
        proposalsApi.listReceived(userId),
        proposalsApi.listSent(userId),
      ]);

      setReceivedProposals(received);
      setSentProposals(sent);
    } catch (err) {
      console.error('Failed to load proposals:', err);
      setError('Failed to load proposals');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const handleAccept = async (proposal: Proposal) => {
    try {
      setProcessingId(proposal.id);
      const bookingId = await proposalsApi.accept(proposal.id);

      // Update local state
      setReceivedProposals(prev =>
        prev.map(p => p.id === proposal.id ? { ...p, status: 'accepted' as ProposalStatus } : p)
      );

      Alert.alert(
        'Booking Confirmed',
        'The match has been booked.',
        [
          { text: 'View Booking', onPress: () => router.push(`/booking/${bookingId}`) },
          { text: 'OK' },
        ]
      );
    } catch (err) {
      console.error('Failed to accept proposal:', err);
      Alert.alert('Error', 'Failed to accept proposal. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (proposal: Proposal) => {
    Alert.alert(
      'Decline Proposal',
      'Are you sure you want to decline this proposal?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessingId(proposal.id);
              await proposalsApi.decline(proposal.id);

              setReceivedProposals(prev =>
                prev.map(p => p.id === proposal.id ? { ...p, status: 'declined' as ProposalStatus } : p)
              );
            } catch (err) {
              console.error('Failed to decline proposal:', err);
              Alert.alert('Error', 'Failed to decline proposal.');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const handleCancel = async (proposal: Proposal) => {
    Alert.alert(
      'Cancel Proposal',
      'Are you sure you want to cancel this proposal?',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Proposal',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessingId(proposal.id);
              await proposalsApi.cancel(proposal.id);

              setSentProposals(prev =>
                prev.map(p => p.id === proposal.id ? { ...p, status: 'cancelled' as ProposalStatus } : p)
              );
            } catch (err) {
              console.error('Failed to cancel proposal:', err);
              Alert.alert('Error', 'Failed to cancel proposal.');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: ProposalStatus) => {
    switch (status) {
      case 'pending': return '#ff9800';
      case 'accepted': return '#4caf50';
      case 'declined': return '#f44336';
      case 'cancelled': return '#9e9e9e';
    }
  };

  const getStatusLabel = (status: ProposalStatus) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const proposals = activeTab === 'received' ? receivedProposals : sentProposals;
  const pendingCount = receivedProposals.filter(p => p.status === 'pending').length;

  const renderProposal = ({ item: proposal }: { item: Proposal }) => {
    const isProcessing = processingId === proposal.id;
    const isPending = proposal.status === 'pending';
    const isReceived = activeTab === 'received';
    const otherUser = isReceived ? proposal.from_user : proposal.to_user;

    return (
      <View style={[styles.proposalCard, { backgroundColor: colorScheme === 'dark' ? '#222' : '#f9f9f9' }]}>
        <View style={styles.proposalHeader}>
          <Text style={[styles.courtName, { color: colors.text }]}>
            {proposal.court?.name ?? 'Unknown Court'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(proposal.status) + '20' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(proposal.status) }]}>
              {getStatusLabel(proposal.status)}
            </Text>
          </View>
        </View>

        <Text style={[styles.timeText, { color: colors.text }]}>
          {formatTimeSlot(toTimeSlot(proposal.start_ts_utc, proposal.end_ts_utc))}
        </Text>

        {otherUser && (
          <Text style={[styles.userText, { color: colors.icon }]}>
            {isReceived ? 'From: ' : 'To: '}
            {otherUser.display_name || otherUser.email}
          </Text>
        )}

        {isPending && (
          <View style={styles.actions}>
            {isReceived ? (
              <>
                <TouchableOpacity
                  style={[styles.actionButton, styles.acceptButton]}
                  onPress={() => handleAccept(proposal)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.actionButtonText}>Accept</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.declineButton]}
                  onPress={() => handleDecline(proposal)}
                  disabled={isProcessing}
                >
                  <Text style={[styles.actionButtonText, { color: '#f44336' }]}>Decline</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => handleCancel(proposal)}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#9e9e9e" />
                ) : (
                  <Text style={[styles.actionButtonText, { color: '#9e9e9e' }]}>Cancel</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {proposal.status === 'accepted' && (
          <TouchableOpacity
            style={[styles.viewBookingButton, { borderColor: colors.tint }]}
            onPress={() => {
              // Navigate to booking - we need to find the booking ID
              // For simplicity, we'll reload and navigate
              router.push(`/booking/${proposal.id}?isProposalId=true`);
            }}
          >
            <Text style={[styles.viewBookingText, { color: colors.tint }]}>View Booking</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Inbox</Text>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'received' && { borderBottomColor: colors.tint, borderBottomWidth: 2 },
          ]}
          onPress={() => setActiveTab('received')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'received' ? colors.tint : colors.icon }]}>
            Received
            {pendingCount > 0 && (
              <Text style={styles.badge}> ({pendingCount})</Text>
            )}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'sent' && { borderBottomColor: colors.tint, borderBottomWidth: 2 },
          ]}
          onPress={() => setActiveTab('sent')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'sent' ? colors.tint : colors.icon }]}>
            Sent
          </Text>
        </TouchableOpacity>
      </View>

      {/* Error State */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => loadProposals()}>
            <Text style={[styles.retryText, { color: colors.tint }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Proposals List */}
      {!error && (
        <FlatList
          data={proposals}
          keyExtractor={item => item.id}
          renderItem={renderProposal}
          style={styles.list}
          contentContainerStyle={proposals.length === 0 ? styles.emptyList : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadProposals(true)}
              tintColor={colors.tint}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.icon }]}>
                {activeTab === 'received'
                  ? 'No proposals received yet.'
                  : 'No proposals sent yet.'}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.icon }]}>
                {activeTab === 'received'
                  ? 'When someone invites you to play, it will appear here.'
                  : 'Use the Find tab to propose a time to play.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 16,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
  },
  badge: {
    fontWeight: '700',
  },
  list: {
    flex: 1,
    padding: 16,
  },
  emptyList: {
    flex: 1,
  },
  proposalCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  proposalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  courtName: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 15,
    marginBottom: 4,
  },
  userText: {
    fontSize: 14,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    backgroundColor: '#4caf50',
  },
  declineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#f44336',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#9e9e9e',
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  viewBookingButton: {
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  viewBookingText: {
    fontSize: 14,
    fontWeight: '500',
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
