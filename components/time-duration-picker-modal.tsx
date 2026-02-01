import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  PanResponder,
  Animated,
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
  const [selectedMinute, setSelectedMinute] = useState(Math.floor(initialDate.getMinutes() / 15) * 15);
  const [selectedDuration, setSelectedDuration] = useState(initialDuration);

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);
  const durationScrollRef = useRef<ScrollView>(null);

  // Generate hours (0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  // Generate minutes (0-59) - all 60 minutes for testing
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  
  // Generate duration options (1, 30, 45, 60, 90, 120 minutes)
  // 1 minute added for testing purposes
  const durations = [1, 30, 45, 60, 90, 120];

  // Animation for drawer swipe
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        // Only activate if touch is on the handle or title area (top 80px)
        const { locationY } = evt.nativeEvent;
        return locationY < 80;
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward swipes (not horizontal scrolling on pickers)
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          // Swipe down to dismiss
          Animated.timing(translateY, {
            toValue: Dimensions.get('window').height,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onClose();
            translateY.setValue(0);
          });
        } else {
          // Snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      const hour = initialDate.getHours();
      const minute = initialDate.getMinutes(); // Use exact minute now
      const duration = initialDuration;
      
      setSelectedHour(hour);
      setSelectedMinute(minute);
      setSelectedDuration(duration);
      
      // Reset animation
      translateY.setValue(0);
      
      // Scroll to initial positions after a short delay
      setTimeout(() => {
        hourScrollRef.current?.scrollTo({ y: hour * ITEM_HEIGHT, animated: false });
        const minuteIndex = minutes.indexOf(minute);
        if (minuteIndex >= 0) {
          minuteScrollRef.current?.scrollTo({ y: minuteIndex * ITEM_HEIGHT, animated: false });
        }
        const durationIndex = durations.indexOf(duration);
        if (durationIndex >= 0) {
          durationScrollRef.current?.scrollTo({ y: durationIndex * ITEM_HEIGHT, animated: false });
        }
      }, 100);
    } else {
      // Reset animation when closing
      translateY.setValue(0);
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
    const minute = Math.max(0, Math.min(59, index)); // 0-59 minutes
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
    
    // Validate against min/max time if provided
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
    const selectedIndex = data.indexOf(selectedValue);
    
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
          {/* Spacer items */}
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
          
          {/* Spacer items */}
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
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          <Animated.View
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? '#1a1a1a' : '#fff' },
              {
                transform: [{ translateY: translateY }],
              },
            ]}
          >
            <View 
              style={styles.handleContainer}
              {...panResponder.panHandlers}
            >
              <View style={styles.modalHandle} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Select Match Time & Duration
              </Text>
            </View>

          <View style={styles.pickersRow}>
            {/* Hour Picker */}
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

            {/* Minute Picker */}
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

            {/* Duration Picker */}
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
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 20,
    maxHeight: Dimensions.get('window').height * 0.7,
  },
  handleContainer: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ccc',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
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
