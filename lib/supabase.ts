import { createClient } from '@supabase/supabase-js';
import type {
  AvailabilityWindow,
  AvailabilityWindowInsert,
  Booking,
  BusyBlock,
  BusyBlockInsert,
  Contact,
  Court,
  InviteToken,
  Profile,
  Proposal,
  ProposalInsert,
  ProposalStatus,
  UserCourt,
} from './types';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;


if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in env'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Get the currently authenticated user's ID
 * Returns null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Availability Windows API
 */
export const availabilityApi = {
  async list(userId: string): Promise<AvailabilityWindow[]> {
    const { data, error } = await supabase
      .from('availability_windows')
      .select('*')
      .eq('user_id', userId)
      .order('start_ts_utc', { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  async create(window: AvailabilityWindowInsert): Promise<AvailabilityWindow | null> {
    // Check for overlapping slots first
    const { data: existing } = await supabase
      .from('availability_windows')
      .select('*')
      .eq('user_id', window.user_id)
      .lte('start_ts_utc', window.end_ts_utc)
      .gte('end_ts_utc', window.start_ts_utc);

    // If there's an overlap, skip creating
    if (existing && existing.length > 0) {
      console.log('[Availability] Skipping duplicate/overlapping slot');
      return null;
    }

    const { data, error } = await supabase
      .from('availability_windows')
      .insert(window)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('availability_windows')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async deleteAllForUser(userId: string): Promise<void> {
    const { error } = await supabase
      .from('availability_windows')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
  },
};

/**
 * Busy Blocks API
 */
export const busyBlocksApi = {
  async list(userId: string): Promise<BusyBlock[]> {
    const { data, error } = await supabase
      .from('busy_blocks')
      .select('*')
      .eq('user_id', userId)
      .order('start_ts_utc', { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  async upsertFromCalendar(userId: string, blocks: Omit<BusyBlockInsert, 'user_id'>[]): Promise<void> {
    // Delete existing Apple calendar blocks for this user
    const { error: deleteError } = await supabase
      .from('busy_blocks')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'apple');

    if (deleteError) throw deleteError;

    // Insert new blocks
    if (blocks.length > 0) {
      const blocksWithUser = blocks.map(block => ({
        ...block,
        user_id: userId,
      }));

      const { error: insertError } = await supabase
        .from('busy_blocks')
        .insert(blocksWithUser);

      if (insertError) throw insertError;
    }
  },
};

/**
 * Courts API (public read)
 */
export const courtsApi = {
  async list(): Promise<Court[]> {
    const { data, error } = await supabase
      .from('courts')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  async search(query: string): Promise<Court[]> {
    const { data, error } = await supabase
      .from('courts')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  },
};

/**
 * Proposals API
 */
export const proposalsApi = {
  async listReceived(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('to_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Fetch profiles separately
    const fromUserIds = [...new Set(data.map(p => p.from_user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', fromUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      from_user: profileMap.get(p.from_user_id) || null,
    }));
  },

  async listSent(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('from_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Fetch profiles separately
    const toUserIds = [...new Set(data.map(p => p.to_user_id).filter(Boolean))];
    if (toUserIds.length === 0) return data;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', toUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      to_user: p.to_user_id ? (profileMap.get(p.to_user_id) || null) : null,
    }));
  },

  async listAll(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Fetch all related profiles
    const fromUserIds = [...new Set(data.map(p => p.from_user_id))];
    const toUserIds = [...new Set(data.map(p => p.to_user_id).filter(Boolean))];
    const allUserIds = [...new Set([...fromUserIds, ...toUserIds])];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', allUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      from_user: profileMap.get(p.from_user_id) || null,
      to_user: p.to_user_id ? (profileMap.get(p.to_user_id) || null) : null,
    }));
  },

  async create(proposal: ProposalInsert): Promise<Proposal> {
    const { data, error } = await supabase
      .from('proposals')
      .insert(proposal)
      .select(`
        *,
        court:courts(*)
      `)
      .single();

    if (error) throw error;
    return data;
  },

  async updateStatus(id: string, status: ProposalStatus): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status })
      .eq('id', id);

    if (error) throw error;
  },

  async accept(proposalId: string): Promise<string> {
    // Call the transaction-safe RPC function
    const { data, error } = await supabase.rpc('accept_proposal', {
      proposal_id_param: proposalId,
    });

    if (error) throw error;
    return data as string; // Returns booking ID
  },

  async decline(proposalId: string): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'declined' })
      .eq('id', proposalId);

    if (error) throw error;
  },

  async cancel(proposalId: string): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'cancelled' })
      .eq('id', proposalId);

    if (error) throw error;
  },
};

