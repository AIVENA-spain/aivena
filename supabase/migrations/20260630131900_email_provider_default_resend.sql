-- D6 — agency_settings.email_provider default 'postmark' -> 'resend' (Chat 3 CC, 2026-06-30).
--
-- WHY: the column defaulted to a stale 'postmark', but NO send path reads it:
--   * n8n Send-Pusher `3C. Send-Pusher v0` sends email unconditionally via a hardcoded
--     "Send via Resend" HTTP node (zero email_provider/postmark references);
--   * the dashboard/API repo never references email_provider;
--   * admin_create_agency already INSERTs email_provider = 'resend', so new agencies via
--     the real creation path already get resend.
-- The 'postmark' default was therefore dead AND misleading (stored value != actual Resend
-- sender — a Law-1 truth mismatch). This aligns the schema default with reality and fixes
-- the one stale row (demo-costa-homes-pilot01, the only agency still showing 'postmark').
--
-- TRUTH-ALIGNMENT ONLY — ZERO send-behavior change. Send workflows are NOT touched.
--
-- ROLLBACK:
--   ALTER TABLE public.agency_settings ALTER COLUMN email_provider SET DEFAULT 'postmark';
--   (data revert unnecessary — no behaviour depends on the column value.)

ALTER TABLE public.agency_settings
  ALTER COLUMN email_provider SET DEFAULT 'resend';

UPDATE public.agency_settings
  SET email_provider = 'resend'
  WHERE email_provider = 'postmark';
