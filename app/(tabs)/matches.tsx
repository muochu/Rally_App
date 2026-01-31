import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { proposalsApi } from '@/lib/supabase';
import { SettingsModal } from '@/components/settings-modal';
import type { Proposal } from '@/lib/types';

type Tab = 'pending' | 'upcoming' | 'past';

export default function MatchesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const userId = user?.id;

  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const loadMatches = useCallback(async () => {
    if (!userId) return;
    try {
      const [received, sent] = await Promise.all([
        proposalsApi.listReceived(userId),
        proposalsApi.listSent(userId),
      ]);
      setProposals([...received, ...sent]);
    } catch (e) {
      console.error('Failed to load matches:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadMatches();
  };

  const filterProposals = (tab: Tab) => {
    const now = new Date();
    return proposals.filter((p) => {
      const matchTime = new Date(p.proposed_start_utc);
      if (tab === 'pending') {
        return p.status === 'pending';
      } else if (tab === 'upcoming') {
        return p.status === 'accepted' && matchTime > now;
      } else {
        return p.status === 'accepted' && matchTime <= now;
      }
    });
  };

  const filtered = filterProposals(activeTab);

  const formatMatch = (p: Proposal) => {
    const date = new Date(p.proposed_start_utc);
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
      court: p.court?.name || 'TBD',
    };
  };

  const TabButton = ({ tab, label }: { tab: Tab; label: string }) => (
    <TouchableOpacity
      style={[
        styles.tabButton,
        activeTab === tab && styles.tabButtonActive,
        activeTab === tab && { backgroundColor: isDark ? '#333' : '#fff' },
      ]}
      onPress={() => setActiveTab(tab)}
    >
      <Text
        style={[
          styles.tabButtonText,
          { color: activeTab === tab ? colors.text : colors.icon },
          activeTab === tab && styles.tabButtonTextActive,
        ]}
      >
        {label}
      </Text>
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
        {/* Header with Profile */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>MY MATCHES</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>Manage your upcoming and past matches</Text>
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
          <TabButton tab="pending" label="Pending" />
          <TabButton tab="upcoming" label="Upcoming" />
          <TabButton tab="past" label="Past" />
        </View>

        {/* Content */}
        {filtered.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={[styles.emptyText, { color: colors.icon }]}>
              {activeTab === 'pending' && 'No pending matches. Start matchmaking or schedule a match!'}
              {activeTab === 'upcoming' && 'No upcoming matches scheduled.'}
              {activeTab === 'past' && 'No past matches yet.'}
            </Text>
          </View>
        ) : (
          filtered.map((p) => {
            const { date, time, court } = formatMatch(p);
            return (
              <View
                key={p.id}
                style={[styles.matchCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              >
                <View style={styles.matchInfo}>
                  <Text style={[styles.matchDate, { color: colors.text }]}>{date}</Text>
                  <Text style={[styles.matchTime, { color: colors.icon }]}>{time}</Text>
                  <Text style={[styles.matchCourt, { color: colors.icon }]}>{court}</Text>
                </View>
                {activeTab === 'pending' && (
                  <View style={styles.matchActions}>
                    <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]}>
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.declineBtn]}>
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerText: {
    flex: 1,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIcon: {
    fontSize: 18,
  },
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
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
  tabButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  tabButtonTextActive: {
    fontWeight: '600',
  },
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
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  matchCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  matchInfo: {
    marginBottom: 12,
  },
  matchDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  matchTime: {
    fontSize: 14,
    marginTop: 2,
  },
  matchCourt: {
    fontSize: 14,
    marginTop: 2,
  },
  matchActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: '#4caf50',
  },
  acceptBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  declineBtn: {
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
  },
  declineBtnText: {
    color: '#e53935',
    fontWeight: '600',
  },
});