/**
 * Bookings API
 */
export const bookingsApi = {
  async get(id: string): Promise<Booking | null> {
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, court:courts(*), proposal:proposals(*)`)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    if (!data || !data.proposal) return data;

    // Fetch profiles separately
    const proposal = data.proposal;
    const userIds = [proposal.from_user_id, proposal.to_user_id].filter(Boolean);
    if (userIds.length === 0) return data;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return {
      ...data,
      proposal: {
        ...proposal,
        from_user: profileMap.get(proposal.from_user_id) || null,
        to_user: proposal.to_user_id ? (profileMap.get(proposal.to_user_id) || null) : null,
      },
    };
  },

  async listForUser(userId: string): Promise<Booking[]> {
    // First, get proposal IDs where user is involved (PostgREST can't filter on joined columns in .or())
    const { data: userProposals, error: proposalsError } = await supabase
      .from('proposals')
      .select('id')
      .eq('status', 'accepted')
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

    if (proposalsError) throw proposalsError;
    if (!userProposals || userProposals.length === 0) return [];

    const proposalIds = userProposals.map((p) => p.id);

    // Then get bookings for those proposals
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, court:courts(*), proposal:proposals(*)`)
      .in('proposal_id', proposalIds)
      .order('start_ts_utc', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Fetch all related profiles
    const allUserIds = new Set<string>();
    data.forEach(booking => {
      if (booking.proposal) {
        allUserIds.add(booking.proposal.from_user_id);
        if (booking.proposal.to_user_id) {
          allUserIds.add(booking.proposal.to_user_id);
        }
      }
    });

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', Array.from(allUserIds));

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    // Merge profile data into proposals
    return data.map(booking => ({
      ...booking,
      proposal: booking.proposal ? {
        ...booking.proposal,
        from_user: profileMap.get(booking.proposal.from_user_id) || null,
        to_user: booking.proposal.to_user_id ? (profileMap.get(booking.proposal.to_user_id) || null) : null,
      } : null,
    }));
  },
};

/**
 * Auth helpers
 *
 * Environment variables required:
 * - EXPO_PUBLIC_SUPABASE_URL: Your Supabase project URL
 * - EXPO_PUBLIC_SUPABASE_ANON_KEY: Your Supabase anon/public key
 *
 * Google OAuth Setup:
 * 1. Google Cloud Console: Create OAuth 2.0 credentials (Web application type)
 *    - Add authorized redirect URI: https://<PROJECT_REF>.supabase.co/auth/v1/callback
 * 2. Supabase Dashboard (Authentication > Providers > Google):
 *    - Enable Google provider
 *    - Add Web Client ID and Web Client Secret from Google Cloud Console
 * 3. Supabase Dashboard (Authentication > URL Configuration):
 *    - Add allowed redirect URL: rallyapp://auth/callback
 *
 * OAuth Flow: See lib/auth-callback.ts and app/(auth)/login.tsx for implementation details
 */
export const authApi = {
  async signInWithMagicLink(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Deep link back to app after email verification
        emailRedirectTo: 'rallyapp://auth/callback',
      },
    });

    if (error) throw error;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};

// Status constants to avoid string mismatches
const CONTACT_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  BLOCKED: 'blocked',
} as const;

