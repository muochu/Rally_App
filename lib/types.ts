/**
 * Database types for Rally app
 * All timestamps are stored in UTC
 */

export interface AvailabilityWindow {
  id: string;
  user_id: string;
  start_ts_utc: string; // ISO 8601 timestamp
  end_ts_utc: string;   // ISO 8601 timestamp
  created_at: string;
}

export interface BusyBlock {
  id: string;
  user_id: string;
  start_ts_utc: string; // ISO 8601 timestamp
  end_ts_utc: string;   // ISO 8601 timestamp
  source: 'apple' | 'google';
  created_at: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface Court {
  id: string;
  name: string;
  address: string | null;
  surface: 'hard' | 'clay' | 'grass' | null;
  lights: boolean;
  created_at: string;
}

export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Proposal {
  id: string;
  from_user_id: string;
  to_user_id: string | null;
  court_id: string;
  start_ts_utc: string;
  end_ts_utc: string;
  status: ProposalStatus;
  created_at: string;
  // Joined fields (optional)
  court?: Court;
  from_user?: { email: string; display_name: string | null };
  to_user?: { email: string; display_name: string | null } | null;
}

export interface Booking {
  id: string;
  proposal_id: string;
  court_id: string;
  start_ts_utc: string;
  end_ts_utc: string;
  created_at: string;
  // Joined fields (optional)
  court?: Court;
  proposal?: Proposal;
}

// Insert types (without server-generated fields)
export type AvailabilityWindowInsert = Omit<AvailabilityWindow, 'id' | 'created_at'>;
export type BusyBlockInsert = Omit<BusyBlock, 'id' | 'created_at'>;
export type ProposalInsert = Omit<Proposal, 'id' | 'created_at' | 'status' | 'court' | 'from_user' | 'to_user'>;
