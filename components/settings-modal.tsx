import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Linking,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { getCalendarPermissionStatus } from '@/lib/calendar';
import { busyBlocksApi, supabase } from '@/lib/supabase';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function SettingsModal({ visible, onClose }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user, profile, signOut, updateProfile, googleCalendarConnected, disconnectGoogleCalendar } = useAuth();
  const [appleCalendarConnected, setAppleCalendarConnected] = useState(false);
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null);
  const [appleLastSync, setAppleLastSync] = useState<string | null>(null);

  // Profile editing state
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Sync profile editing state when modal opens or profile changes
  useEffect(() => {
    if (visible && profile) {
      setDisplayName(profile.display_name || '');
      setDiscoverable(profile.discoverable);
      setEditingProfile(false);
    }
  }, [visible, profile]);

  useEffect(() => {
    if (visible && user?.id) {
      getCalendarPermissionStatus().then((status) => {
        setAppleCalendarConnected(status === 'granted');
      });

      busyBlocksApi.list(user.id).then((blocks) => {
        const googleBlocks = blocks.filter((b) => b.source === 'google');
        const appleBlocks = blocks.filter((b) => b.source === 'apple');

        if (googleBlocks.length > 0) {
          const latest = googleBlocks.reduce((a, b) =>
            new Date(a.created_at) > new Date(b.created_at) ? a : b
          );
          setGoogleLastSync(formatSyncTime(new Date(latest.created_at)));
        } else {
          setGoogleLastSync(null);
        }

        if (appleBlocks.length > 0) {
          const latest = appleBlocks.reduce((a, b) =>
            new Date(a.created_at) > new Date(b.created_at) ? a : b
          );
          setAppleLastSync(formatSyncTime(new Date(latest.created_at)));
        } else {
          setAppleLastSync(null);
        }
      });
    }
  }, [visible, user?.id]);

  const formatSyncTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          onClose();
          await signOut();
        },
      },
    ]);
  };

  const handleDisconnectGoogle = () => {
    Alert.alert(
      'Disconnect Google Calendar',
      'This will remove your Google Calendar connection and all synced busy times.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectGoogleCalendar();
            setGoogleLastSync(null);
          },
        },
      ]
    );
  };

  const handleDisconnectApple = async () => {
    if (!user?.id) return;
    Alert.alert(
      'Clear iCloud Calendar Data',
      'This will remove all synced busy times from iCloud Calendar. To fully revoke access, go to Settings > Privacy > Calendars.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Data',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('busy_blocks').delete().eq('user_id', user.id).eq('source', 'apple');
            setAppleLastSync(null);
          },
        },
      ]
    );
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://rally.app/privacy');
  };

  const handleTerms = () => {
    Linking.openURL('https://rally.app/terms');
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Contact Support', 'Please email support@rally.app to delete your account.');
          },
        },
      ]
    );
  };

  const handleSaveProfile = async () => {
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 40) {
      Alert.alert('Invalid Name', 'Display name must be 2-40 characters.');
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile({ display_name: trimmedName, discoverable });
      setEditingProfile(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCancelEdit = () => {
    setDisplayName(profile?.display_name || '');
    setDiscoverable(profile?.discoverable || false);
    setEditingProfile(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.tint }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Profile Section */}
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>PROFILE</Text>
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            {/* Display Name */}
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.text }]}>Display Name</Text>
              {editingProfile ? (
                <TextInput
                  style={[styles.editInput, { color: colors.text, borderColor: isDark ? '#444' : '#ddd' }]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your name"
                  placeholderTextColor={colors.icon}
                  maxLength={40}
                  autoCapitalize="words"
                />
              ) : (
                <Text style={[styles.valueSmall, { color: colors.icon }]}>
                  {profile?.display_name || 'Not set'}
                </Text>
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: isDark ? '#333' : '#eee' }]} />

            {/* Discoverable Toggle */}
            <View style={styles.row}>
              <View style={styles.toggleLabelContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Discoverable</Text>
                <Text style={[styles.toggleHint, { color: colors.icon }]}>
                  Let others find you by name
                </Text>
              </View>
              {editingProfile ? (
                <Switch
                  value={discoverable}
                  onValueChange={setDiscoverable}
                  trackColor={{ false: isDark ? '#333' : '#ddd', true: colors.tint }}
                  thumbColor="#fff"
                />
              ) : (
                <Text style={[styles.valueSmall, { color: profile?.discoverable ? '#4caf50' : colors.icon }]}>
                  {profile?.discoverable ? 'On' : 'Off'}
                </Text>
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: isDark ? '#333' : '#eee' }]} />

            {/* Edit / Save / Cancel */}
            <View style={styles.row}>
              {editingProfile ? (
                <View style={styles.editActions}>
                  <TouchableOpacity
                    style={[styles.saveBtn, { backgroundColor: colors.tint }]}
                    onPress={handleSaveProfile}
                    disabled={savingProfile}
                  >
                    {savingProfile ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>Save</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelEdit}>
                    <Text style={[styles.cancelBtnText, { color: colors.icon }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setEditingProfile(true)}>
                  <Text style={[styles.editText, { color: colors.tint }]}>Edit Profile</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Account Section */}
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>ACCOUNT</Text>
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.text }]}>Email</Text>
              <Text style={[styles.valueSmall, { color: colors.icon }]}>{user?.email}</Text>
            </View>
          </View>

          {/* Connected Calendars Section */}
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>CONNECTED CALENDARS</Text>
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            {/* Google Calendar */}
            <View style={styles.calendarRow}>
              <View style={styles.calendarLeft}>
                <Text style={[styles.calendarName, { color: colors.text }]}>Google Calendar</Text>
                {googleCalendarConnected ? (
                  <>
                    <Text style={[styles.calendarEmail, { color: colors.icon }]}>Connected</Text>
                    {googleLastSync && (
                      <Text style={[styles.syncTime, { color: colors.icon }]}>Synced {googleLastSync}</Text>
                    )}
                  </>
                ) : (
                  <Text style={[styles.calendarEmail, { color: colors.icon }]}>Not connected</Text>
                )}
              </View>
              {googleCalendarConnected && (
                <TouchableOpacity onPress={handleDisconnectGoogle}>
                  <Text style={[styles.disconnectText, { color: '#e53935' }]}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: isDark ? '#333' : '#eee' }]} />

            {/* iCloud Calendar */}
            <View style={styles.calendarRow}>
              <View style={styles.calendarLeft}>
                <Text style={[styles.calendarName, { color: colors.text }]}>iCloud Calendar</Text>
                {appleCalendarConnected ? (
                  <>
                    <Text style={[styles.calendarEmail, { color: colors.icon }]}>Device calendars</Text>
                    {appleLastSync && (
                      <Text style={[styles.syncTime, { color: colors.icon }]}>Synced {appleLastSync}</Text>
                    )}
                  </>
                ) : (
                  <Text style={[styles.calendarEmail, { color: colors.icon }]}>Not connected</Text>
                )}
              </View>
              {appleCalendarConnected && appleLastSync && (
                <TouchableOpacity onPress={handleDisconnectApple}>
                  <Text style={[styles.disconnectText, { color: '#e53935' }]}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Legal Section */}
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>LEGAL</Text>
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity style={styles.row} onPress={handlePrivacyPolicy}>
              <Text style={[styles.linkText, { color: colors.text }]}>Privacy Policy</Text>
              <Text style={[styles.chevron, { color: colors.icon }]}>›</Text>
            </TouchableOpacity>
            <View style={[styles.divider, { backgroundColor: isDark ? '#333' : '#eee' }]} />
            <TouchableOpacity style={styles.row} onPress={handleTerms}>
              <Text style={[styles.linkText, { color: colors.text }]}>Terms of Service</Text>
              <Text style={[styles.chevron, { color: colors.icon }]}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Danger Zone */}
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>DANGER ZONE</Text>
          <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity style={styles.row} onPress={handleDeleteAccount}>
              <Text style={styles.dangerText}>Delete Account</Text>
              <Text style={[styles.chevron, { color: '#e53935' }]}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Sign Out */}
          <TouchableOpacity
            style={[styles.signOutButton, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}
            onPress={handleSignOut}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <Text style={[styles.version, { color: colors.icon }]}>Rally v1.0.0</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 24, fontWeight: '700' },
  closeButton: { padding: 8 },
  closeText: { fontSize: 16, fontWeight: '600' },
  content: { flex: 1, paddingHorizontal: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  calendarLeft: { flex: 1 },
  calendarName: { fontSize: 15, fontWeight: '500' },
  calendarEmail: { fontSize: 13, marginTop: 2 },
  syncTime: { fontSize: 11, marginTop: 2 },
  disconnectText: { fontSize: 14, fontWeight: '500' },
  label: { fontSize: 15, fontWeight: '500' },
  valueSmall: { fontSize: 13 },
  linkText: { fontSize: 15, fontWeight: '500' },
  chevron: { fontSize: 20, fontWeight: '300' },
  divider: { height: 1, marginLeft: 16 },
  dangerText: { fontSize: 15, fontWeight: '500', color: '#e53935' },
  signOutButton: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#e53935', fontSize: 16, fontWeight: '600' },
  version: { textAlign: 'center', fontSize: 12, marginTop: 24, marginBottom: 40 },

  // Profile editing styles
  editInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    marginLeft: 12,
    textAlign: 'right',
  },
  toggleLabelContainer: {
    flex: 1,
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  editText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