/**
 * Contacts API (Friend Relationships)
 */
export const contactsApi = {
  /**
   * Get all accepted friends (SYMMETRIC - works for both sides of friendship)
   * Returns contacts where user is either user_id or friend_id with status='accepted'
   */
  async listFriends(userId: string): Promise<Contact[]> {
    // Step 1: Get all accepted contacts where user is involved
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('status', CONTACT_STATUS.ACCEPTED)
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (contactsError) {
      console.error('[Contacts] listFriends query failed:', contactsError.code, contactsError.message);
      throw contactsError;
    }

    if (!contacts || contacts.length === 0) {
      return [];
    }

    // Step 2: Collect all profile IDs we need to fetch
    const profileIds = new Set<string>();
    contacts.forEach((c) => {
      profileIds.add(c.user_id);
      profileIds.add(c.friend_id);
    });

    // Step 3: Fetch all relevant profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', Array.from(profileIds));

    if (profilesError) {
      console.error('[Contacts] profiles fetch failed:', profilesError.code, profilesError.message);
      throw profilesError;
    }

    // Create a lookup map
    const profileMap = new Map<string, { id: string; email: string; display_name: string | null }>();
    (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

    // Step 4: Transform contacts with profile data
    return contacts.map((contact) => {
      const isRequester = contact.user_id === userId;
      const friendId = isRequester ? contact.friend_id : contact.user_id;
      const requesterId = contact.user_id;

      return {
        ...contact,
        // "friend" is the OTHER person in the relationship (the one to display/navigate to)
        friend: profileMap.get(friendId) || { id: friendId, email: '', display_name: null },
        // "user" is the requester (for incoming request display)
        user: profileMap.get(requesterId) || { id: requesterId, email: '', display_name: null },
      };
    });
  },

  /**
   * Get pending incoming requests (friend_id = me, someone sent ME a request)
   */
  async listPendingIncoming(userId: string): Promise<Contact[]> {
    // Step 1: Get pending contacts where I'm the recipient
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('friend_id', userId)
      .eq('status', CONTACT_STATUS.PENDING)
      .order('created_at', { ascending: false });

    if (contactsError) {
      console.error('[Contacts] listPendingIncoming failed:', contactsError.code, contactsError.message);
      throw contactsError;
    }

    if (!contacts || contacts.length === 0) return [];

    // Step 2: Fetch requester profiles
    const requesterIds = contacts.map((c) => c.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', requesterIds);

    if (profilesError) {
      console.error('[Contacts] profiles fetch failed:', profilesError.code, profilesError.message);
      throw profilesError;
    }

    const profileMap = new Map<string, { id: string; email: string; display_name: string | null }>();
    (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

    return contacts.map((c) => ({
      ...c,
      user: profileMap.get(c.user_id) || { id: c.user_id, email: '', display_name: null },
    }));
  },

  /**
   * Get pending outgoing requests (user_id = me, I sent a request)
   */
  async listPendingOutgoing(userId: string): Promise<Contact[]> {
    // Step 1: Get pending contacts where I'm the requester
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', CONTACT_STATUS.PENDING)
      .order('created_at', { ascending: false });

    if (contactsError) {
      console.error('[Contacts] listPendingOutgoing failed:', contactsError.code, contactsError.message);
      throw contactsError;
    }

    if (!contacts || contacts.length === 0) return [];

    // Step 2: Fetch recipient profiles
    const recipientIds = contacts.map((c) => c.friend_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', recipientIds);

    if (profilesError) {
      console.error('[Contacts] profiles fetch failed:', profilesError.code, profilesError.message);
      throw profilesError;
    }

    const profileMap = new Map<string, { id: string; email: string; display_name: string | null }>();
    (profiles ?? []).forEach((p) => profileMap.set(p.id, p));

    return contacts.map((c) => ({
      ...c,
      friend: profileMap.get(c.friend_id) || { id: c.friend_id, email: '', display_name: null },
    }));
  },

  /**
   * Check if two users are friends (have an accepted contact relationship)
   * Uses direct query for reliability (doesn't depend on RPC function being deployed)
   */
  async areFriends(userId: string, otherUserId: string): Promise<boolean> {
    console.log('[Contacts] areFriends check:', { userId, otherUserId });

    // Direct query: check for accepted contact where both users are involved
    const { data, error } = await supabase
      .from('contacts')
      .select('id, status, user_id, friend_id')
      .eq('status', CONTACT_STATUS.ACCEPTED)
      .or(
        `and(user_id.eq.${userId},friend_id.eq.${otherUserId}),and(user_id.eq.${otherUserId},friend_id.eq.${userId})`
      )
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Contacts] areFriends query failed:', error.code, error.message);
      return false;
    }

    const isFriends = !!data;
    console.log('[Contacts] areFriends result:', { isFriends, contactRow: data });
    return isFriends;
  },

  // Send a friend request
  async sendRequest(userId: string, friendId: string): Promise<Contact> {
    // Insert the contact request
    const { data: contact, error: insertError } = await supabase
      .from('contacts')
      .insert({ user_id: userId, friend_id: friendId, status: CONTACT_STATUS.PENDING })
      .select('*')
      .single();

    if (insertError) {
      console.error('[Contacts] sendRequest failed:', insertError.code, insertError.message);
      throw insertError;
    }

    // Fetch the friend profile
    const { data: friendProfile } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .eq('id', friendId)
      .single();

    return {
      ...contact,
      friend: friendProfile || { id: friendId, email: '', display_name: null },
    };
  },

  // Accept a friend request (via RPC)
  async acceptRequest(contactId: string): Promise<void> {
    const { error } = await supabase.rpc('accept_friend_request', {
      contact_id_param: contactId,
    });

    if (error) throw error;
  },

  // Decline/cancel a friend request
  async declineRequest(contactId: string): Promise<void> {
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId);

    if (error) throw error;
  },

  // Remove a friend
  async removeFriend(contactId: string): Promise<void> {
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId);

    if (error) throw error;
  },

  // Block a user
  async blockUser(userId: string, blockedUserId: string): Promise<void> {
    // First try to find existing contact
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .or(`and(user_id.eq.${userId},friend_id.eq.${blockedUserId}),and(user_id.eq.${blockedUserId},friend_id.eq.${userId})`)
      .maybeSingle();

    if (existing) {
      await supabase.from('contacts').delete().eq('id', existing.id);
    }

    // Create a blocked relationship
    const { error } = await supabase
      .from('contacts')
      .insert({ user_id: userId, friend_id: blockedUserId, status: CONTACT_STATUS.BLOCKED });

    if (error) {
      console.error('[Contacts] blockUser failed:', error.code, error.message);
      throw error;
    }
  },
};

