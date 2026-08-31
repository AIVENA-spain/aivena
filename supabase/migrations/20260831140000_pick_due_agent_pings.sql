-- Applied 2026-08-31. Cross-agency picker for agent question pings.
-- SECURITY DEFINER because amanda_questions forces RLS and the ping worker runs
-- with no app.current_agency_id — a direct SELECT matched nothing and the
-- worker silently did nothing every tick. Claims by moving next_ping_at.
CREATE OR REPLACE FUNCTION public.pick_due_agent_pings(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, agency_id text, short_code int, question_text text,
  question_lang text, pings_sent int, lead_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT q.id FROM public.amanda_questions q
     WHERE q.status IN ('open', 'clarifying')
       AND COALESCE(q.pings_sent, 0) < 3
       AND (q.next_ping_at IS NULL OR q.next_ping_at <= now())
     ORDER BY q.created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.amanda_questions q SET next_ping_at = now() + interval '45 minutes'
      FROM due WHERE q.id = due.id
    RETURNING q.id, q.agency_id, q.short_code, q.question_text,
              q.question_lang, COALESCE(q.pings_sent, 0) AS pings_sent, q.lead_id
  )
  SELECT c.id, c.agency_id, c.short_code::int, c.question_text,
         c.question_lang, c.pings_sent::int, l.full_name
    FROM claimed c LEFT JOIN public.leads l ON l.id = c.lead_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pick_due_agent_pings(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_due_agent_pings(int) TO aivena_app;
