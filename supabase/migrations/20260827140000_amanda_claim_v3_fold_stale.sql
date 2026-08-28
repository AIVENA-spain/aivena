-- Amanda engine — claim v3 (live-demo fixes, 2026-08-27).
--
-- v2 field bugs, both observed live during Christian's demo:
--   1. DOUBLE REPLY after a stale-lease recovery: the newer-sibling exclusion
--      and the burst fold only considered status='pending' siblings, so a
--      deploy-orphaned 'processing' row survived the fold and fired its own
--      redundant turn after the newer message's turn had already answered
--      (buyer got "here are two options" then "want me to send options?").
--      v3 treats an expired-lease 'processing' row exactly like a pending one
--      in BOTH places: it blocks older siblings from claiming and it gets
--      folded when a newer buyer message claims.
--   2. 15-MINUTE STALL: the batch-wide 900s lease + a mid-turn SIGTERM
--      silenced the conversation until lease expiry. The worker now leases
--      300s per row (re-upped at each turn start) and identifies itself with
--      an instance-unique p_leased_by so shutdown logic can reason about
--      ownership.
--   3. Burst debounce 12s -> 6s (latency budget: debounce + 5s tick + model).
--
-- Signature change (adds p_leased_by). Deploy-order safety: the running API
-- still calls the 2-arg form until its own deploy lands, so v3 ships as a
-- 3-arg function WITHOUT defaults plus a 2-arg wrapper delegating to it —
-- distinct arities, no overload ambiguity, nothing breaks in either order.

DROP FUNCTION IF EXISTS public.pick_and_claim_amanda_inbound(integer, integer);

CREATE FUNCTION public.pick_and_claim_amanda_inbound(
  p_limit integer,
  p_lease_seconds integer,
  p_leased_by text
)
 RETURNS SETOF public.amanda_inbound_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  -- §4 ordering machinery (v3):
  --   · per-conversation SERIALIZATION — a conversation with a live 'processing'
  --     row is untouchable (no concurrent turns on one conversation, ever);
  --   · 6s BURST DEBOUNCE for buyer messages — a message row becomes claimable
  --     only once 6s old, and only if it is the NEWEST claimable buyer message
  --     of its conversation (pending OR stale-processing — a typing burst AND a
  --     crash-orphaned row settle into ONE turn on the last message, the rest
  --     folded; their text is in conversation context regardless);
  --   · internal kinds (ticket_answered / system / agency_edit) skip the
  --     debounce but still respect the serialization.
  WITH claimable AS (
    SELECT q.*
    FROM public.amanda_inbound_queue q
    WHERE ((q.status = 'pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= now()))
        OR (q.status = 'processing' AND q.lease_expires_at < now()))   -- stale lease steal
      AND NOT EXISTS (
        SELECT 1 FROM public.amanda_inbound_queue live
        WHERE live.conversation_id = q.conversation_id
          AND live.status = 'processing' AND live.lease_expires_at >= now()
      )
    FOR UPDATE OF q SKIP LOCKED   -- two workers can never claim/fold the same rows
  ),
  eligible AS (
    SELECT c.id, c.conversation_id, c.created_at,
           (c.kind IN ('message', 'media')) AS is_buyer_msg
    FROM claimable c
    WHERE c.kind NOT IN ('message', 'media')
       OR (c.created_at <= now() - interval '6 seconds'
           AND NOT EXISTS (
             SELECT 1 FROM public.amanda_inbound_queue newer
             WHERE newer.conversation_id = c.conversation_id
               AND newer.kind IN ('message', 'media')
               AND (newer.status = 'pending'
                    OR (newer.status = 'processing' AND newer.lease_expires_at < now()))
               AND newer.created_at > c.created_at
           ))
  ),
  one_per_conversation AS (
    SELECT e.id, e.conversation_id, e.is_buyer_msg
    FROM (
      SELECT e2.*, row_number() OVER (PARTITION BY e2.conversation_id ORDER BY e2.created_at ASC) AS rn
      FROM eligible e2
    ) e
    WHERE e.rn = 1
    ORDER BY e.conversation_id
    LIMIT p_limit
  ),
  folded AS (
    -- Older buyer messages of a claimed conversation collapse into the claimed
    -- (newest) one — INCLUDING crash-orphaned stale-processing rows, which is
    -- what prevents the post-recovery double reply. Their text reaches the
    -- model through conversation context regardless.
    UPDATE public.amanda_inbound_queue q
    SET status = 'skipped', processed_at = now(), lease_expires_at = NULL,
        error_message = 'superseded_by_newer_inbound (burst fold)'
    FROM one_per_conversation oc
    WHERE oc.is_buyer_msg
      AND q.conversation_id = oc.conversation_id
      AND q.id <> oc.id
      AND q.kind IN ('message', 'media')
      AND (q.status = 'pending'
           OR (q.status = 'processing' AND q.lease_expires_at < now()))
    RETURNING q.id
  )
  UPDATE public.amanda_inbound_queue q
  SET status = 'processing',
      attempts = q.attempts + 1,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      leased_by = p_leased_by
  WHERE q.id IN (SELECT id FROM one_per_conversation)
  RETURNING q.*;
END;
$function$;

-- 2-arg compatibility wrapper (the pre-v3 API deploy calls this; keep until
-- the fleet is on v3 code, then it can be dropped in a later cleanup).
CREATE FUNCTION public.pick_and_claim_amanda_inbound(p_limit integer, p_lease_seconds integer)
 RETURNS SETOF public.amanda_inbound_queue
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM public.pick_and_claim_amanda_inbound(p_limit, p_lease_seconds, 'api-worker');
$$;

REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer, text) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) TO service_role;
