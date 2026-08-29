-- Applied 2026-08-29. See the migration comment for the reasoning.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS listed_at timestamptz;

COMMENT ON COLUMN properties.listed_at IS
  'When the SOURCE says the listing went live. NULL = unknown; newness ranking falls back to created_at and Amanda will not claim newness.';

CREATE INDEX IF NOT EXISTS idx_properties_agency_listed_at
  ON properties (agency_id, listed_at DESC NULLS LAST);
