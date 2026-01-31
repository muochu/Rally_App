import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import type { BusyBlockInsert, Booking } from './types';

export type CalendarPermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Request calendar permissions
 * Returns the permission status
 */
export async function requestCalendarPermission(): Promise<CalendarPermissionStatus> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status as CalendarPermissionStatus;
}

/**
 * Check current calendar permission status
 */
export async function getCalendarPermissionStatus(): Promise<CalendarPermissionStatus> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status as CalendarPermissionStatus;
}

/**
 * Get all available calendars
 * Filters to only calendars that can have events
 */
async function getEventCalendars(): Promise<Calendar.Calendar[]> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

  // On iOS, filter to calendars the user likely cares about
  if (Platform.OS === 'ios') {
    return calendars.filter(
      cal => cal.allowsModifications || cal.source.type === 'caldav' || cal.source.type === 'local'
    );
  }

  return calendars;
}

/**
 * Sync Apple Calendar events to busy blocks
 *
 * Reads events for the next 14 days and converts them to busy blocks.
 * Only stores time ranges - no event titles or metadata.
 *
 * Returns busy blocks ready for insertion (without user_id)
 */
export async function syncCalendarEvents(): Promise<Omit<BusyBlockInsert, 'user_id'>[]> {
  const permission = await getCalendarPermissionStatus();
  if (permission !== 'granted') {
    throw new Error('Calendar permission not granted');
  }

  const calendars = await getEventCalendars();
  if (calendars.length === 0) {
    return [];
  }

  const calendarIds = calendars.map(cal => cal.id);

  // Get events for next 14 days
  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const events = await Calendar.getEventsAsync(
    calendarIds,
    now,
    twoWeeksLater
  );

  // Convert events to busy blocks
  // Filter out all-day events and cancelled events
  const busyBlocks: Omit<BusyBlockInsert, 'user_id'>[] = events
    .filter(event => {
      // Skip all-day events
      if (event.allDay) return false;
      // Skip cancelled events (EventStatus.CANCELED)
      if (event.status === Calendar.EventStatus.CANCELED) return false;
      // Must have valid start and end
      if (!event.startDate || !event.endDate) return false;
      return true;
    })
    .map(event => ({
      // Convert to UTC ISO strings
      start_ts_utc: new Date(event.startDate).toISOString(),
      end_ts_utc: new Date(event.endDate).toISOString(),
      source: 'apple' as const,
    }));

  // Merge overlapping blocks to reduce storage
  return mergeOverlappingBlocks(busyBlocks);
}

/**
 * Merge overlapping or adjacent busy blocks
 */
function mergeOverlappingBlocks(
  blocks: Omit<BusyBlockInsert, 'user_id'>[]
): Omit<BusyBlockInsert, 'user_id'>[] {
  if (blocks.length === 0) return [];

  // Sort by start time
  const sorted = [...blocks].sort(
    (a, b) => new Date(a.start_ts_utc).getTime() - new Date(b.start_ts_utc).getTime()
  );

  const merged: Omit<BusyBlockInsert, 'user_id'>[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const currentEnd = new Date(current.end_ts_utc).getTime();
    const nextStart = new Date(next.start_ts_utc).getTime();

    if (nextStart <= currentEnd) {
      // Overlapping or adjacent - extend current block
      const nextEnd = new Date(next.end_ts_utc).getTime();
      if (nextEnd > currentEnd) {
        current = {
          ...current,
          end_ts_utc: next.end_ts_utc,
        };
      }
    } else {
      // Gap - push current and start new
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Get or create a default calendar for Rally events
 */
async function getOrCreateRallyCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

  // Find an existing writable calendar
  const writableCalendar = calendars.find(
    cal => cal.allowsModifications && cal.source.type === 'local'
  ) || calendars.find(cal => cal.allowsModifications);

  if (writableCalendar) {
    return writableCalendar.id;
  }

  // Create a new calendar if none exists (iOS only)
  if (Platform.OS === 'ios') {
    const defaultCalendarSource = calendars.find(
      cal => cal.source.type === 'local'
    )?.source || calendars[0]?.source;

    if (defaultCalendarSource) {
      const newCalendarId = await Calendar.createCalendarAsync({
        title: 'Rally Tennis',
        color: '#0a7ea4',
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: defaultCalendarSource.id,
        source: defaultCalendarSource,
        name: 'Rally Tennis',
        ownerAccount: 'personal',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
      return newCalendarId;
    }
  }

  throw new Error('No writable calendar available');
}

/**
 * Add a booking to Apple Calendar
 * Creates a local calendar event - does NOT store event metadata in DB
 */
export async function addBookingToCalendar(booking: Booking): Promise<string> {
  const permission = await getCalendarPermissionStatus();
  if (permission !== 'granted') {
    throw new Error('Calendar permission not granted');
  }

  const calendarId = await getOrCreateRallyCalendar();
  const courtName = booking.court?.name ?? 'Tennis Court';
  const courtAddress = booking.court?.address;

  const eventId = await Calendar.createEventAsync(calendarId, {
    title: `Tennis @ ${courtName}`,
    startDate: new Date(booking.start_ts_utc),
    endDate: new Date(booking.end_ts_utc),
    location: courtAddress ?? undefined,
    notes: 'Booked via Rally',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  return eventId;
}
