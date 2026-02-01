-- Migration: Add optional message field to proposals
-- Purpose: Allow users to include a message when sending match invites

-- Add message field to proposals (nullable, optional)
ALTER TABLE proposals 
ADD COLUMN IF NOT EXISTS message TEXT;

-- Add updated_at field for tracking changes (optional but useful)
ALTER TABLE proposals 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger to update updated_at on row update
CREATE OR REPLACE FUNCTION update_proposals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_proposals_updated_at ON proposals;
CREATE TRIGGER trigger_update_proposals_updated_at
  BEFORE UPDATE ON proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_proposals_updated_at();

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
