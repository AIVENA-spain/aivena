/**
 * Types for the Admin → Agencies surface (/api/v1/admin/*). These mirror the
 * shapes returned by Vega's `admin_*` RPCs as proxied by the Hono admin routes.
 * The admin UI is English-only (see brief §12), so no i18n keys here.
 */

export type PlanTier = "starter" | "pro" | "unlimited";
export type AgencyStatus = "active" | "paused" | "archived";
export type InviteRole = "owner" | "agent" | "viewer";

/** One row in the agency list (GET /api/v1/admin/agencies). */
export type AdminAgencyListItem = {
  id: string;
  slug: string;
  trading_name: string | null;
  legal_name: string | null;
  status: AgencyStatus;
  plan_tier: PlanTier;
  default_language: string | null;
  primary_owner_email: string | null;
  primary_region: string | null;
  user_count: number;
  pending_invitation_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminAgenciesResponse = {
  ok: true;
  agencies: AdminAgencyListItem[];
};

/** Full agency record (GET /api/v1/admin/agencies/:id). */
export type AdminAgencyDetail = {
  agency: Record<string, unknown> & {
    id: string;
    slug: string;
    trading_name: string | null;
    legal_name: string | null;
    status: AgencyStatus;
    primary_owner_email: string | null;
    primary_region: string | null;
  };
  settings: Record<string, unknown> | null;
  branding: Record<string, unknown> | null;
  user_count: number;
  pending_invitation_count: number;
  last_activity_at: string | null;
};

/** Body for POST /api/v1/admin/agencies. */
export type CreateAgencyInput = {
  slug: string;
  trading_name: string;
  legal_name?: string;
  cif_nif?: string;
  primary_owner_email: string;
  primary_owner_phone?: string;
  primary_region?: string;
  supported_languages: string[];
  default_language: string;
  plan_tier: PlanTier;
  send_invitation: boolean;
};

export type CreateAgencyResult = {
  ok: true;
  agency_id: string;
  invitation_id?: string | null;
  /** Raw invite token — the wizard builds /invite/accept?token=… from it. */
  invitation_token?: string | null;
  invitation_expires_at?: string | null;
};

export type SlugCheckResult = {
  available: boolean;
  reason?: string | null;
};
