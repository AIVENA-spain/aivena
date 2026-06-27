-- migration: apply_template_provider_status_revoke_aivena_app  (sync hardening, least-privilege)
-- The reconcile function is only ever called by the twilio-template-sync Edge Function, which
-- connects as service_role. aivena_app had received EXECUTE via the project-wide default-privilege
-- grant on new functions; remove it so the provider-status reconcile path is service_role-only.
-- The API never calls this function.

revoke execute on function public.apply_template_provider_status(jsonb) from aivena_app;
