-- Least-privilege hardening for agent_send_voice_recovery: Supabase default
-- privileges auto-grant EXECUTE on new public functions to authenticated + anon,
-- and REVOKE FROM PUBLIC does not strip those named-role grants. Only aivena_app
-- (the app role, inside the agency-context tx) should execute this send RPC.
REVOKE EXECUTE ON FUNCTION public.agent_send_voice_recovery(uuid, text) FROM authenticated, anon;
