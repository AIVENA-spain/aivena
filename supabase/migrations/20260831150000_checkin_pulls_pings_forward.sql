-- Applied 2026-08-31. An agent coming online gets the waiting questions NOW.
-- The pinger pushes next_ping_at forward whenever it cannot deliver, and "the
-- agent's 24h window is shut" is the commonest reason — so without this, an
-- agent messages in and the pending question is still parked up to 45 minutes
-- out, which reads as broken. A trigger, so it holds for every path that
-- stamps presence, not just today's webhook.
CREATE OR REPLACE FUNCTION public.pull_pings_forward_on_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.last_checkin_at IS DISTINCT FROM OLD.last_checkin_at
     AND NEW.last_checkin_at IS NOT NULL
     AND NEW.receives_pings
     AND NEW.status = 'active'
  THEN
    UPDATE public.amanda_questions q
       SET next_ping_at = now()
     WHERE q.agency_id = NEW.agency_id
       AND q.status IN ('open', 'clarifying')
       AND COALESCE(q.pings_sent, 0) < 3
       AND q.next_ping_at > now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pull_pings_forward_on_checkin ON public.agency_agents;
CREATE TRIGGER trg_pull_pings_forward_on_checkin
  AFTER UPDATE OF last_checkin_at ON public.agency_agents
  FOR EACH ROW EXECUTE FUNCTION public.pull_pings_forward_on_checkin();
