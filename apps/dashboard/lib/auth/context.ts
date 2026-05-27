import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AgencyRole = "owner" | "agent" | "viewer" | "aivena_staff";

export type AgencyMembership = {
  agencyId: string;
  role: AgencyRole;
  isDefault: boolean;
  agency: {
    id: string;
    displayName: string;
    slug: string | null;
    status: string;
    region: string | null;
    languages: string[];
  };
};

export type UserContext = {
  userId: string;
  email: string;
  memberships: AgencyMembership[];
  activeAgency: AgencyMembership | null;
  isAivenaStaff: boolean;
  /**
   * The user's chosen UI language from `public.user_preferences.ui_language`
   * (DB-authoritative). Used by `(app)/layout.tsx` to reconcile drift with the
   * `aivena_ui_language` cookie. `null` if the row isn't readable for some
   * reason (RLS denial, missing row, transient error) — callers must tolerate.
   */
  uiLanguage: string | null;
};

type AgencyRow = {
  id: string;
  slug: string | null;
  trading_name: string | null;
  legal_name: string | null;
  status: string;
  primary_region: string | null;
  supported_languages: string[] | null;
};

type UserAgencyRow = {
  agency_id: string;
  role: string;
  is_default: boolean;
};

type UserPreferencesRow = {
  ui_language: string | null;
};

const ALLOWED_ROLES: ReadonlySet<AgencyRole> = new Set([
  "owner",
  "agent",
  "viewer",
  "aivena_staff",
]);

function normalizeRole(value: string): AgencyRole {
  return ALLOWED_ROLES.has(value as AgencyRole)
    ? (value as AgencyRole)
    : "viewer";
}

function buildMembership(
  row: UserAgencyRow,
  agency: AgencyRow | null,
): AgencyMembership {
  const a = agency ?? {
    id: row.agency_id,
    slug: null,
    trading_name: null,
    legal_name: null,
    status: "unknown",
    primary_region: null,
    supported_languages: null,
  };
  const displayName =
    a.trading_name || a.legal_name || a.slug || a.id;
  return {
    agencyId: row.agency_id,
    role: normalizeRole(row.role),
    isDefault: Boolean(row.is_default),
    agency: {
      id: a.id,
      displayName,
      slug: a.slug,
      status: a.status,
      region: a.primary_region,
      languages: a.supported_languages ?? [],
    },
  };
}

export async function getCurrentUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Two-step explicit query: we don't rely on PostgREST's embedded FK join
  // between user_agencies and agencies — its schema cache for that relationship
  // is fragile and goes cold often enough that the embed isn't worth the risk.
  //
  // user_preferences is fetched in parallel with user_agencies so we don't add
  // a serialised round-trip. RLS gates user_preferences on auth.uid(), so the
  // user's session-bound Supabase client reads its own row natively.
  const [ua, prefs] = await Promise.all([
    supabase
      .from("user_agencies")
      .select("agency_id, role, is_default"),
    supabase
      .from("user_preferences")
      .select("ui_language")
      .maybeSingle(),
  ]);

  const uiLanguage =
    prefs.error || !prefs.data
      ? null
      : ((prefs.data as unknown as UserPreferencesRow).ui_language ?? null);

  if (ua.error || !ua.data) {
    return {
      userId: user.id,
      email: user.email ?? "",
      memberships: [],
      activeAgency: null,
      isAivenaStaff: false,
      uiLanguage,
    };
  }

  const uaRows = ua.data as unknown as UserAgencyRow[];
  const ids = uaRows.map((r) => r.agency_id);
  let agencyById = new Map<string, AgencyRow>();
  if (ids.length > 0) {
    const ags = await supabase
      .from("agencies")
      .select(
        "id, slug, trading_name, legal_name, status, primary_region, supported_languages",
      )
      .in("id", ids);
    if (!ags.error && ags.data) {
      const agRows = ags.data as unknown as AgencyRow[];
      agencyById = new Map(agRows.map((a) => [a.id, a]));
    }
  }
  const memberships: AgencyMembership[] = uaRows.map((r) =>
    buildMembership(r, agencyById.get(r.agency_id) ?? null),
  );

  const activeAgency =
    memberships.find((m) => m.isDefault) ?? memberships[0] ?? null;
  const isAivenaStaff = memberships.some((m) => m.role === "aivena_staff");

  return {
    userId: user.id,
    email: user.email ?? "",
    memberships,
    activeAgency,
    isAivenaStaff,
    uiLanguage,
  };
}
