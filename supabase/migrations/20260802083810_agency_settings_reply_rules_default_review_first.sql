-- P3 fix (QA audit 2026-07-27): the agency_settings.reply_rules column DEFAULT seeded
-- default_lane='auto_send' (all temperatures + all portal sources + voice_recovery = auto_send) — the
-- inverse of AIVENA's approval-first posture. admin_create_agency INSERTs agency_settings WITHOUT
-- reply_rules (verified: the function never references reply_rules), so new agencies inherited this
-- auto-send default. This flips the SEED to approval-first (every lane review_first). Structure is
-- identical; only the auto_send values become review_first (language_overrides was already review_first).
--
-- DEFAULT-ONLY change: SET DEFAULT applies ONLY to future inserts. NO existing agency_settings row is
-- rewritten — the one non-test agency (demo-costa-homes-pilot01) is already review_first; the 4 test
-- agencies keep auto_send (left as-is; not needed for tests). No send function, no automation toggle,
-- no provider setting is touched. No data rows are read or written. send_queue delta = 0.
--
-- Rollback (documented; do NOT run):
--   ALTER TABLE public.agency_settings ALTER COLUMN reply_rules SET DEFAULT '{"by_action": {}, "by_source": {"missed_call": "auto_send", "portal_pisos": "auto_send", "portal_fotocasa": "auto_send", "portal_idealista": "auto_send", "portal_habitaclia": "auto_send"}, "by_channel": {"voice_recovery": "auto_send"}, "default_lane": "auto_send", "by_temperature": {"hot": "auto_send", "cold": "auto_send", "warm": "auto_send", "super_hot": "auto_send"}, "language_overrides": {"if_lead_language_not_in_supported": "review_first"}}'::jsonb;
ALTER TABLE public.agency_settings
  ALTER COLUMN reply_rules SET DEFAULT '{"by_action": {}, "by_source": {"missed_call": "review_first", "portal_pisos": "review_first", "portal_fotocasa": "review_first", "portal_idealista": "review_first", "portal_habitaclia": "review_first"}, "by_channel": {"voice_recovery": "review_first"}, "default_lane": "review_first", "by_temperature": {"hot": "review_first", "cold": "review_first", "warm": "review_first", "super_hot": "review_first"}, "language_overrides": {"if_lead_language_not_in_supported": "review_first"}}'::jsonb;
