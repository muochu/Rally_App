import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  PanResponder,
  Animated,
} from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AvailabilityWindow } from '@/lib/types';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type WeekRingsProps = {
  availability: AvailabilityWindow[];
  onDeleteSlot?: (id: string) => void;
  showMonthToggle?: boolean;
};

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(weekOffset: number = 0): Date[] {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const monday = new Date(today);
  // Adjust to Monday (if Sunday, go back 6 days, otherwise go back dayOfWeek - 1)
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  monday.setDate(today.getDate() - daysFromMonday + (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function getWeekLabel(weekOffset: number, firstDate: Date, lastDate: Date): string {
  if (weekOffset === 0) return 'This Week';
  if (weekOffset === 1) return 'Next Week';
  if (weekOffset === -1) return 'Last Week';

  const monthStart = firstDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const monthEnd = lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${monthStart} - ${monthEnd}`;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Break down availability window into hourly chunks
function getHourlyChunks(slot: AvailabilityWindow): Date[] {
  const start = new Date(slot.start_ts_utc);
  const end = new Date(slot.end_ts_utc);
  const hours: Date[] = [];
  
  // Start from the beginning of the start hour
  const startHour = new Date(start);
  startHour.setMinutes(0, 0, 0);
  
  // Generate hourly chunks from start to end
  let currentHour = new Date(startHour);
  while (currentHour < end) {
    // Only include hours that overlap with the actual slot
    const hourEnd = new Date(currentHour);
    hourEnd.setHours(hourEnd.getHours() + 1);
    
    // Check if this hour overlaps with the slot
    if (currentHour < end && hourEnd > start) {
      hours.push(new Date(currentHour));
    }
    
    currentHour.setHours(currentHour.getHours() + 1);
  }
  
  return hours;
}

function getMonthDates(monthOffset: number = 0): Date[] {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);

  // Get the Monday of the week containing the first of the month
  const startDay = firstOfMonth.getDay();
  const daysFromMonday = startDay === 0 ? 6 : startDay - 1;
  const startDate = new Date(firstOfMonth);
  startDate.setDate(firstOfMonth.getDate() - daysFromMonday);

  const dates: Date[] = [];
  // Generate 6 weeks (42 days) to cover any month layout
  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function getMonthLabel(monthOffset: number): string {
  const today = new Date();
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  return month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function WeekRings({ availability, onDeleteSlot, showMonthToggle }: WeekRingsProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const translateX = useRef(new Animated.Value(0)).current;

  const weekDates = getWeekDates(weekOffset);
  const monthDates = getMonthDates(monthOffset);
  const today = new Date();
  const weekLabel = getWeekLabel(weekOffset, weekDates[0], weekDates[6]);
  const monthLabel = getMonthLabel(monthOffset);
  const currentMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1).getMonth();

  // Swipe gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        const SWIPE_THRESHOLD = 50;

        if (gestureState.dx < -SWIPE_THRESHOLD) {
          // Swipe left - go to next week
          Animated.timing(translateX, {
            toValue: -300,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            setWeekOffset((prev) => prev + 1);
            setSelectedDayIndex(null);
            translateX.setValue(0);
          });
        } else if (gestureState.dx > SWIPE_THRESHOLD) {
          // Swipe right - go to previous week
          Animated.timing(translateX, {
            toValue: 300,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            setWeekOffset((prev) => prev - 1);
            setSelectedDayIndex(null);
            translateX.setValue(0);
          });
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Group availability by day
  const availabilityByDay: Map<number, AvailabilityWindow[]> = new Map();
  for (let i = 0; i < 7; i++) {
    availabilityByDay.set(i, []);
  }

  availability.forEach((slot) => {
    const slotStart = new Date(slot.start_ts_utc);
    weekDates.forEach((date, index) => {
      if (isSameDay(slotStart, date)) {
        availabilityByDay.get(index)?.push(slot);
      }
    });
  });

  const handleDayPress = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedDayIndex === index) {
      setSelectedDayIndex(null);
    } else {
      setSelectedDayIndex(index);
    }
  };

  const selectedSlots = selectedDayIndex !== null ? availabilityByDay.get(selectedDayIndex) || [] : [];
  const selectedDate = selectedDayIndex !== null ? weekDates[selectedDayIndex] : null;

  // Month view: group availability by date string
  const availabilityByDateStr: Map<string, AvailabilityWindow[]> = new Map();
  availability.forEach((slot) => {
    const dateStr = new Date(slot.start_ts_utc).toDateString();
    if (!availabilityByDateStr.has(dateStr)) {
      availabilityByDateStr.set(dateStr, []);
    }
    availabilityByDateStr.get(dateStr)?.push(slot);
  });

  const [selectedMonthDate, setSelectedMonthDate] = useState<Date | null>(null);

  const goToPrevious = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (viewMode === 'week') {
      setWeekOffset((prev) => prev - 1);
    } else {
      setMonthOffset((prev) => prev - 1);
    }
    setSelectedDayIndex(null);
    setSelectedMonthDate(null);
  };

  const goToNext = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (viewMode === 'week') {
      setWeekOffset((prev) => prev + 1);
    } else {
      setMonthOffset((prev) => prev + 1);
    }
    setSelectedDayIndex(null);
    setSelectedMonthDate(null);
  };

  const goToToday = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setWeekOffset(0);
    setMonthOffset(0);
    setSelectedDayIndex(null);
    setSelectedMonthDate(null);
  };

  const toggleViewMode = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setViewMode((prev) => prev === 'week' ? 'month' : 'week');
    setSelectedDayIndex(null);
    setSelectedMonthDate(null);
  };

  const handleMonthDayPress = (date: Date) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedMonthDate && isSameDay(selectedMonthDate, date)) {
      setSelectedMonthDate(null);
    } else {
      setSelectedMonthDate(date);
    }
  };

  const isNotCurrentPeriod = viewMode === 'week' ? weekOffset !== 0 : monthOffset !== 0;
  const currentLabel = viewMode === 'week' ? weekLabel : monthLabel;
  const selectedMonthSlots = selectedMonthDate
    ? availabilityByDateStr.get(selectedMonthDate.toDateString()) || []
    : [];

  return (
    <View style={styles.container}>
      {/* Navigation header */}
      <View style={styles.weekHeader}>
        <TouchableOpacity onPress={goToPrevious} style={styles.navButton}>
          <Text style={[styles.navArrow, { color: colors.tint }]}>‹</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={isNotCurrentPeriod ? goToToday : undefined} activeOpacity={isNotCurrentPeriod ? 0.7 : 1}>
          <Text style={[styles.weekLabel, { color: colors.text }]}>{currentLabel}</Text>
          {isNotCurrentPeriod && (
            <Text style={[styles.todayLink, { color: colors.tint }]}>Back to today</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={goToNext} style={styles.navButton}>
          <Text style={[styles.navArrow, { color: colors.tint }]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Week/Month toggle */}
      {showMonthToggle && (
        <View style={styles.viewToggleContainer}>
          <TouchableOpacity
            style={[styles.viewToggleButton, viewMode === 'week' && { backgroundColor: colors.tint }]}
            onPress={() => viewMode !== 'week' && toggleViewMode()}
          >
            <Text style={[styles.viewToggleText, { color: viewMode === 'week' ? '#fff' : colors.text }]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewToggleButton, viewMode === 'month' && { backgroundColor: colors.tint }]}
            onPress={() => viewMode !== 'month' && toggleViewMode()}
          >
            <Text style={[styles.viewToggleText, { color: viewMode === 'month' ? '#fff' : colors.text }]}>Month</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Week view */}
      {viewMode === 'week' && (
        <>
          <Animated.View
            {...panResponder.panHandlers}
            style={[styles.ringsRow, { transform: [{ translateX }] }]}
          >
            {weekDates.map((date, index) => {
              const slots = availabilityByDay.get(index) || [];
              const hasAvailability = slots.length > 0;
              const isToday = isSameDay(date, today);
              const isSelected = selectedDayIndex === index;
              const isPast = date < today && !isToday;

              return (
                <TouchableOpacity
                  key={index}
                  style={styles.dayContainer}
                  onPress={() => handleDayPress(index)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      { color: isToday ? colors.tint : colors.icon },
                      isSelected && { color: colors.tint, fontWeight: '700' },
                    ]}
                  >
                    {DAYS[index]}
                  </Text>
                  <View
                    style={[
                      styles.ring,
                      {
                        borderColor: hasAvailability
                          ? '#34C759'
                          : isPast
                            ? isDark ? '#333' : '#e0e0e0'
                            : isDark ? '#444' : '#d0d0d0',
                      },
                      hasAvailability && styles.ringFilled,
                      isSelected && styles.ringSelected,
                      isToday && !hasAvailability && { borderColor: colors.tint },
                    ]}
                  >
                    {hasAvailability && (
                      <View style={[styles.ringInner, { backgroundColor: '#34C759' }]}>
                        <Text style={styles.slotCount}>{slots.length}</Text>
                      </View>
                    )}
                    {isToday && !hasAvailability && (
                      <View style={[styles.todayDot, { backgroundColor: colors.tint }]} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.dateLabel,
                      { color: colors.icon },
                      isToday && { color: colors.tint, fontWeight: '600' },
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Animated.View>

          {/* Expanded day details - Week view */}
          {selectedDayIndex !== null && (
            <View style={[styles.expandedSection, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
              <Text style={[styles.expandedTitle, { color: colors.text }]}>
                {DAY_NAMES[selectedDayIndex]}, {selectedDate?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
              {selectedSlots.length === 0 ? (
                <Text style={[styles.noSlotsText, { color: colors.icon }]}>No availability</Text>
              ) : (
                <View style={styles.slotsContainer}>
                  {selectedSlots.map((slot) => {
                    const hourlyChunks = getHourlyChunks(slot);
                    return (
                      <View key={slot.id} style={styles.slotGroup}>
                        <View style={styles.hourBubblesContainer}>
                          {hourlyChunks.map((hour, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.hourBubble,
                                { backgroundColor: '#34C759' },
                                idx === 0 && styles.hourBubbleFirst,
                                idx === hourlyChunks.length - 1 && styles.hourBubbleLast,
                              ]}
                            >
                              <Text style={styles.hourBubbleText}>
                                {hour.getHours() % 12 || 12}{hour.getHours() >= 12 ? 'pm' : 'am'}
                              </Text>
                            </View>
                          ))}
                        </View>
                        {onDeleteSlot && (
                          <TouchableOpacity style={styles.deleteButton} onPress={() => onDeleteSlot(slot.id)}>
                            <Text style={styles.deleteButtonText}>×</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* Month view */}
      {viewMode === 'month' && (
        <>
          {/* Day labels */}
          <View style={styles.monthDayLabels}>
            {DAYS.map((day, i) => (
              <Text key={i} style={[styles.monthDayLabel, { color: colors.icon }]}>{day}</Text>
            ))}
          </View>

          {/* Month grid */}
          <View style={styles.monthGrid}>
            {monthDates.slice(0, 35).map((date, index) => {
              const isCurrentMonth = date.getMonth() === currentMonth;
              const hasAvail = availabilityByDateStr.has(date.toDateString());
              const slotCount = availabilityByDateStr.get(date.toDateString())?.length || 0;
              const isToday = isSameDay(date, today);
              const isSelected = selectedMonthDate && isSameDay(selectedMonthDate, date);
              const isPast = date < today && !isToday;

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.monthDay,
                    !isCurrentMonth && styles.monthDayOther,
                  ]}
                  onPress={() => handleMonthDayPress(date)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.monthDayCircle,
                      hasAvail && { backgroundColor: '#34C759' },
                      isToday && !hasAvail && { borderWidth: 2, borderColor: colors.tint },
                      isSelected && { transform: [{ scale: 1.1 }] },
                      isPast && !hasAvail && { opacity: 0.4 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthDayText,
                        { color: hasAvail ? '#fff' : isCurrentMonth ? colors.text : colors.icon },
                        isToday && !hasAvail && { color: colors.tint, fontWeight: '700' },
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                  {hasAvail && slotCount > 1 && (
                    <Text style={styles.monthSlotCount}>{slotCount}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Expanded day details - Month view */}
          {selectedMonthDate && (
            <View style={[styles.expandedSection, { backgroundColor: isDark ? '#1a1a1a' : '#f8f8f8' }]}>
              <Text style={[styles.expandedTitle, { color: colors.text }]}>
                {selectedMonthDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
              {selectedMonthSlots.length === 0 ? (
                <Text style={[styles.noSlotsText, { color: colors.icon }]}>No availability</Text>
              ) : (
                <View style={styles.slotsContainer}>
                  {selectedMonthSlots.map((slot) => {
                    const hourlyChunks = getHourlyChunks(slot);
                    return (
                      <View key={slot.id} style={styles.slotGroup}>
                        <View style={styles.hourBubblesContainer}>
                          {hourlyChunks.map((hour, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.hourBubble,
                                { backgroundColor: '#34C759' },
                                idx === 0 && styles.hourBubbleFirst,
                                idx === hourlyChunks.length - 1 && styles.hourBubbleLast,
                              ]}
                            >
                              <Text style={styles.hourBubbleText}>
                                {hour.getHours() % 12 || 12}{hour.getHours() >= 12 ? 'pm' : 'am'}
                              </Text>
                            </View>
                          ))}
                        </View>
                        {onDeleteSlot && (
                          <TouchableOpacity style={styles.deleteButton} onPress={() => onDeleteSlot(slot.id)}>
                            <Text style={styles.deleteButtonText}>×</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  navButton: {
    padding: 8,
  },
  navArrow: {
    fontSize: 28,
    fontWeight: '300',
  },
  weekLabel: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  todayLink: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  ringsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  dayContainer: {
    alignItems: 'center',
    flex: 1,
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  ring: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringFilled: {
    borderWidth: 0,
  },
  ringSelected: {
    transform: [{ scale: 1.1 }],
  },
  ringInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCount: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dateLabel: {
    fontSize: 11,
    marginTop: 6,
  },
  expandedSection: {
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  expandedTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  noSlotsText: {
    fontSize: 14,
  },
  slotsContainer: {
    gap: 14,
  },
  slotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  hourBubblesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  hourBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  hourBubbleFirst: {
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  hourBubbleLast: {
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },
  hourBubbleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 20,
    fontWeight: '600',
    marginTop: -2,
  },
  viewToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8,
  },
  viewToggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '500',
  },
  monthDayLabels: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  monthDayLabel: {
    fontSize: 12,
    fontWeight: '600',
    width: 40,
    textAlign: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
  },
  monthDay: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  monthDayOther: {
    opacity: 0.35,
  },
  monthDayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDayText: {
    fontSize: 14,
    fontWeight: '500',
  },
  monthSlotCount: {
    fontSize: 9,
    fontWeight: '700',
    color: '#34C759',
    position: 'absolute',
    bottom: 2,
  },
});
