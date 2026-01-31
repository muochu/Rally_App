import { createClient } from '@supabase/supabase-js';
import type { AvailabilityWindow, Booking, BusyBlock, Court, Proposal } from './types';

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
    return data ?? [];
  },

  async listSent(userId: string): Promise<Proposal[]> {
    const { data, error } = await supabase
      .from('proposals')
      .select(`*, court:courts(*)`)
      .eq('from_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
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
      .select(`
        *,
        court:courts(*),
        proposal:proposals(
          *,
          from_user:profiles!proposals_from_user_id_fkey(email, display_name),
          to_user:profiles!proposals_to_user_id_fkey(email, display_name)
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  async listForUser(userId: string): Promise<Booking[]> {
    const { data, error } = await supabase
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
      .or(`proposal.from_user_id.eq.${userId},proposal.to_user_id.eq.${userId}`)
      .order('start_ts_utc', { ascending: true });

    if (error) throw error;
    return data ?? [];
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
