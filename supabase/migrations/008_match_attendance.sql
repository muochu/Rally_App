-- Migration: Match Attendance Tracking
-- Purpose: Track when users confirm they're at a match

-- ============================================
-- MATCH_ATTENDANCE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS match_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- One confirmation per user per proposal
  UNIQUE(proposal_id, user_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_match_attendance_proposal ON match_attendance(proposal_id);
CREATE INDEX IF NOT EXISTS idx_match_attendance_user ON match_attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_match_attendance_confirmed ON match_attendance(confirmed_at);

-- RLS for match_attendance
ALTER TABLE match_attendance ENABLE ROW LEVEL SECURITY;

-- Users can view attendance for proposals they're involved in
CREATE POLICY "Users can view attendance for their proposals"
  ON match_attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = match_attendance.proposal_id
      AND (p.from_user_id = auth.uid() OR p.to_user_id = auth.uid())
    )
  );

-- Users can confirm their own attendance
CREATE POLICY "Users can confirm their own attendance"
  ON match_attendance FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = proposal_id
      AND (p.from_user_id = auth.uid() OR p.to_user_id = auth.uid())
      AND p.status = 'accepted'
    )
  );
