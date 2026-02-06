import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Option = {
  label: string;
  value: string;
};

type InlinePickerProps = {
  label: string;
  options: Option[];
  selectedValue: string;
  onValueChange: (value: string) => void;
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

export function InlinePicker({ label, options, selectedValue, onValueChange }: InlinePickerProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [showPicker, setShowPicker] = useState(false);
  const [tempValue, setTempValue] = useState(selectedValue);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const scrollRef = useRef<ScrollView>(null);

  const selectedLabel = options.find(o => o.value === selectedValue)?.label || '';
  const selectedIndex = options.findIndex(o => o.value === tempValue);

  useEffect(() => {
    if (showPicker && scrollRef.current) {
      const index = options.findIndex(o => o.value === tempValue);
      if (index >= 0) {
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
        }, 50);
      }
    }
  }, [showPicker, tempValue, options]);

  const openPicker = () => {
    setTempValue(selectedValue);
    setShowPicker(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closePicker = (confirm: boolean) => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setShowPicker(false);
      if (confirm) {
        onValueChange(tempValue);
      }
    });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(index, options.length - 1));
    if (options[clampedIndex] && options[clampedIndex].value !== tempValue) {
      setTempValue(options[clampedIndex].value);
    }
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(index, options.length - 1));
    scrollRef.current?.scrollTo({ y: clampedIndex * ITEM_HEIGHT, animated: true });
    if (options[clampedIndex]) {
      setTempValue(options[clampedIndex].value);
    }
  };

  const selectItem = (index: number) => {
    scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
    setTempValue(options[index].value);
  };

  // Padding items for centering
  const paddingItems = Math.floor(VISIBLE_ITEMS / 2);

  return (
    <>
      <View style={styles.container}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <TouchableOpacity onPress={openPicker} activeOpacity={0.7}>
          <View style={[styles.valueContainer, { borderBottomColor: colors.tint }]}>
            <Text style={[styles.value, { color: colors.tint }]}>{selectedLabel}</Text>
            <Text style={[styles.chevron, { color: colors.tint }]}>▼</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal visible={showPicker} transparent animationType="none">
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => closePicker(false)}
          />
          <Animated.View
            style={[
              styles.pickerSheet,
              {
                backgroundColor: isDark ? '#1c1c1e' : '#fff',
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={[styles.pickerHeader, { borderBottomColor: isDark ? '#333' : '#e0e0e0' }]}>
              <TouchableOpacity onPress={() => closePicker(false)} style={styles.headerButton}>
                <Text style={[styles.headerButtonText, { color: colors.icon }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => closePicker(true)} style={styles.headerButton}>
                <Text style={[styles.headerButtonText, { color: colors.tint, fontWeight: '600' }]}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.pickerContainer}>
              {/* Selection indicator */}
              <View
                style={[
                  styles.selectionIndicator,
                  {
                    backgroundColor: isDark ? '#333' : '#f0f0f0',
                    top: paddingItems * ITEM_HEIGHT,
                  }
                ]}
              />

              <ScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}
                decelerationRate="fast"
                onScroll={handleScroll}
                onMomentumScrollEnd={handleMomentumEnd}
                scrollEventThrottle={16}
                contentContainerStyle={{
                  paddingTop: paddingItems * ITEM_HEIGHT,
                  paddingBottom: paddingItems * ITEM_HEIGHT,
                }}
              >
                {options.map((option, index) => {
                  const isSelected = option.value === tempValue;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={styles.pickerItem}
                      onPress={() => selectItem(index)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          { color: isSelected ? colors.text : colors.icon },
                          isSelected && styles.pickerItemTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  label: {
    fontSize: 22,
    fontWeight: '400',
    marginRight: 10,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    paddingBottom: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 12,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  headerButtonText: {
    fontSize: 17,
  },
  pickerContainer: {
    height: PICKER_HEIGHT,
    overflow: 'hidden',
  },
  selectionIndicator: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: ITEM_HEIGHT,
    borderRadius: 10,
  },
  pickerItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerItemText: {
    fontSize: 20,
  },
  pickerItemTextSelected: {
    fontWeight: '600',
  },
});
