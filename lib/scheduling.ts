import type { TimeSlot } from './types';

/**
 * Pure function to calculate free time slots
 *
 * Takes availability windows and busy blocks, returns slots where:
 * - User is available (within availability windows)
 * - User is not busy (outside busy blocks)
 * - Slot is at least durationMinutes long
 *
 * All inputs and outputs use Date objects in UTC
 */
export function getFreeSlots(
  availability: TimeSlot[],
  busyBlocks: TimeSlot[],
  durationMinutes: number
): TimeSlot[] {
  if (availability.length === 0) return [];
  if (durationMinutes <= 0) return [];

  const durationMs = durationMinutes * 60 * 1000;

  // Sort availability and busy blocks by start time
  const sortedAvailability = [...availability].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const sortedBusy = [...busyBlocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  const freeSlots: TimeSlot[] = [];

  for (const avail of sortedAvailability) {
    // Get busy blocks that overlap with this availability window
    const overlappingBusy = sortedBusy.filter(
      busy => busy.start < avail.end && busy.end > avail.start
    );

    if (overlappingBusy.length === 0) {
      // No busy blocks - entire availability window is free
      if (avail.end.getTime() - avail.start.getTime() >= durationMs) {
        freeSlots.push({ start: avail.start, end: avail.end });
      }
      continue;
    }

    // Subtract busy blocks from availability window
    let currentStart = avail.start;

    for (const busy of overlappingBusy) {
      // If there's a gap before this busy block, it's a free slot
      if (busy.start > currentStart) {
        const gapEnd = busy.start < avail.end ? busy.start : avail.end;
        if (gapEnd.getTime() - currentStart.getTime() >= durationMs) {
          freeSlots.push({ start: currentStart, end: gapEnd });
        }
      }

      // Move current start to end of busy block (if it extends past current position)
      if (busy.end > currentStart) {
        currentStart = busy.end;
      }

      // If we've moved past the availability window, stop
      if (currentStart >= avail.end) break;
    }

    // Check for remaining time after all busy blocks
    if (currentStart < avail.end) {
      if (avail.end.getTime() - currentStart.getTime() >= durationMs) {
        freeSlots.push({ start: currentStart, end: avail.end });
      }
    }
  }

  return freeSlots;
}

/**
 * Convert ISO timestamp strings to TimeSlot
 */
export function toTimeSlot(start_ts_utc: string, end_ts_utc: string): TimeSlot {
  return {
    start: new Date(start_ts_utc),
    end: new Date(end_ts_utc),
  };
}

/**
 * Format a time slot for display (local time)
 */
export function formatTimeSlot(slot: TimeSlot): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  const startStr = slot.start.toLocaleString(undefined, options);
  const endStr = slot.end.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${startStr} - ${endStr}`;
}

/**
 * Break free slots into fixed-duration chunks (e.g., 1-hour blocks)
 * Returns slots aligned to the hour
 */
export function getHourlyBlocks(
  freeSlots: TimeSlot[],
  blockDurationMinutes: number = 60,
  maxBlocks: number = 3
): TimeSlot[] {
  const blocks: TimeSlot[] = [];
  const blockMs = blockDurationMinutes * 60 * 1000;
  const now = new Date();

  for (const slot of freeSlots) {
    // Start from the slot start, aligned to the next hour
    let blockStart = new Date(slot.start);
    // Round up to next hour
    if (blockStart.getMinutes() > 0 || blockStart.getSeconds() > 0) {
      blockStart.setMinutes(0, 0, 0);
      blockStart.setHours(blockStart.getHours() + 1);
    }

    // Skip if block start is in the past
    if (blockStart < now) {
      blockStart = new Date(now);
      blockStart.setMinutes(0, 0, 0);
      blockStart.setHours(blockStart.getHours() + 1);
    }

    while (blockStart.getTime() + blockMs <= slot.end.getTime()) {
      const blockEnd = new Date(blockStart.getTime() + blockMs);
      blocks.push({ start: new Date(blockStart), end: blockEnd });

      if (blocks.length >= maxBlocks) {
        return blocks;
      }

      blockStart = blockEnd;
    }
  }

  return blocks;
}
