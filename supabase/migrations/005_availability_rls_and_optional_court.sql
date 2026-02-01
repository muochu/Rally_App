-- Migration: Fix Availability RLS for Friends + Optional Court for Match Invites
-- Purpose:
-- 1. Ensure friends can view each other's availability
-- 2. Allow match invites without requiring a court

-- ============================================
-- AVAILABILITY_WINDOWS: RLS policies for friends
-- ============================================

-- Ensure RLS is enabled
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies (idempotent)
DROP POLICY IF EXISTS "Users can view own availability" ON availability_windows;
DROP POLICY IF EXISTS "Friends can view friend availability" ON availability_windows;
DROP POLICY IF EXISTS "Users can create own availability" ON availability_windows;
DROP POLICY IF EXISTS "Users can update own availability" ON availability_windows;
DROP POLICY IF EXISTS "Users can delete own availability" ON availability_windows;

-- Policy 1: Owner can SELECT their own rows
CREATE POLICY "Users can view own availability"
  ON availability_windows FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Friends can SELECT if accepted contact exists bidirectionally
-- Note: The subquery uses contacts table which has its own RLS, but the contacts
-- RLS policy allows reading rows where auth.uid() = user_id OR auth.uid() = friend_id,
-- which matches our friendship check, so this should work.
CREATE POLICY "Friends can view friend availability"
  ON availability_windows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.status = 'accepted'
      AND (
        (c.user_id = auth.uid() AND c.friend_id = availability_windows.user_id)
        OR
        (c.friend_id = auth.uid() AND c.user_id = availability_windows.user_id)
      )
    )
  );

-- Policy 3: Owner can INSERT their own rows
CREATE POLICY "Users can create own availability"
  ON availability_windows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Owner can UPDATE their own rows
CREATE POLICY "Users can update own availability"
  ON availability_windows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 5: Owner can DELETE their own rows
CREATE POLICY "Users can delete own availability"
  ON availability_windows FOR DELETE
  USING (auth.uid() = user_id);

-- Performance indexes for friendship lookups
CREATE INDEX IF NOT EXISTS idx_contacts_friendship_lookup 
  ON public.contacts(user_id, friend_id, status) 
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_contacts_friendship_reverse_lookup 
  ON public.contacts(friend_id, user_id, status) 
  WHERE status = 'accepted';

-- Helper function to check friendship (bypasses RLS for the check)
CREATE OR REPLACE FUNCTION are_friends_for_availability(check_user_id UUID, target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM contacts
    WHERE status = 'accepted'
    AND (
      (user_id = check_user_id AND friend_id = target_user_id)
      OR
      (user_id = target_user_id AND friend_id = check_user_id)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION are_friends_for_availability(UUID, UUID) TO authenticated;

-- Recreate the policy using the function (more reliable)
DROP POLICY IF EXISTS "Friends can view friend availability" ON availability_windows;
CREATE POLICY "Friends can view friend availability"
  ON availability_windows FOR SELECT
  USING (are_friends_for_availability(auth.uid(), user_id));

-- ============================================
-- PROPOSALS: Make court_id NULLABLE
-- ============================================

-- Allow match invites without a court (can be decided later)
ALTER TABLE proposals ALTER COLUMN court_id DROP NOT NULL;

-- ============================================
-- PROPOSALS: Ensure proper RLS for match invites
-- ============================================

-- Drop and recreate to ensure correct policies
DROP POLICY IF EXISTS "Users can view proposals they participate in" ON proposals;
DROP POLICY IF EXISTS "Users can create proposals" ON proposals;
DROP POLICY IF EXISTS "Participants can update proposal status" ON proposals;

-- Users can view proposals where they are sender or recipient
CREATE POLICY "Users can view proposals they participate in"
  ON proposals FOR SELECT
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Users can create proposals (as sender)
CREATE POLICY "Users can create proposals"
  ON proposals FOR INSERT
  WITH CHECK (auth.uid() = from_user_id);

-- Participants can update proposal status
-- Recipient can accept/decline, sender can cancel
CREATE POLICY "Participants can update proposal status"
  ON proposals FOR UPDATE
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id)
  WITH CHECK (
    -- Sender can only set status to 'cancelled'
    (auth.uid() = from_user_id AND status IN ('cancelled', 'pending'))
    OR
    -- Recipient can set status to 'accepted' or 'declined'
    (auth.uid() = to_user_id AND status IN ('accepted', 'declined', 'pending'))
  );

-- ============================================
-- Reload PostgREST schema cache
-- ============================================
NOTIFY pgrst, 'reload schema';
