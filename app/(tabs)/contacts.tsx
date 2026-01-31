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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { SettingsModal } from '@/components/settings-modal';
import { supabase } from '@/lib/supabase';

type RallyContact = {
  id: string;
  name: string;
  email?: string;
  isRallyUser: boolean;
  rallyUserId?: string;
};

export default function ContactsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();

  const [contacts, setContacts] = useState<RallyContact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RallyContact[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadContacts();
  }, [user?.id]);

  const loadContacts = async () => {
    if (!user?.id) return;
    try {
      // Load Rally contacts (friends)
      const { data } = await supabase
        .from('contacts')
        .select('*, friend:friend_id(id, email, display_name)')
        .eq('user_id', user.id);

      if (data) {
        const rallyContacts: RallyContact[] = data.map((c: any) => ({
          id: c.id,
          name: c.friend?.display_name || c.friend?.email?.split('@')[0] || 'Unknown',
          email: c.friend?.email,
          isRallyUser: true,
          rallyUserId: c.friend_id,
        }));
        setContacts(rallyContacts);
      }
    } catch (e) {
      console.warn('Failed to load contacts:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const searchRallyUsers = useCallback(async (query: string) => {
    if (!query || query.length < 2 || !user?.id) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .or(`email.ilike.%${query}%,display_name.ilike.%${query}%`)
        .neq('id', user.id)
        .limit(10);

      if (data) {
        const results: RallyContact[] = data.map((u) => ({
          id: u.id,
          name: u.display_name || u.email?.split('@')[0] || 'Unknown',
          email: u.email,
          isRallyUser: true,
          rallyUserId: u.id,
        }));
        setSearchResults(results.filter((r) => !contacts.find((c) => c.rallyUserId === r.rallyUserId)));
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setSearching(false);
    }
  }, [user?.id, contacts]);

  useEffect(() => {
    const debounce = setTimeout(() => searchRallyUsers(searchQuery), 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, searchRallyUsers]);

  const addContact = async (contact: RallyContact) => {
    if (!user?.id || !contact.rallyUserId) return;
    try {
      const { error } = await supabase.from('contacts').insert({
        user_id: user.id,
        friend_id: contact.rallyUserId,
      });

      if (error) {
        if (error.code === '23505') {
          Alert.alert('Already Added', 'This contact is already in your list.');
        } else {
          throw error;
        }
        return;
      }

      setContacts((prev) => [...prev, contact]);
      setSearchResults((prev) => prev.filter((s) => s.rallyUserId !== contact.rallyUserId));
      setSearchQuery('');
    } catch (e) {
      Alert.alert('Error', 'Failed to add contact.');
    }
  };

  const removeContact = async (contact: RallyContact) => {
    if (!user?.id) return;
    Alert.alert('Remove Contact', `Remove ${contact.name} from your contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase.from('contacts').delete().eq('id', contact.id);
            setContacts((prev) => prev.filter((c) => c.id !== contact.id));
          } catch (e) {
            Alert.alert('Error', 'Failed to remove contact.');
          }
        },
      },
    ]);
  };

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadContacts();
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
            placeholder="Search by name or email..."
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
            {searchResults.map((contact) => (
              <View
                key={contact.id}
                style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactName, { color: colors.text }]}>{contact.name}</Text>
                  <Text style={[styles.contactEmail, { color: colors.icon }]}>{contact.email}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.tint }]}
                  onPress={() => addContact(contact)}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* My Contacts */}
        {filteredContacts.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.icon }]}>MY CONTACTS ({filteredContacts.length})</Text>
            {filteredContacts.map((contact) => (
              <TouchableOpacity
                key={contact.id}
                style={[styles.contactCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
                onLongPress={() => removeContact(contact)}
              >
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={[styles.contactName, { color: colors.text }]}>{contact.name}</Text>
                  {contact.email && (
                    <Text style={[styles.contactEmail, { color: colors.icon }]}>{contact.email}</Text>
                  )}
                </View>
                <Text style={[styles.rallyBadge, { color: colors.tint }]}>Rally</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : searchQuery.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={[styles.emptyText, { color: colors.text }]}>No contacts yet</Text>
            <Text style={[styles.emptyHint, { color: colors.icon }]}>
              Search for Rally users by name or email to add them as contacts
            </Text>
          </View>
        ) : null}
      </ScrollView>

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
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
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
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rallyBadge: { fontSize: 12, fontWeight: '600' },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
