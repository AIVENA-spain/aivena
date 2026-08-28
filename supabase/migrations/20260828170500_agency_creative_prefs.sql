-- Studio taste profile (Christian 2026-08-28: "at least 10 this-or-that choices to find out what
-- they like — font wise, color wise, size wise — and then base the templates on that for this
-- specific agency"). One nullable jsonb on agency_branding; written only via the authenticated
-- Studio preferences endpoint (RLS-fenced tx), read by the carousel pipeline for style
-- recommendations, edition matching and art-direction hints. Additive and nullable — no
-- existing behaviour changes until an agency plays the game.
ALTER TABLE public.agency_branding ADD COLUMN IF NOT EXISTS creative_prefs jsonb;
