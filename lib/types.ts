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
  city: string | null;
  lat: number | null;
  lng: number | null;
  surface: 'hard' | 'clay' | 'grass' | null;
  lights: boolean;
  created_at: string;
}

export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Proposal {
  id: string;
  from_user_id: string;
  to_user_id: string | null;
  court_id: string | null; // Nullable - court can be selected later
  start_ts_utc: string;
  end_ts_utc: string;
  status: ProposalStatus;
  message: string | null; // Optional message when sending invite
  created_at: string;
  updated_at: string | null;
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

// Contact/Friend types
export type ContactStatus = 'pending' | 'accepted' | 'blocked';

export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
  // Joined fields (optional)
  friend?: { id: string; email: string; display_name: string | null };
  user?: { id: string; email: string; display_name: string | null };
}

export type ContactInsert = Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'friend' | 'user'>;

// User's favorite courts
export interface UserCourt {
  id: string;
  user_id: string;
  court_id: string;
  created_at: string;
  // Joined field
  court?: Court;
}

// Invite tokens for share links
export interface InviteToken {
  id: string;
  inviter_id: string;
  token: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

// Profile with discoverable setting
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  discoverable: boolean;
  created_at: string;
  updated_at: string;
}

// Symmetric friend relationship (computed from contacts)
export interface FriendWithProfile {
  contactId: string;
  friendId: string;
  displayName: string | null;
  email: string;
  status: ContactStatus;
  isIncoming: boolean; // true if friend_id = me (they sent request)
  createdAt: string;
}

// Availability slot for friend profile view
export interface FriendAvailability {
  id: string;
  start: Date;
  end: Date;
}

// For creating match proposals to friends
export interface MatchProposalInsert {
  to_user_id: string;
  court_id: string;
  start_ts_utc: string;
  end_ts_utc: string;
}
