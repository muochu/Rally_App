-- Migration: Profile Discoverability RLS
-- Purpose: Allow authenticated users to search discoverable profiles
-- Run this in Supabase SQL Editor

-- ============================================
-- ADD POLICY: Allow searching discoverable profiles
-- ============================================
-- This policy allows any authenticated user to SELECT profiles where discoverable=true
-- This is required for the Contacts search feature to work
-- Users can always see their own profile (existing policy)

CREATE POLICY "Authenticated users can view discoverable profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (discoverable = true);

-- Note: The existing "Users can view own profile" policy still applies
-- So users can see: (1) their own profile, OR (2) any discoverable profile

-- ============================================
-- ADD ensureProfile FUNCTION
-- ============================================
-- This function ensures a profile row exists for an authenticated user
-- It's idempotent - safe to call multiple times
-- Returns the profile row (created or existing)

CREATE OR REPLACE FUNCTION ensure_profile_exists()
RETURNS profiles AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_profile profiles%ROWTYPE;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Try to get existing profile
  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  IF FOUND THEN
    RETURN v_profile;
  END IF;

  -- Get email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Insert new profile
  INSERT INTO profiles (id, email, display_name, discoverable, created_at, updated_at)
  VALUES (v_user_id, v_email, NULL, false, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_profile;

  -- If INSERT didn't return (race condition), fetch it
  IF v_profile.id IS NULL THEN
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  END IF;

  RETURN v_profile;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION ensure_profile_exists() TO authenticated;

-- ============================================
-- TESTING CHECKLIST (for developers)
-- ============================================
-- 1. Sign in with two different accounts (A and B)
-- 2. Account A: Set display_name and discoverable=true
-- 3. Account B: Search for Account A's name
-- 4. Verify: Account A appears in search results
-- 5. Account A: Set discoverable=false
-- 6. Account B: Search again
-- 7. Verify: Account A no longer appears in results
