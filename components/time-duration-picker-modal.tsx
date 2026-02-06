import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

const ITEM_HEIGHT = 50;
const VISIBLE_ITEMS = 5;

interface TimeDurationPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (selectedTime: Date, durationMinutes: number) => void;
  initialDate: Date;
  initialDuration?: number;
  minTime?: Date;
  maxTime?: Date;
}

export function TimeDurationPickerModal({
  visible,
  onClose,
  onConfirm,
  initialDate,
  initialDuration = 60,
  minTime,
  maxTime,
}: TimeDurationPickerModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [selectedHour, setSelectedHour] = useState(initialDate.getHours());
  const [selectedMinute, setSelectedMinute] = useState(initialDate.getMinutes());
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);
  const durationScrollRef = useRef<ScrollView>(null);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const durations = [1, 3, 5, 30, 45, 60, 90, 120];

  useEffect(() => {
    if (visible) {
      const hour = initialDate.getHours();
      const minute = initialDate.getMinutes();
      const duration = initialDuration;
      
      setSelectedHour(hour);
      setSelectedMinute(minute);
      setSelectedDuration(duration);
      
      setTimeout(() => {
        hourScrollRef.current?.scrollTo({ y: hour * ITEM_HEIGHT, animated: false });
        minuteScrollRef.current?.scrollTo({ y: minute * ITEM_HEIGHT, animated: false });
        const durationIndex = durations.indexOf(duration);
        if (durationIndex >= 0) {
          durationScrollRef.current?.scrollTo({ y: durationIndex * ITEM_HEIGHT, animated: false });
        }
      }, 100);
    }
  }, [visible, initialDate, initialDuration]);

  const handleHourScroll = (event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const hour = Math.max(0, Math.min(23, index));
    setSelectedHour(hour);
  };

  const handleMinuteScroll = (event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const minute = Math.max(0, Math.min(59, index));
    setSelectedMinute(minute);
  };

  const handleDurationScroll = (event: any) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const duration = durations[Math.max(0, Math.min(durations.length - 1, index))];
    setSelectedDuration(duration);
  };

  const handleConfirm = () => {
    const selectedDate = new Date(initialDate);
    selectedDate.setHours(selectedHour, selectedMinute, 0, 0);
    
    if (minTime && selectedDate < minTime) {
      selectedDate.setTime(minTime.getTime());
    }
    if (maxTime && selectedDate > maxTime) {
      selectedDate.setTime(maxTime.getTime());
    }
    
    onConfirm(selectedDate, selectedDuration);
  };

  const renderPicker = (
    data: number[],
    selectedValue: number,
    onScroll: (event: any) => void,
    scrollRef: React.RefObject<ScrollView>,
    formatLabel: (value: number) => string
  ) => {
    return (
      <View style={styles.pickerContainer}>
        <View style={styles.pickerOverlay} />
        <ScrollView
          ref={scrollRef}
          style={styles.pickerScroll}
          contentContainerStyle={styles.pickerContent}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          onMomentumScrollEnd={onScroll}
          onScrollEndDrag={onScroll}
        >
          {Array.from({ length: VISIBLE_ITEMS / 2 }).map((_, i) => (
            <View key={`spacer-top-${i}`} style={styles.pickerItem} />
          ))}
          
          {data.map((value, index) => (
            <View key={index} style={styles.pickerItem}>
              <Text
                style={[
                  styles.pickerItemText,
                  {
                    color: selectedValue === value ? colors.text : colors.icon,
                    fontWeight: selectedValue === value ? '600' : '400',
                    fontSize: selectedValue === value ? 18 : 16,
                  },
                ]}
              >
                {formatLabel(value)}
              </Text>
            </View>
          ))}
          
          {Array.from({ length: VISIBLE_ITEMS / 2 }).map((_, i) => (
            <View key={`spacer-bottom-${i}`} style={styles.pickerItem} />
          ))}
        </ScrollView>
        <View style={styles.pickerOverlay} />
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContentWrapper}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Select Match Time & Duration
            </Text>

            <View style={styles.pickersRow}>
              <View style={styles.pickerColumn}>
                <Text style={[styles.pickerLabel, { color: colors.icon }]}>Hour</Text>
                {renderPicker(
                  hours,
                  selectedHour,
                  handleHourScroll,
                  hourScrollRef,
                  (h) => h.toString().padStart(2, '0')
                )}
              </View>

              <View style={styles.pickerColumn}>
                <Text style={[styles.pickerLabel, { color: colors.icon }]}>Minute</Text>
                {renderPicker(
                  minutes,
                  selectedMinute,
                  handleMinuteScroll,
                  minuteScrollRef,
                  (m) => m.toString().padStart(2, '0')
                )}
              </View>

              <View style={styles.pickerColumn}>
                <Text style={[styles.pickerLabel, { color: colors.icon }]}>Duration</Text>
                {renderPicker(
                  durations,
                  selectedDuration,
                  handleDurationScroll,
                  durationScrollRef,
                  (d) => `${d} min`
                )}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton, { backgroundColor: isDark ? '#2a2a2a' : '#f0f0f0' }]}
                onPress={onClose}
              >
                <Text style={[styles.actionButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.confirmButton, { backgroundColor: colors.tint }]}
                onPress={handleConfirm}
              >
                <Text style={[styles.actionButtonText, { color: '#fff' }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContentWrapper: {
    zIndex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 20,
    maxHeight: Dimensions.get('window').height * 0.7,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ccc',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
  },
  pickersRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 32,
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
  },
  pickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerContainer: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    position: 'relative',
    width: '100%',
  },
  pickerOverlay: {
    position: 'absolute',
    top: ITEM_HEIGHT * 2,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    zIndex: 1,
    pointerEvents: 'none',
    borderRadius: 8,
  },
  pickerScroll: {
    flex: 1,
  },
  pickerContent: {
    paddingVertical: 0,
  },
  pickerItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerItemText: {
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {},
  confirmButton: {},
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
