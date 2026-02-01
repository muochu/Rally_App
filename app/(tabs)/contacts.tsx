import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { SettingsModal } from '@/components/settings-modal';
import { contactsApi, profilesApi, inviteTokensApi } from '@/lib/supabase';
import type { Contact, Profile } from '@/lib/types';

type Tab = 'friends' | 'pending';

export default function ContactsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Contact[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState<Contact[]>([]);
  const [pendingOutgoing, setPendingOutgoing] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const loadContacts = useCallback(async () => {
    if (!userId) return;
    try {
      console.log('[Contacts] Loading contacts for userId:', userId);
      const [friendsList, incoming, outgoing] = await Promise.all([
        contactsApi.listFriends(userId),
        contactsApi.listPendingIncoming(userId),
        contactsApi.listPendingOutgoing(userId),
      ]);

      // Debug: Log friend data to verify correct IDs
      console.log('[Contacts] Friends loaded:', friendsList.map(f => ({
        contactId: f.id,
        friendProfileId: f.friend?.id,
        friendEmail: f.friend?.email,
        userId: f.user_id,
        friendId: f.friend_id,
      })));

      setFriends(friendsList);
      setPendingIncoming(incoming);
      setPendingOutgoing(outgoing);
    } catch (e: any) {
      console.error('[Contacts] Failed to load:', e?.code, e?.message, e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query || query.length < 2 || !userId) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await profilesApi.search(query, userId);
      // Filter out users who are already friends or have pending requests
      const friendIds = friends.map((f) => f.friend_id);
      const pendingIds = [...pendingIncoming.map((p) => p.user_id), ...pendingOutgoing.map((p) => p.friend_id)];
      const excludeIds = new Set([...friendIds, ...pendingIds]);
      setSearchResults(results.filter((r) => !excludeIds.has(r.id)));
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [userId, friends, pendingIncoming, pendingOutgoing]);

  useEffect(() => {
    const debounce = setTimeout(() => searchUsers(searchQuery), 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, searchUsers]);

  const handleSendRequest = async (profile: Profile) => {
    if (!userId) return;
    setActionLoading(profile.id);
    try {
      await contactsApi.sendRequest(userId, profile.id);
      Alert.alert('Request Sent', `Friend request sent to ${profile.display_name || profile.email}`);
      setSearchQuery('');
      setSearchResults([]);
      loadContacts();
    } catch (e: any) {
      if (e.code === '23505') {
        Alert.alert('Already Sent', 'You already have a pending request with this user.');
      } else {
        Alert.alert('Error', 'Failed to send friend request.');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleAcceptRequest = async (contact: Contact) => {
    setActionLoading(contact.id);
    try {
      await contactsApi.acceptRequest(contact.id);
      Alert.alert('Friend Added!', `You are now friends with ${contact.user?.display_name || contact.user?.email}`);
      loadContacts();
    } catch (e) {
      Alert.alert('Error', 'Failed to accept request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeclineRequest = async (contact: Contact) => {
    Alert.alert('Decline Request', 'Are you sure you want to decline this friend request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(contact.id);
          try {
            await contactsApi.declineRequest(contact.id);
            loadContacts();
          } catch (e) {
            Alert.alert('Error', 'Failed to decline request.');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const handleCancelRequest = async (contact: Contact) => {
    Alert.alert('Cancel Request', 'Cancel this friend request?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Request',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(contact.id);
          try {
            await contactsApi.declineRequest(contact.id);
            loadContacts();
          } catch (e) {
            Alert.alert('Error', 'Failed to cancel request.');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const handleRemoveFriend = async (contact: Contact) => {
    Alert.alert('Remove Friend', `Remove ${contact.friend?.display_name || contact.friend?.email} from your friends?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await contactsApi.removeFriend(contact.id);
            loadContacts();
          } catch (e) {
            Alert.alert('Error', 'Failed to remove friend.');
          }
        },
      },
    ]);
  };

  const handleShareInvite = async () => {
    if (!userId) {
      Alert.alert('Not Signed In', 'Please sign in to create invite links.');
      return;
    }
    if (inviteLoading) return; // Prevent double-tap

    setInviteLoading(true);
    setInviteSuccess(false);

    try {
      const token = await inviteTokensApi.create(userId);
      // Create deep link that opens in Expo Go (dev) or standalone app (prod)
      const inviteUrl = Linking.createURL('invite', {
        queryParams: { token: token.token },
      });

      const result = await Share.share({
        message: `Join me on Rally to play tennis! ${inviteUrl}`,
      });

      // Show success if shared (not dismissed)
      if (result.action === Share.sharedAction) {
        setInviteSuccess(true);
        setTimeout(() => setInviteSuccess(false), 3000);
      }
    } catch (e: any) {
      console.error('[Invite] Failed to create invite link:', e);

      // Provide specific error messages
      if (e?.code === '42501' || e?.message?.includes('policy')) {
        Alert.alert(
          'Permission Denied',
          'Unable to create invite link. Please try signing out and back in.'
        );
      } else if (e?.code === 'PGRST301' || e?.message?.includes('JWT')) {
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please sign in again.'
        );
      } else if (e?.name === 'AbortError' || e?.message?.includes('cancel')) {
        // User cancelled share sheet - not an error
        return;
      } else {
        Alert.alert(
          'Error',
          'Failed to create invite link. Please check your connection and try again.'
        );
      }
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadContacts();
  };

  const pendingCount = pendingIncoming.length + pendingOutgoing.length;

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>Contacts</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>Your tennis partners</Text>
          </View>
          <TouchableOpacity
            style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search Rally users..."
            placeholderTextColor={colors.icon}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator size="small" color={colors.icon} />}
        </View>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.icon }]}>RALLY USERS</Text>
            {searchResults.map((profile) => (
              <View
                key={profile.id}
                style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <Text style={styles.avatarText}>
                    {(profile.display_name || profile.email).charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactName, { color: colors.text }]}>
                    {profile.display_name || profile.email.split('@')[0]}
                  </Text>
                  <Text style={[styles.contactEmail, { color: colors.icon }]}>{profile.email}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.tint }]}
                  onPress={() => handleSendRequest(profile)}
                  disabled={actionLoading === profile.id}
                >
                  {actionLoading === profile.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.addBtnText}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* No Search Results */}
        {searchQuery.trim().length >= 2 && searchResults.length === 0 && !searching && (
          <View style={[styles.noResultsCard, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
            <Text style={[styles.noResultsText, { color: colors.icon }]}>
              No users found for "{searchQuery.trim()}"
            </Text>
            <Text style={[styles.noResultsHint, { color: colors.icon }]}>
              Ask friends to set a display name and turn Discoverable on in Settings.
            </Text>
          </View>
        )}

        {/* Invite Button */}
        <TouchableOpacity
          style={[
            styles.inviteBtn,
            {
              backgroundColor: inviteSuccess
                ? '#4caf5015'
                : isDark
                ? '#1a1a1a'
                : '#fff',
              borderColor: inviteSuccess ? '#4caf50' : colors.tint,
            },
          ]}
          onPress={handleShareInvite}
          disabled={inviteLoading}
          activeOpacity={0.7}
        >
          {inviteLoading ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : inviteSuccess ? (
            <>
              <Text style={styles.inviteIcon}>✓</Text>
              <Text style={[styles.inviteBtnText, { color: '#4caf50' }]}>Invite link shared!</Text>
            </>
          ) : (
            <>
              <Text style={styles.inviteIcon}>📤</Text>
              <Text style={[styles.inviteBtnText, { color: colors.tint }]}>Invite friends to Rally</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Tabs */}
        <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0' }]}>
          <TabButton tab="friends" label="Friends" badge={friends.length > 0 ? friends.length : undefined} />
          <TabButton tab="pending" label="Pending" badge={pendingCount > 0 ? pendingCount : undefined} />
        </View>

        {/* Friends Tab */}
        {activeTab === 'friends' && (
          <>
            {friends.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={[styles.emptyText, { color: colors.text }]}>No friends yet</Text>
                <Text style={[styles.emptyHint, { color: colors.icon }]}>
                  Search for Rally users or invite friends to join
                </Text>
              </View>
            ) : (
              friends.map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  onPress={() => {
                    const friendProfileId = contact.friend?.id;
                    console.log('[Contacts] Navigating to friend profile:', {
                      contactRowId: contact.id,
                      friendProfileId,
                      contact_user_id: contact.user_id,
                      contact_friend_id: contact.friend_id,
                    });
                    if (friendProfileId) {
                      router.push(`/friend/${friendProfileId}`);
                    }
                  }}
                  onLongPress={() => handleRemoveFriend(contact)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                    <Text style={styles.avatarText}>
                      {(contact.friend?.display_name || contact.friend?.email || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={[styles.contactName, { color: colors.text }]}>
                      {contact.friend?.display_name || contact.friend?.email?.split('@')[0] || 'Unknown'}
                    </Text>
                    {contact.friend?.email && (
                      <Text style={[styles.contactEmail, { color: colors.icon }]}>{contact.friend.email}</Text>
                    )}
                  </View>
                  <Text style={[styles.chevron, { color: colors.icon }]}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* Pending Tab */}
        {activeTab === 'pending' && (
          <>
            {/* Incoming Requests */}
            {pendingIncoming.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.icon }]}>INCOMING REQUESTS</Text>
                {pendingIncoming.map((contact) => (
                  <View
                    key={contact.id}
                    style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: '#4caf50' }]}>
                      <Text style={styles.avatarText}>
                        {(contact.user?.display_name || contact.user?.email || 'U').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={[styles.contactName, { color: colors.text }]}>
                        {contact.user?.display_name || contact.user?.email?.split('@')[0] || 'Unknown'}
                      </Text>
                      {contact.user?.email && (
                        <Text style={[styles.contactEmail, { color: colors.icon }]}>{contact.user.email}</Text>
                      )}
                    </View>
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.acceptBtn, { backgroundColor: '#4caf50' }]}
                        onPress={() => handleAcceptRequest(contact)}
                        disabled={actionLoading === contact.id}
                      >
                        {actionLoading === contact.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.acceptBtnText}>Accept</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineBtn}
                        onPress={() => handleDeclineRequest(contact)}
                        disabled={actionLoading === contact.id}
                      >
                        <Text style={[styles.declineBtnText, { color: '#e53935' }]}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Outgoing Requests */}
            {pendingOutgoing.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.icon }]}>SENT REQUESTS</Text>
                {pendingOutgoing.map((contact) => (
                  <View
                    key={contact.id}
                    style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                      <Text style={styles.avatarText}>
                        {(contact.friend?.display_name || contact.friend?.email || 'U').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={[styles.contactName, { color: colors.text }]}>
                        {contact.friend?.display_name || contact.friend?.email?.split('@')[0] || 'Unknown'}
                      </Text>
                      {contact.friend?.email && (
                        <Text style={[styles.contactEmail, { color: colors.icon }]}>{contact.friend.email}</Text>
                      )}
                      <Text style={[styles.pendingLabel, { color: colors.icon }]}>Pending...</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.cancelReqBtn}
                      onPress={() => handleCancelRequest(contact)}
                    >
                      <Text style={[styles.cancelReqText, { color: colors.icon }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {pendingIncoming.length === 0 && pendingOutgoing.length === 0 && (
              <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
                <Text style={styles.emptyIcon}>📬</Text>
                <Text style={[styles.emptyText, { color: colors.text }]}>No pending requests</Text>
                <Text style={[styles.emptyHint, { color: colors.icon }]}>
                  Search for users to send friend requests
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

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
    marginBottom: 20,
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

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  searchIcon: { fontSize: 14, marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15 },

  // Invite button
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 20,
    gap: 8,
  },
  inviteIcon: { fontSize: 16 },
  inviteBtnText: { fontSize: 15, fontWeight: '600' },

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

  // Section
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },

  // Contact card
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '600' },
  contactEmail: { fontSize: 13, marginTop: 2 },
  pendingLabel: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },

  // Buttons
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  statusBadge: { fontSize: 12, fontWeight: '600' },
  chevron: { fontSize: 24, fontWeight: '300' },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  acceptBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  declineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: { fontSize: 14, fontWeight: '600' },
  cancelReqBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cancelReqText: { fontSize: 13, fontWeight: '500' },

  // Empty state
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // No search results
  noResultsCard: {
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  noResultsText: { fontSize: 14, marginBottom: 8 },
  noResultsHint: { fontSize: 13, lineHeight: 18 },
});
