import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/use-auth';
import { Colors } from '@/constants/theme';
import { bookingsApi, supabase } from '@/lib/supabase';
import { addBookingToCalendar, requestCalendarPermission, getCalendarPermissionStatus } from '@/lib/calendar';
import { formatTimeSlot, toTimeSlot } from '@/lib/scheduling';
import type { Booking } from '@/lib/types';

export default function BookingDetailScreen() {
  const { id, isProposalId } = useLocalSearchParams<{ id: string; isProposalId?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useAuth();
  const router = useRouter();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [addedToCalendar, setAddedToCalendar] = useState(false);

  useEffect(() => {
    loadBooking();
  }, [id, isProposalId]);

  const loadBooking = async () => {
    if (!id) {
      setError('No booking ID provided');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let bookingData: Booking | null = null;

      if (isProposalId === 'true') {
        // Fetch booking by proposal ID
        const { data, error: fetchError } = await supabase
          .from('bookings')
          .select(`
            *,
            court:courts(*),
            proposal:proposals(
              *,
              from_user:profiles!proposals_from_user_id_fkey(email, display_name),
              to_user:profiles!proposals_to_user_id_fkey(email, display_name)
            )
          `)
          .eq('proposal_id', id)
          .single();

        if (fetchError) throw fetchError;
        bookingData = data;
      } else {
        bookingData = await bookingsApi.get(id);
      }

      if (!bookingData) {
        setError('Booking not found');
      } else {
        setBooking(bookingData);
      }
    } catch (err) {
      console.error('Failed to load booking:', err);
      setError('Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCalendar = async () => {
    if (!booking) return;

    try {
      setAddingToCalendar(true);

      let permission = await getCalendarPermissionStatus();
      if (permission !== 'granted') {
        permission = await requestCalendarPermission();
        if (permission !== 'granted') {
          Alert.alert('Permission Required', 'Calendar access is needed to add this event.');
          return;
        }
      }

      await addBookingToCalendar(booking);
      setAddedToCalendar(true);

      Alert.alert('Added to Calendar', 'The tennis match has been added to your calendar.');
    } catch (err) {
      console.error('Failed to add to calendar:', err);
      Alert.alert('Error', 'Failed to add event to calendar. Please try again.');
    } finally {
      setAddingToCalendar(false);
    }
  };

  const getOtherParticipant = () => {
    if (!booking?.proposal || !user) return null;

    const proposal = booking.proposal;
    if (proposal.from_user_id === user.id) {
      return proposal.to_user;
    }
    return proposal.from_user;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (startString: string, endString: string) => {
    const start = new Date(startString);
    const end = new Date(endString);
    const options: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
    };
    return `${start.toLocaleTimeString(undefined, options)} - ${end.toLocaleTimeString(undefined, options)}`;
  };

  const getDuration = () => {
    if (!booking) return '';
    const start = new Date(booking.start_ts_utc);
    const end = new Date(booking.end_ts_utc);
    const minutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    return `${minutes} minutes`;
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Booking', headerShown: true }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !booking) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Booking', headerShown: true }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error ?? 'Booking not found'}</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={[styles.backLink, { color: colors.tint }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const otherParticipant = getOtherParticipant();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Booking Confirmed',
          headerShown: true,
          headerBackTitle: 'Back',
        }}
      />

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Confirmed Badge */}
        <View style={[styles.confirmedBadge, { backgroundColor: '#4caf50' }]}>
          <Text style={styles.confirmedText}>Confirmed</Text>
        </View>

        {/* Court Info */}
        <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? '#222' : '#f9f9f9' }]}>
          <Text style={[styles.cardLabel, { color: colors.icon }]}>Court</Text>
          <Text style={[styles.courtName, { color: colors.text }]}>
            {booking.court?.name ?? 'Unknown Court'}
          </Text>
          {booking.court?.address && (
            <Text style={[styles.courtAddress, { color: colors.icon }]}>
              {booking.court.address}
            </Text>
          )}
          {booking.court?.surface && (
            <View style={styles.courtMeta}>
              <View style={[styles.tag, { backgroundColor: colors.icon + '30' }]}>
                <Text style={[styles.tagText, { color: colors.text }]}>
                  {booking.court.surface.charAt(0).toUpperCase() + booking.court.surface.slice(1)}
                </Text>
              </View>
              {booking.court.lights && (
                <View style={[styles.tag, { backgroundColor: colors.icon + '30' }]}>
                  <Text style={[styles.tagText, { color: colors.text }]}>Lights</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Time Info */}
        <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? '#222' : '#f9f9f9' }]}>
          <Text style={[styles.cardLabel, { color: colors.icon }]}>Date & Time</Text>
          <Text style={[styles.dateText, { color: colors.text }]}>
            {formatDate(booking.start_ts_utc)}
          </Text>
          <Text style={[styles.timeText, { color: colors.text }]}>
            {formatTime(booking.start_ts_utc, booking.end_ts_utc)}
          </Text>
          <Text style={[styles.durationText, { color: colors.icon }]}>
            {getDuration()}
          </Text>
        </View>

        {/* Participant Info */}
        {otherParticipant && (
          <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? '#222' : '#f9f9f9' }]}>
            <Text style={[styles.cardLabel, { color: colors.icon }]}>Playing With</Text>
            <Text style={[styles.participantName, { color: colors.text }]}>
              {otherParticipant.display_name || otherParticipant.email}
            </Text>
          </View>
        )}

        {/* Add to Calendar Button */}
        <TouchableOpacity
          style={[
            styles.calendarButton,
            { backgroundColor: colors.tint },
            addedToCalendar && styles.calendarButtonDisabled,
          ]}
          onPress={handleAddToCalendar}
          disabled={addingToCalendar || addedToCalendar}
        >
          {addingToCalendar ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.calendarButtonText}>
              {addedToCalendar ? 'Added to Calendar' : 'Add to Apple Calendar'}
            </Text>
          )}
        </TouchableOpacity>

        {addedToCalendar && (
          <Text style={[styles.calendarHint, { color: colors.icon }]}>
            Event added to your calendar
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  confirmedBadge: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
  },
  confirmedText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  courtName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  courtAddress: {
    fontSize: 15,
    marginBottom: 8,
  },
  courtMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
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
  dateText: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 4,
  },
  timeText: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  durationText: {
    fontSize: 14,
  },
  participantName: {
    fontSize: 18,
    fontWeight: '500',
  },
  calendarButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  calendarButtonDisabled: {
    opacity: 0.6,
  },
  calendarButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  calendarHint: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: '#e53935',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  backLink: {
    fontSize: 16,
    fontWeight: '500',
  },
});
