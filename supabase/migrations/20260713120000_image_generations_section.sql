-- Studio library "sections" (Packet 4, Christian 2026-07-13).
--
-- Adds a free-text `section` to image_generations so a creation can be filed into an agency-defined
-- bucket at save time ("when you generate you tick which section it belongs to and then it ends up
-- there"). ADDITIVE + nullable → existing rows keep NULL (shown as unfiled), no behaviour change; fully
-- reversible with `ALTER TABLE image_generations DROP COLUMN section;`.
--
-- image_generations is a deploy-only table (created out of band, not in migration history), so this file
-- is the first migration to touch it and is written IDEMPOTENT.

ALTER TABLE public.image_generations
  ADD COLUMN IF NOT EXISTS section text;

-- Fast per-agency section listing / grouping (partial: only rows that are actually filed).
CREATE INDEX IF NOT EXISTS idx_image_generations_agency_section
  ON public.image_generations (agency_id, section)
  WHERE section IS NOT NULL;
