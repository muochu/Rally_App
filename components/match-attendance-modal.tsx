import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import type { Proposal } from '@/lib/types';

interface MatchAttendanceModalProps {
  visible: boolean;
  proposal: Proposal | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function MatchAttendanceModal({
  visible,
  proposal,
  onConfirm,
  onDismiss,
}: MatchAttendanceModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();

  if (!proposal || !user) return null;

  // Determine opponent based on current user
  const opponent = proposal.from_user_id === user.id
    ? proposal.to_user
    : proposal.from_user;
  const opponentName = opponent?.display_name || opponent?.email?.split('@')[0] || 'your opponent';
  const courtName = proposal.court?.name || 'the court';

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
          <Text style={[styles.emoji, { color: colors.text }]}>🎾</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Match Time!
          </Text>
          <Text style={[styles.message, { color: colors.icon }]}>
            Your match with {opponentName} at {courtName} is starting now.
          </Text>
          <Text style={[styles.timeText, { color: colors.text }]}>
            {formatTime(proposal.start_ts_utc)} - {formatTime(proposal.end_ts_utc)}
          </Text>
          <Text style={[styles.question, { color: colors.text }]}>
            Are you at the court?
          </Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.dismissButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
              onPress={onDismiss}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Not Yet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton, { backgroundColor: colors.tint }]}
              onPress={onConfirm}
            >
              <Text style={[styles.buttonText, { color: '#fff' }]}>Yes, I'm Here</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 22,
  },
  timeText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  question: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  dismissButton: {},
  confirmButton: {},
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
