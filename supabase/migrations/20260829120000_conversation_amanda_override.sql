-- Per-conversation automation override (Christian 2026-08-29: "they should also
-- have the option to turn off automation on one person fully or turn on
-- automation fully on one person, maybe like a switch").
--
-- NULL = follow the agency dial (the default, and what every existing row keeps).
-- A value = this ONE conversation runs at that level instead.
--
-- Deliberate limits, enforced in the engine (process-turn-db.ts), not here:
--   * agency amanda_mode='off' still wins absolutely — a global off is a kill
--     switch and no per-conversation override may resurrect Amanda through it.
--   * ai_muted_at / human_claimed_at still hard-stop the turn; the UI switch
--     clears them when someone hands the conversation back to Amanda.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS amanda_mode_override text
    CHECK (
      amanda_mode_override IS NULL
      OR amanda_mode_override IN ('off', 'shadow', 'approval', 'assisted', 'full')
    );

COMMENT ON COLUMN conversations.amanda_mode_override IS
  'NULL = follow agency_settings.amanda_mode. Set = this conversation only. Agency off still wins.';
