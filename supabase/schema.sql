-- Rally App Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES TABLE (optional, for user metadata)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- RLS for profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================
-- AVAILABILITY_WINDOWS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS availability_windows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_ts_utc TIMESTAMPTZ NOT NULL,
  end_ts_utc TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT valid_time_range CHECK (end_ts_utc > start_ts_utc)
);

-- Index for efficient queries by user
CREATE INDEX IF NOT EXISTS idx_availability_user_id ON availability_windows(user_id);
CREATE INDEX IF NOT EXISTS idx_availability_start ON availability_windows(start_ts_utc);

-- RLS for availability_windows
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own availability"
  ON availability_windows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own availability"
  ON availability_windows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own availability"
  ON availability_windows FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own availability"
  ON availability_windows FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- BUSY_BLOCKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS busy_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_ts_utc TIMESTAMPTZ NOT NULL,
  end_ts_utc TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'apple' CHECK (source IN ('apple', 'google')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT valid_busy_range CHECK (end_ts_utc > start_ts_utc)
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_busy_user_id ON busy_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_busy_user_source ON busy_blocks(user_id, source);
CREATE INDEX IF NOT EXISTS idx_busy_start ON busy_blocks(start_ts_utc);

-- RLS for busy_blocks
ALTER TABLE busy_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own busy blocks"
  ON busy_blocks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own busy blocks"
  ON busy_blocks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own busy blocks"
  ON busy_blocks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- GOOGLE_ACCOUNTS TABLE (stores OAuth tokens for Google Calendar sync)
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

-- RLS for google_accounts
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;

-- Users can read their own google account (to check if connected)
CREATE POLICY "Users can view own google account"
  ON google_accounts FOR SELECT
  USING (auth.uid() = user_id);

-- Note: Only service role (Edge Functions) can insert/update/delete
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS

-- ============================================
-- COURTS TABLE (public read)
-- ============================================
CREATE TABLE IF NOT EXISTS courts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  surface TEXT CHECK (surface IN ('hard', 'clay', 'grass') OR surface IS NULL),
  lights BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for search
CREATE INDEX IF NOT EXISTS idx_courts_name ON courts(name);

-- RLS for courts (public read, admin write)
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;

-- Anyone can read courts (including authenticated users)
CREATE POLICY "Courts are publicly readable"
  ON courts FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert/update/delete courts
-- (manage via Supabase dashboard or service role key)

-- ============================================
-- SEED DATA: Sample Courts
-- ============================================
INSERT INTO courts (name, address, surface, lights) VALUES
  ('Central Park Tennis Center', '93rd St & West Drive, New York, NY', 'hard', true),
  ('Riverside Park Courts', '96th St & Riverside Dr, New York, NY', 'hard', true),
  ('Fort Greene Park', 'Washington Park, Brooklyn, NY', 'hard', false),
  ('McCarren Park', 'Lorimer St & Driggs Ave, Brooklyn, NY', 'hard', true),
  ('Prospect Park Tennis Center', 'Parkside Ave, Brooklyn, NY', 'clay', true),
  ('USTA Billie Jean King National Tennis Center', 'Flushing Meadows, Queens, NY', 'hard', true),
  ('Cunningham Park', '196th St & Union Tpke, Queens, NY', 'hard', false),
  ('Lincoln Terrace Park', 'Rochester Ave, Brooklyn, NY', 'hard', false)
ON CONFLICT DO NOTHING;

-- ============================================
-- PROPOSALS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- nullable for now (open proposals)
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  start_ts_utc TIMESTAMPTZ NOT NULL,
  end_ts_utc TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT valid_proposal_range CHECK (end_ts_utc > start_ts_utc)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_proposals_to_user_status_created
  ON proposals(to_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_from_user_status_created
  ON proposals(from_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_court ON proposals(court_id);

-- RLS for proposals
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

-- Participants can read their proposals
CREATE POLICY "Users can view proposals they participate in"
  ON proposals FOR SELECT
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Users can create proposals where they are the sender
CREATE POLICY "Users can create proposals as sender"
  ON proposals FOR INSERT
  WITH CHECK (auth.uid() = from_user_id);

-- Sender can update their own proposals (cancel)
CREATE POLICY "Sender can update own proposals"
  ON proposals FOR UPDATE
  USING (auth.uid() = from_user_id);

-- Recipient can update proposals sent to them (accept/decline)
CREATE POLICY "Recipient can update proposals sent to them"
  ON proposals FOR UPDATE
  USING (auth.uid() = to_user_id);

-- ============================================
-- BOOKINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id UUID NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE CASCADE,
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  start_ts_utc TIMESTAMPTZ NOT NULL,
  end_ts_utc TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT valid_booking_range CHECK (end_ts_utc > start_ts_utc)
);

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_bookings_proposal ON bookings(proposal_id);
CREATE INDEX IF NOT EXISTS idx_bookings_court ON bookings(court_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_ts_utc);

-- RLS for bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Participants can read bookings (via proposal relationship)
CREATE POLICY "Participants can view their bookings"
  ON bookings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = bookings.proposal_id
      AND (p.from_user_id = auth.uid() OR p.to_user_id = auth.uid())
    )
  );

-- Only allow insert via proposal acceptance (checked by app logic)
CREATE POLICY "System can create bookings for accepted proposals"
  ON bookings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = proposal_id
      AND (p.from_user_id = auth.uid() OR p.to_user_id = auth.uid())
      AND p.status = 'accepted'
    )
  );

-- ============================================
-- FUNCTION: Accept proposal and create booking (transaction-safe, idempotent)
-- ============================================
CREATE OR REPLACE FUNCTION accept_proposal(proposal_id_param UUID)
RETURNS UUID AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_booking_id UUID;
  v_existing_booking_id UUID;
BEGIN
  -- Lock and fetch the proposal
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = proposal_id_param
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found';
  END IF;

  -- Check if user is the recipient
  IF v_proposal.to_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the recipient can accept this proposal';
  END IF;

  -- Check if already accepted (idempotent - return existing booking)
  IF v_proposal.status = 'accepted' THEN
    SELECT id INTO v_existing_booking_id FROM bookings WHERE proposal_id = proposal_id_param;
    RETURN v_existing_booking_id;
  END IF;

  -- Check if proposal is still pending
  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending (status: %)', v_proposal.status;
  END IF;

  -- Update proposal status
  UPDATE proposals SET status = 'accepted' WHERE id = proposal_id_param;

  -- Create booking
  INSERT INTO bookings (proposal_id, court_id, start_ts_utc, end_ts_utc)
  VALUES (proposal_id_param, v_proposal.court_id, v_proposal.start_ts_utc, v_proposal.end_ts_utc)
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
