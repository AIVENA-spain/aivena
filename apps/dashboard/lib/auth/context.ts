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

type EmbeddedRow = UserAgencyRow & {
  // PostgREST returns the embedded record as an object for many-to-one,
  // but Supabase's generated typings often widen it to object | array | null.
  agencies: AgencyRow | AgencyRow[] | null;
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

function pickAgency(value: AgencyRow | AgencyRow[] | null): AgencyRow | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
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

  let memberships: AgencyMembership[] = [];

  const embedded = await supabase
    .from("user_agencies")
    .select(
      "agency_id, role, is_default, agencies ( id, slug, trading_name, legal_name, status, primary_region, supported_languages )",
    );

  if (!embedded.error && embedded.data) {
    const rows = embedded.data as unknown as EmbeddedRow[];
    memberships = rows.map((r) =>
      buildMembership(
        { agency_id: r.agency_id, role: r.role, is_default: r.is_default },
        pickAgency(r.agencies),
      ),
    );
  } else {
    // Fallback: two queries if the embed relationship can't be resolved.
    const ua = await supabase
      .from("user_agencies")
      .select("agency_id, role, is_default");

    if (ua.error || !ua.data) {
      return {
        userId: user.id,
        email: user.email ?? "",
        memberships: [],
        activeAgency: null,
        isAivenaStaff: false,
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
    memberships = uaRows.map((r) =>
      buildMembership(r, agencyById.get(r.agency_id) ?? null),
    );
  }

  const activeAgency =
    memberships.find((m) => m.isDefault) ?? memberships[0] ?? null;
  const isAivenaStaff = memberships.some((m) => m.role === "aivena_staff");

  return {
    userId: user.id,
    email: user.email ?? "",
    memberships,
    activeAgency,
    isAivenaStaff,
  };
}
