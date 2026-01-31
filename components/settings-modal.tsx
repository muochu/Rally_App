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
  const { user, signOut, googleCalendarConnected, disconnectGoogleCalendar } = useAuth();
  const [appleCalendarConnected, setAppleCalendarConnected] = useState(false);
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null);
  const [appleLastSync, setAppleLastSync] = useState<string | null>(null);

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
});
