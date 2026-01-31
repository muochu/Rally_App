import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCourtSelection } from '@/hooks/use-court-selection';
import { Colors } from '@/constants/theme';
import { courtsApi } from '@/lib/supabase';
import { SettingsModal } from '@/components/settings-modal';
import type { Court } from '@/lib/types';

export default function CourtsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { selectedCourt, selectCourt } = useCourtSelection();

  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const loadCourts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = searchQuery.trim()
        ? await courtsApi.search(searchQuery.trim())
        : await courtsApi.list();

      setCourts(data);
    } catch (err) {
      console.error('Failed to load courts:', err);
      setError('Failed to load courts');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const debounce = setTimeout(loadCourts, 300);
    return () => clearTimeout(debounce);
  }, [loadCourts]);

  const handleSelectCourt = (court: Court) => {
    if (selectedCourt?.id === court.id) {
      selectCourt(null);
    } else {
      selectCourt(court);
    }
  };

  const getSurfaceLabel = (surface: Court['surface']) => {
    if (!surface) return null;
    return surface.charAt(0).toUpperCase() + surface.slice(1);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with Profile */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>COURTS</Text>
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
          <TouchableOpacity onPress={loadCourts}>
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
          data={courts}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={courts.length === 0 ? styles.emptyList : undefined}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedCourt?.id === item.id;
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
                  <Text style={[styles.courtName, { color: colors.text }]}>
                    {item.name}
                  </Text>
                  {isSelected && (
                    <View style={[styles.checkmark, { backgroundColor: colors.tint }]}>
                      <Text style={styles.checkmarkText}>✓</Text>
                    </View>
                  )}
                </View>

                {item.address && (
                  <Text style={[styles.courtAddress, { color: colors.icon }]}>
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
                      <Text style={[styles.tagText, { color: colors.text }]}>
                        Lights
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
              <Text style={styles.emptyIcon}>🎾</Text>
              <Text style={[styles.emptyText, { color: colors.icon }]}>
                {searchQuery ? 'No courts match your search.' : 'No courts available.'}
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
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerText: {
    flex: 1,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  selectedBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  selectedBadgeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  emptyList: {
    flex: 1,
  },
  courtItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courtName: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  courtAddress: {
    fontSize: 14,
    marginTop: 4,
  },
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
  tagText: {
    fontSize: 12,
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
    fontSize: 16,
    textAlign: 'center',
  },
});
