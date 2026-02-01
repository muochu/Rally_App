-- Migration: Contacts, User Courts, and Invite Links
-- Run this in Supabase SQL Editor after schema.sql

-- ============================================
-- CONTACTS TABLE (Friend Relationships with States)
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Prevent duplicate relationships
  CONSTRAINT unique_contact_pair UNIQUE (user_id, friend_id),
  -- Prevent self-friending
  CONSTRAINT no_self_contact CHECK (user_id != friend_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_friend_id ON contacts(friend_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(user_id, status);

-- RLS for contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Users can view contacts where they are involved
CREATE POLICY "Users can view their contacts"
  ON contacts FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can send friend requests (create as user_id)
CREATE POLICY "Users can create contact requests"
  ON contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Users can update contacts they're involved in
CREATE POLICY "Users can update their contacts"
  ON contacts FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can delete contacts they initiated
CREATE POLICY "Users can delete their contacts"
  ON contacts FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================
-- USER_COURTS TABLE (Favorite Courts)
-- ============================================
CREATE TABLE IF NOT EXISTS user_courts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Prevent duplicate favorites
  CONSTRAINT unique_user_court UNIQUE (user_id, court_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_courts_user ON user_courts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_courts_court ON user_courts(court_id);

-- RLS for user_courts
ALTER TABLE user_courts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their favorite courts"
  ON user_courts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add favorite courts"
  ON user_courts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove favorite courts"
  ON user_courts FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================
-- INVITE_TOKENS TABLE (For Share Links)
-- ============================================
CREATE TABLE IF NOT EXISTS invite_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_inviter ON invite_tokens(inviter_id);

-- RLS for invite_tokens
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

-- Inviter can view their own tokens
CREATE POLICY "Users can view their invite tokens"
  ON invite_tokens FOR SELECT
  USING (auth.uid() = inviter_id);

-- Users can create invite tokens
CREATE POLICY "Users can create invite tokens"
  ON invite_tokens FOR INSERT
  WITH CHECK (auth.uid() = inviter_id);

-- Anyone can read tokens to validate them (but limited info)
CREATE POLICY "Anyone can validate tokens"
  ON invite_tokens FOR SELECT
  USING (token IS NOT NULL AND used_by IS NULL AND expires_at > NOW());

-- Token can be updated when used
CREATE POLICY "Tokens can be marked as used"
  ON invite_tokens FOR UPDATE
  USING (used_by IS NULL AND expires_at > NOW());


-- ============================================
-- FUNCTION: Accept Friend Request
-- ============================================
CREATE OR REPLACE FUNCTION accept_friend_request(contact_id_param UUID)
RETURNS VOID AS $$
DECLARE
  v_contact contacts%ROWTYPE;
BEGIN
  -- Fetch the contact request
  SELECT * INTO v_contact
  FROM contacts
  WHERE id = contact_id_param
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact request not found';
  END IF;

  -- Check if current user is the recipient (friend_id)
  IF v_contact.friend_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the recipient can accept this request';
  END IF;

  -- Check if still pending
  IF v_contact.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending (status: %)', v_contact.status;
  END IF;

  -- Update status to accepted
  UPDATE contacts SET status = 'accepted', updated_at = NOW()
  WHERE id = contact_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- FUNCTION: Use Invite Token
-- Returns the inviter's user_id if valid
-- ============================================
CREATE OR REPLACE FUNCTION use_invite_token(token_param TEXT)
RETURNS UUID AS $$
DECLARE
  v_token invite_tokens%ROWTYPE;
  v_inviter_id UUID;
BEGIN
  -- Fetch and lock the token
  SELECT * INTO v_token
  FROM invite_tokens
  WHERE token = token_param
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;

  IF v_token.used_by IS NOT NULL THEN
    RAISE EXCEPTION 'Token already used';
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Token expired';
  END IF;

  -- Mark token as used
  UPDATE invite_tokens
  SET used_by = auth.uid(), used_at = NOW()
  WHERE id = v_token.id;

  -- Return inviter ID so we can auto-add as contact
  RETURN v_token.inviter_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- Add city/lat/lng to courts for future Mapbox
-- ============================================
ALTER TABLE courts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Update existing courts with NYC coordinates
UPDATE courts SET city = 'New York', lat = 40.7929, lng = -73.9654
  WHERE name = 'Central Park Tennis Center';
UPDATE courts SET city = 'New York', lat = 40.8007, lng = -73.9701
  WHERE name = 'Riverside Park Courts';
UPDATE courts SET city = 'Brooklyn', lat = 40.6892, lng = -73.9762
  WHERE name = 'Fort Greene Park';
UPDATE courts SET city = 'Brooklyn', lat = 40.7203, lng = -73.9516
  WHERE name = 'McCarren Park';
UPDATE courts SET city = 'Brooklyn', lat = 40.6595, lng = -73.9689
  WHERE name = 'Prospect Park Tennis Center';
UPDATE courts SET city = 'Queens', lat = 40.7506, lng = -73.8453
  WHERE name = 'USTA Billie Jean King National Tennis Center';
UPDATE courts SET city = 'Queens', lat = 40.7614, lng = -73.7709
  WHERE name = 'Cunningham Park';
UPDATE courts SET city = 'Brooklyn', lat = 40.6686, lng = -73.9274
  WHERE name = 'Lincoln Terrace Park';

-- Add profiles visibility setting for contact discovery
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS discoverable BOOLEAN DEFAULT FALSE;
