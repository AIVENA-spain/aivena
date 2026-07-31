-- P0 FIX (QA audit 2026-07-27). apply_conversation_interest(uuid,text,text,uuid) is SECURITY DEFINER
-- and was inadvertently left EXECUTE-able by anon + authenticated after migration
-- 20260717145317_llm_intent_extraction_dispatcher DROPped + recreated it: the recreate re-acquired
-- Supabase's default function grants to anon/authenticated, and that migration revoked only PUBLIC.
-- The function is reachable via PostgREST RPC and trusts its agency_id/lead_id parameters, so the
-- stray grants form a cross-agency write primitive. This restores the intended grant set
-- {postgres, service_role, aivena_app}, matching the sibling El Raso functions and the earlier 3-arg
-- revoke (20260704185056_revoke_authenticated_execute_w4c_and_apply_interest).
--
-- GRANT-ONLY change: the function body + signature are UNCHANGED (no DROP/CREATE). The live caller is
-- the SECURITY DEFINER trigger trg_message_apply_interest (runs as its postgres owner, unaffected).
-- aivena_app RETAINS EXECUTE for the server-side application path. No sibling function is touched. No
-- data is read or written.
--
-- Rollback (documented; do NOT run):
--   GRANT EXECUTE ON FUNCTION public.apply_conversation_interest(uuid, text, text, uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_conversation_interest(uuid, text, text, uuid)
  FROM anon, authenticated, PUBLIC;
