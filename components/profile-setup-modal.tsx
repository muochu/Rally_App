import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

type Props = {
  visible: boolean;
  onComplete: (displayName: string, discoverable: boolean) => Promise<void>;
};

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;

export function ProfileSetupModal({ visible, onComplete }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [displayName, setDisplayName] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = displayName.trim();
  const isValid = trimmedName.length >= MIN_NAME_LENGTH && trimmedName.length <= MAX_NAME_LENGTH;

  const handleSave = async () => {
    if (!isValid || saving) return;

    setSaving(true);
    setError(null);

    try {
      await onComplete(trimmedName, discoverable);
    } catch (e: any) {
      setError(e?.message || 'Failed to save profile');
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.emoji}>👋</Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Complete your profile
            </Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              Set a display name so friends can find you on Rally
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Display Name Input */}
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.text }]}>Display Name</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5',
                    color: colors.text,
                    borderColor: error ? '#e53935' : 'transparent',
                  },
                ]}
                placeholder="Enter your name"
                placeholderTextColor={colors.icon}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={MAX_NAME_LENGTH}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
              />
              <Text style={[styles.hint, { color: colors.icon }]}>
                {trimmedName.length}/{MAX_NAME_LENGTH} characters
                {trimmedName.length > 0 && trimmedName.length < MIN_NAME_LENGTH && ' (min 2)'}
              </Text>
            </View>

            {/* Discoverable Toggle */}
            <View style={[styles.toggleRow, { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' }]}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>
                  Make me discoverable
                </Text>
                <Text style={[styles.toggleHint, { color: colors.icon }]}>
                  Others can find you by name or email
                </Text>
              </View>
              <Switch
                value={discoverable}
                onValueChange={setDiscoverable}
                trackColor={{ false: isDark ? '#333' : '#ddd', true: colors.tint }}
                thumbColor="#fff"
              />
            </View>

            {/* Privacy Note */}
            <Text style={[styles.privacyNote, { color: colors.icon }]}>
              You can change these settings anytime in Settings.
            </Text>

            {/* Error */}
            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: isValid ? colors.tint : isDark ? '#333' : '#ddd' },
            ]}
            onPress={handleSave}
            disabled={!isValid || saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.saveButtonText, { color: isValid ? '#fff' : colors.icon }]}>
                Continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    flex: 1,
  },
  field: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  hint: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  toggleHint: {
    fontSize: 13,
    marginTop: 2,
  },
  privacyNote: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  errorText: {
    color: '#e53935',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  saveButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
