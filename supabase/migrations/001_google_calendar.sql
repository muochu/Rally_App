-- Migration: Add Google Calendar Support
-- Run this in the Supabase SQL Editor

-- ============================================
-- GOOGLE_ACCOUNTS TABLE (stores OAuth tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS google_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_google_accounts_user_id ON google_accounts(user_id);

-- RLS for google_accounts (only service role should access this directly)
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;

-- Users can read their own google account (to check if connected)
CREATE POLICY "Users can view own google account"
  ON google_accounts FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role (Edge Functions) can insert/update/delete
-- The Edge Functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS

-- ============================================
-- UPDATE BUSY_BLOCKS TO ALLOW 'google' SOURCE
-- ============================================

-- Drop the existing constraint
ALTER TABLE busy_blocks DROP CONSTRAINT IF EXISTS busy_blocks_source_check;

-- Add new constraint that allows both 'apple' and 'google'
ALTER TABLE busy_blocks ADD CONSTRAINT busy_blocks_source_check
  CHECK (source IN ('apple', 'google'));

-- ============================================
-- CLEANUP: Drop any old/unused tables
-- ============================================

-- Drop user_google_tokens if it exists (wrong table name from earlier)
DROP TABLE IF EXISTS user_google_tokens;

-- Drop google_calendar_tokens if it exists (consolidating to google_accounts)
DROP TABLE IF EXISTS google_calendar_tokens;