/**
 * User Courts API (Favorites)
 */
export const userCourtsApi = {
  async list(userId: string): Promise<UserCourt[]> {
    const { data, error } = await supabase
      .from('user_courts')
      .select('*, court:courts(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async add(userId: string, courtId: string): Promise<UserCourt> {
    const { data, error } = await supabase
      .from('user_courts')
      .insert({ user_id: userId, court_id: courtId })
      .select('*, court:courts(*)')
      .single();

    if (error) throw error;
    return data;
  },

  async remove(userId: string, courtId: string): Promise<void> {
    const { error } = await supabase
      .from('user_courts')
      .delete()
      .eq('user_id', userId)
      .eq('court_id', courtId);

    if (error) throw error;
  },

  async isFavorite(userId: string, courtId: string): Promise<boolean> {
    const { data } = await supabase
      .from('user_courts')
      .select('id')
      .eq('user_id', userId)
      .eq('court_id', courtId)
      .single();

    return !!data;
  },
};

/**
 * Invite Tokens API
 */
export const inviteTokensApi = {
  async create(inviterId: string): Promise<InviteToken> {
    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }
    if (user.id !== inviterId) {
      console.warn('[InviteTokens] inviterId mismatch:', { inviterId, userId: user.id });
    }

    // Generate a random token (8 chars alphanumeric)
    const token = Math.random().toString(36).substring(2, 10).toUpperCase();
    // Expires in 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('invite_tokens')
      .insert({ inviter_id: inviterId, token, expires_at: expiresAt })
      .select()
      .single();

    if (error) {
      console.error('[InviteTokens] Insert failed:', error.code, error.message);
      throw error;
    }
    return data;
  },

  async validate(token: string): Promise<InviteToken | null> {
    const { data, error } = await supabase
      .from('invite_tokens')
      .select('*')
      .eq('token', token)
      .is('used_by', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error) return null;
    return data;
  },

  async use(token: string): Promise<string> {
    // Use the RPC function to atomically mark token as used and get inviter ID
    const { data, error } = await supabase.rpc('use_invite_token', {
      token_param: token,
    });

    if (error) throw error;
    return data as string; // Returns inviter_id
  },

  async listMine(userId: string): Promise<InviteToken[]> {
    const { data, error } = await supabase
      .from('invite_tokens')
      .select('*')
      .eq('inviter_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },
};

/**
 * Profiles API
 */
export const profilesApi = {
  /**
   * Get a user's profile by ID
   */
  async get(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) return null;
    return data;
  },

  /**
   * Ensure a profile exists for the current authenticated user.
   * Uses RPC function for atomic upsert. Safe to call multiple times.
   */
  async ensureExists(): Promise<Profile> {
    const { data, error } = await supabase.rpc('ensure_profile_exists');

    if (error) {
      // Fallback: try direct get (profile may exist from trigger)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const existing = await profilesApi.get(user.id);
        if (existing) return existing;
      }
      throw error;
    }

    return data as Profile;
  },

  /**
   * Update profile fields (display_name, discoverable)
   */
  async update(userId: string, updates: Partial<Pick<Profile, 'display_name' | 'discoverable'>>): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;
  },

  /**
   * Search discoverable profiles by display_name or email.
   * Only returns profiles where discoverable=true.
   */
  async search(query: string, excludeUserId?: string): Promise<Profile[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    let q = supabase
      .from('profiles')
      .select('*')
      .eq('discoverable', true)
      .or(`email.ilike.%${trimmed}%,display_name.ilike.%${trimmed}%`)
      .limit(10);

    if (excludeUserId) {
      q = q.neq('id', excludeUserId);
    }

    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
};

