import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCourtSelection } from '@/hooks/use-court-selection';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { courtsApi, userCourtsApi } from '@/lib/supabase';
import { SettingsModal } from '@/components/settings-modal';
import type { Court, UserCourt } from '@/lib/types';

type Tab = 'all' | 'favorites';

export default function CourtsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { selectedCourt, selectCourt } = useCourtSelection();
  const { user } = useAuth();
  const userId = user?.id;

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [courts, setCourts] = useState<Court[]>([]);
  const [favorites, setFavorites] = useState<UserCourt[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load courts first - this is the primary data
      const courtsData = searchQuery.trim()
        ? await courtsApi.search(searchQuery.trim())
        : await courtsApi.list();
      setCourts(courtsData);

      // Load favorites separately - fail gracefully if table doesn't exist
      if (userId) {
        try {
          const favoritesData = await userCourtsApi.list(userId);
          setFavorites(favoritesData);
          setFavoriteIds(new Set(favoritesData.map((f) => f.court_id)));
        } catch (favErr: any) {
          // PGRST205 = table not in schema cache, gracefully degrade
          if (favErr?.code === 'PGRST205' || favErr?.code === '42P01') {
            console.warn('[Courts] Favorites table not available yet');
            setFavorites([]);
            setFavoriteIds(new Set());
          } else {
            console.warn('[Courts] Failed to load favorites:', favErr);
            setFavorites([]);
            setFavoriteIds(new Set());
          }
        }
      }
    } catch (err) {
      console.error('[Courts] Failed to load courts:', err);
      setError('Failed to load courts');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, userId]);

  useEffect(() => {
    const debounce = setTimeout(loadData, 300);
    return () => clearTimeout(debounce);
  }, [loadData]);

  const handleSelectCourt = (court: Court) => {
    if (selectedCourt?.id === court.id) {
      selectCourt(null);
    } else {
      selectCourt(court);
    }
  };

  const handleToggleFavorite = async (court: Court) => {
    if (!userId) return;

    setTogglingFavorite(court.id);
    try {
      if (favoriteIds.has(court.id)) {
        await userCourtsApi.remove(userId, court.id);
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(court.id);
          return next;
        });
        setFavorites((prev) => prev.filter((f) => f.court_id !== court.id));
      } else {
        const newFavorite = await userCourtsApi.add(userId, court.id);
        setFavoriteIds((prev) => new Set(prev).add(court.id));
        setFavorites((prev) => [...prev, newFavorite]);
      }
    } catch (e: any) {
      console.error('[Courts] Failed to toggle favorite:', e);
      // Show user-friendly error for table not existing
      if (e?.code === 'PGRST205' || e?.code === '42P01') {
        Alert.alert('Not Available', 'Favorites are not available yet. Please try again later.');
      }
    } finally {
      setTogglingFavorite(null);
    }
  };

  const getSurfaceLabel = (surface: Court['surface']) => {
    if (!surface) return null;
    return surface.charAt(0).toUpperCase() + surface.slice(1);
  };

  const displayCourts = activeTab === 'favorites'
    ? favorites.map((f) => f.court).filter((c): c is Court => c !== undefined)
    : courts;

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
          <View style={[styles.badge, { backgroundColor: colors.tint }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>Courts</Text>
          <Text style={[styles.subtitle, { color: colors.icon }]}>Find a place to play</Text>
        </View>
        <TouchableOpacity
          style={[styles.profileButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
          onPress={() => setShowSettings(true)}
        >
          <Text style={styles.profileIcon}>👤</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0' }]}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search courts..."
          placeholderTextColor={colors.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0' }]}>
        <TabButton tab="all" label="All Courts" />
        <TabButton tab="favorites" label="My Courts" badge={favorites.length > 0 ? favorites.length : undefined} />
      </View>

      {/* Selected Court Badge */}
      {selectedCourt && (
        <View style={[styles.selectedBadge, { backgroundColor: colors.tint + '20' }]}>
          <Text style={[styles.selectedBadgeText, { color: colors.tint }]}>
            Selected: {selectedCourt.name}
          </Text>
          <TouchableOpacity onPress={() => selectCourt(null)}>
            <Text style={[styles.clearText, { color: colors.tint }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Error State */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadData}>
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

      {/* Courts List */}
      {!loading && !error && (
        <FlatList
          data={displayCourts}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={displayCourts.length === 0 ? styles.emptyList : undefined}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedCourt?.id === item.id;
            const isFavorite = favoriteIds.has(item.id);
            const isTogglingThis = togglingFavorite === item.id;

            return (
              <TouchableOpacity
                style={[
                  styles.courtItem,
                  { backgroundColor: isDark ? '#1a1a1a' : '#fff' },
                  isSelected && { borderColor: colors.tint, borderWidth: 2 },
                ]}
                onPress={() => handleSelectCourt(item)}
              >
                <View style={styles.courtHeader}>
                  <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.courtActions}>
                    {/* Favorite Star */}
                    <TouchableOpacity
                      style={styles.favoriteBtn}
                      onPress={() => handleToggleFavorite(item)}
                      disabled={isTogglingThis}
                    >
                      {isTogglingThis ? (
                        <ActivityIndicator size="small" color={colors.tint} />
                      ) : (
                        <Text style={[styles.favoriteIcon, isFavorite && styles.favoriteActive]}>
                          {isFavorite ? '★' : '☆'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {/* Selected checkmark */}
                    {isSelected && (
                      <View style={[styles.checkmark, { backgroundColor: colors.tint }]}>
                        <Text style={styles.checkmarkText}>✓</Text>
                      </View>
                    )}
                  </View>
                </View>

                {item.address && (
                  <Text style={[styles.courtAddress, { color: colors.icon }]} numberOfLines={1}>
                    {item.address}
                  </Text>
                )}

                <View style={styles.courtMeta}>
                  {item.surface && (
                    <View style={[styles.tag, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]}>
                      <Text style={[styles.tagText, { color: colors.text }]}>
                        {getSurfaceLabel(item.surface)}
                      </Text>
                    </View>
                  )}
                  {item.lights && (
                    <View style={[styles.tag, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]}>
                      <Text style={[styles.tagText, { color: colors.text }]}>💡 Lights</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              <Text style={styles.emptyIcon}>
                {activeTab === 'favorites' ? '⭐' : '🎾'}
              </Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {activeTab === 'favorites' ? 'No favorite courts' : 'No courts found'}
              </Text>
              <Text style={[styles.emptyText, { color: colors.icon }]}>
                {activeTab === 'favorites'
                  ? 'Tap the star on any court to add it to your favorites'
                  : searchQuery
                  ? 'No courts match your search'
                  : 'No courts available'
                }
              </Text>
            </View>
          }
        />
      )}

      <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },

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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  searchIcon: { fontSize: 16, marginRight: 10 },
  searchInput: { flex: 1, fontSize: 16 },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
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

  // Selected badge
  selectedBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  selectedBadgeText: { fontSize: 14, fontWeight: '500' },
  clearText: { fontSize: 14, fontWeight: '600' },

  // List
  list: { flex: 1 },
  emptyList: { flex: 1 },

  // Court item
  courtItem: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courtName: { fontSize: 16, fontWeight: '600', flex: 1 },
  courtActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  favoriteBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteIcon: {
    fontSize: 22,
    color: '#ccc',
  },
  favoriteActive: {
    color: '#ffc107',
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  courtAddress: { fontSize: 13, marginTop: 4 },
  courtMeta: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: { fontSize: 12, fontWeight: '500' },

  // States
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: 16,
    alignItems: 'center',
  },
  errorText: { color: '#e53935', marginBottom: 8 },
  retryText: { fontSize: 16, fontWeight: '500' },

  // Empty
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
