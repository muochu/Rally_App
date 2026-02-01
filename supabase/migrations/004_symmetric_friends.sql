-- Migration: Symmetric Friends + Availability Sharing
-- Purpose: Allow friends to view each other's availability

-- ============================================
-- AVAILABILITY_WINDOWS: Add RLS for friends to read
-- ============================================

-- Drop existing policy if it only allows owner access
DROP POLICY IF EXISTS "Users can view own availability" ON availability_windows;

-- Owner can view their own availability
CREATE POLICY "Users can view own availability"
  ON availability_windows FOR SELECT
  USING (auth.uid() = user_id);

-- Friends can view availability of users they are friends with
-- A friendship exists when there's an accepted contact row where
-- either (user_id = me AND friend_id = target) OR (user_id = target AND friend_id = me)
CREATE POLICY "Friends can view friend availability"
  ON availability_windows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts
      WHERE status = 'accepted'
      AND (
        (contacts.user_id = auth.uid() AND contacts.friend_id = availability_windows.user_id)
        OR
        (contacts.friend_id = auth.uid() AND contacts.user_id = availability_windows.user_id)
      )
    )
  );

-- ============================================
-- CONTACTS: Ensure both sides can see accepted friendships
-- ============================================

-- Drop old policy and recreate to be more explicit
DROP POLICY IF EXISTS "Users can view their contacts" ON contacts;

-- Users can view contacts where they are either user_id or friend_id
CREATE POLICY "Users can view their contacts"
  ON contacts FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ============================================
-- PROFILES: Allow reading friend profiles
-- ============================================

-- Add policy for reading profiles of friends (for display in contacts list)
CREATE POLICY "Users can view friend profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    -- Own profile
    auth.uid() = id
    OR
    -- Discoverable profiles (for search)
    discoverable = true
    OR
    -- Friend profiles (accepted contact exists)
    EXISTS (
      SELECT 1 FROM contacts
      WHERE status = 'accepted'
      AND (
        (contacts.user_id = auth.uid() AND contacts.friend_id = profiles.id)
        OR
        (contacts.friend_id = auth.uid() AND contacts.user_id = profiles.id)
      )
    )
    OR
    -- Pending contact profiles (to show who sent request)
    EXISTS (
      SELECT 1 FROM contacts
      WHERE status = 'pending'
      AND (
        (contacts.user_id = auth.uid() AND contacts.friend_id = profiles.id)
        OR
        (contacts.friend_id = auth.uid() AND contacts.user_id = profiles.id)
      )
    )
  );

-- ============================================
-- HELPER FUNCTION: Check if two users are friends
-- ============================================
CREATE OR REPLACE FUNCTION are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM contacts
    WHERE status = 'accepted'
    AND (
      (user_id = user_a AND friend_id = user_b)
      OR
      (user_id = user_b AND friend_id = user_a)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION are_friends(UUID, UUID) TO authenticated;