/**
 * Friend Availability API
 * Read availability of friends (requires accepted friendship)
 */
export const friendAvailabilityApi = {
  /**
   * Get a friend's availability windows for the next N days
   * Only works if caller and friendId have an accepted friendship
   */
  async getForFriend(friendId: string, days: number = 7): Promise<AvailabilityWindow[]> {
    const { data: { user } } = await supabase.auth.getUser();
    const currentUserId = user?.id ?? null;
    
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    const endIso = endDate.toISOString();

    console.log('[FriendAvailability] Querying:', {
      currentUserId,
      friendId,
      nowIso,
      endIso,
    });

    // Fetch slots that end within the date range (not just start)
    // This allows us to show slots that have already started but haven't ended yet
    const { data, error } = await supabase
      .from('availability_windows')
      .select('*')
      .eq('user_id', friendId)
      .gte('end_ts_utc', nowIso) // End time must be in the future
      .lt('start_ts_utc', endIso) // Start time must be within date range
      .order('start_ts_utc', { ascending: true });

    if (error) {
      console.error('[FriendAvailability] Query failed:', {
        code: error.code,
        message: error.message,
        hint: error.hint,
        friendId,
        currentUserId,
      });
      
      // If RLS is blocking (42501), provide helpful message
      if (error.code === '42501') {
        throw new Error(`RLS blocked: Friend availability policy may not be applied. Run migration 005. (code: ${error.code})`);
      }
      
      throw new Error(`Failed to fetch friend availability: ${error.message} (code: ${error.code || 'unknown'})`);
    }

    // Filter slots: show if current time is less than (end time - 30 minutes)
    // This means slots are hidden 30 minutes before they end
    const thirtyMinutesInMs = 30 * 60 * 1000;
    const filteredData = (data || []).filter(slot => {
      const slotEnd = new Date(slot.end_ts_utc);
      const cutoffTime = new Date(slotEnd.getTime() - thirtyMinutesInMs);
      return now < cutoffTime;
    });

    const slotsFound = filteredData?.length ?? 0;
    console.log('[FriendAvailability] Result:', {
      slotsFound,
      friendId,
      totalFetched: data?.length ?? 0,
    });

    // If no slots found, check if friend has ANY availability (diagnostic)
    if (slotsFound === 0) {
      const { data: allData, error: allError } = await supabase
        .from('availability_windows')
        .select('*')
        .eq('user_id', friendId)
        .order('start_ts_utc', { ascending: true })
        .limit(10);
      
      if (allError) {
        console.error('[FriendAvailability] Diagnostic query failed:', {
          code: allError.code,
          message: allError.message,
        });
      } else if (allData && allData.length > 0) {
        const earliest = new Date(allData[0].start_ts_utc);
        const daysFromNow = Math.round((earliest.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        console.warn('[FriendAvailability] Friend has availability but none in next 7 days:', {
          totalSlots: allData.length,
          earliestSlot: allData[0]?.start_ts_utc,
          latestSlot: allData[allData.length - 1]?.start_ts_utc,
          earliestDaysFromNow: daysFromNow,
          nowIso,
          endIso,
        });
      } else {
        console.warn('[FriendAvailability] Friend has NO availability slots at all for user_id:', friendId);
      }
    }

    return filteredData;
  },

  /**
   * Debug: Get ALL availability for a friend (no date filter)
   * Use this to check if slots exist but are outside the date range
   */
  async debugGetAllForFriend(friendId: string): Promise<{ count: number; slots: AvailabilityWindow[] }> {
    const { data, error, count } = await supabase
      .from('availability_windows')
      .select('*', { count: 'exact' })
      .eq('user_id', friendId)
      .order('start_ts_utc', { ascending: true })
      .limit(10);

    console.log('[FriendAvailability] DEBUG all slots:', {
      friendId,
      error: error ? { code: error.code, message: error.message } : null,
      totalCount: count,
      sampleSlots: data?.map(s => ({ id: s.id, start: s.start_ts_utc, end: s.end_ts_utc })),
    });

    return { count: count ?? 0, slots: data ?? [] };
  },

  /**
   * Get friend's profile by ID (for display)
   */
  async getFriendProfile(friendId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', friendId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('[FriendAvailability] Profile load failed:', error.code, error.message);
      throw error;
    }
    return data;
  },
};

/**
 * Match Invites API (using proposals table)
 * Create and manage match invitations between friends
 */
export const matchInvitesApi = {
  /**
   * Send a match invitation to a friend
   * Court is optional - can be decided later
   */
  async sendInvite(
    fromUserId: string,
    toUserId: string,
    courtId: string | null,
    startTime: string,
    endTime: string,
    message?: string | null
  ): Promise<Proposal> {
    console.log('[MatchInvites] Sending invite:', {
      from: fromUserId,
      to: toUserId,
      courtId,
      startTime,
      endTime,
      message: message ? 'provided' : 'none',
    });

    const insertData: any = {
      from_user_id: fromUserId,
      to_user_id: toUserId,
      start_ts_utc: startTime,
      end_ts_utc: endTime,
      status: 'pending',
    };

    // Only include court_id if provided
    if (courtId) {
      insertData.court_id = courtId;
    }

    // Only include message if provided
    if (message && message.trim()) {
      insertData.message = message.trim();
    }

    const { data, error } = await supabase
      .from('proposals')
      .insert(insertData)
      .select('*, court:courts(*)')
      .single();

    if (error) {
      console.error('[MatchInvites] Send failed:', {
        code: error.code,
        message: error.message,
      });
      throw new Error(`Failed to send match invite: ${error.message} (code: ${error.code || 'unknown'})`);
    }

    if (!data) {
      throw new Error('Failed to send match invite: No data returned');
    }

    return data;
  },

  /**
   * Get incoming match invites (where I'm the recipient)
   */
  async listIncoming(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('to_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[MatchInvites] listIncoming failed:', error.code, error.message);
      throw error;
    }
    if (!data || data.length === 0) return [];

    // Fetch profiles separately
    const fromUserIds = [...new Set(data.map(p => p.from_user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', fromUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      from_user: profileMap.get(p.from_user_id) || null,
    }));
  },

  /**
   * Get outgoing match invites (where I'm the sender)
   */
  async listOutgoing(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('from_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[MatchInvites] listOutgoing failed:', error.code, error.message);
      throw error;
    }
    if (!data || data.length === 0) return [];

    // Fetch profiles separately
    const toUserIds = [...new Set(data.map(p => p.to_user_id).filter(Boolean))];
    if (toUserIds.length === 0) return data;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', toUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      to_user: p.to_user_id ? (profileMap.get(p.to_user_id) || null) : null,
    }));
  },

  /**
   * Get accepted matches (both incoming and outgoing)
   */
  async listAccepted(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('status', 'accepted')
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
      .gte('start_ts_utc', new Date().toISOString())
      .order('start_ts_utc', { ascending: true });

    if (error) {
      console.error('[MatchInvites] listAccepted failed:', error.code, error.message);
      throw error;
    }
    if (!data || data.length === 0) return [];

    // Fetch all related profiles
    const fromUserIds = [...new Set(data.map(p => p.from_user_id))];
    const toUserIds = [...new Set(data.map(p => p.to_user_id).filter(Boolean))];
    const allUserIds = [...new Set([...fromUserIds, ...toUserIds])];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', allUserIds);

    // Merge profile data
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    return data.map(p => ({
      ...p,
      from_user: profileMap.get(p.from_user_id) || null,
      to_user: p.to_user_id ? (profileMap.get(p.to_user_id) || null) : null,
    }));
  },

  /**
   * Accept a match invite (as recipient)
   */
  async accept(proposalId: string): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'accepted' })
      .eq('id', proposalId);

    if (error) {
      console.error('[MatchInvites] accept failed:', error.code, error.message);
      throw error;
    }
    console.log('[MatchInvites] Invite accepted:', proposalId);
  },

  /**
   * Decline a match invite (as recipient)
   */
  async decline(proposalId: string): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'declined' })
      .eq('id', proposalId);

    if (error) {
      console.error('[MatchInvites] decline failed:', error.code, error.message);
      throw error;
    }
    console.log('[MatchInvites] Invite declined:', proposalId);
  },

  /**
   * Cancel a match invite (as sender)
   */
  async cancel(proposalId: string): Promise<void> {
    const { error } = await supabase
      .from('proposals')
      .update({ status: 'cancelled' })
      .eq('id', proposalId);

    if (error) {
      console.error('[MatchInvites] cancel failed:', error.code, error.message);
      throw error;
    }
    console.log('[MatchInvites] Invite cancelled:', proposalId);
  },

  /**
   * Check if there's a pending proposal between two users for a given time slot
   */
  async hasPendingProposal(
    fromUserId: string,
    toUserId: string,
    startTime: string,
    endTime: string
  ): Promise<Proposal | null> {
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('from_user_id', fromUserId)
      .eq('to_user_id', toUserId)
      .eq('status', 'pending')
      .eq('start_ts_utc', startTime)
      .eq('end_ts_utc', endTime)
      .maybeSingle();

    if (error) {
      console.error('[MatchInvites] hasPendingProposal failed:', error.code, error.message);
      return null;
    }
    return data;
  },
};
