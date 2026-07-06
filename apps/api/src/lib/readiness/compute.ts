/**
 * Readiness model (Phase 1) — PURE compute. No I/O, no DB, no Date.now().
 *
 * The route gathers raw live signals (each in its own savepoint so a missing
 * table/RPC degrades that one signal instead of aborting the request) and hands
 * them to `computeReadiness`, which derives per-item + per-provider + per-gate
 * status entirely from those signals.
 *
 * Hard rules (mirror the workboard Safety/proof checklist):
 *  - No fake states. Every item carries a `signal.source`; a null signal yields
 *    `unavailable` / `needs_verify`, never an invented "ready"/"connected".
 *  - Email is NEVER "verified" without a real provider signal (none exists in
 *    the DB today → it is `live_but_unproven`, "configured, not proven").
 *  - WhatsApp readiness is CONSUMED from Chat 3's RPC, never re-derived here; a
 *    null `whatsapp` signal (RPC not deployed) → `unavailable`, never blocked-as-fake.
 *  - The admin go-live decision is a Phase-3 write; Phase 1 only reports
 *    eligibility signals and always returns `goLive.eligible=false`.
 */

export type ReadinessStatus =
  | 'ready'
  | 'live_but_unproven'
  | 'manual_fallback'
  | 'missing'
  | 'blocked'
  | 'needs_decision'
  | 'unavailable';

export type ReadinessOwner = 'agency' | 'aivena' | 'system';

export type Gate =
  | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10' | 'G11';

/** A status counts as "satisfied for gate purposes" only if it is genuinely
 *  done OR an explicitly-acceptable manual fallback. Everything else blocks. */
const SATISFIED: ReadonlySet<ReadinessStatus> = new Set(['ready', 'manual_fallback']);

export type ReadinessItem = {
  id: string;
  label: string;
  area: string; // workboard area letter A–X
  gate: Gate;
  owner: ReadinessOwner;
  status: ReadinessStatus;
  agencyEditable: boolean;
  /** null = no admin-approval concept; false = required & not yet approved (no store yet → Phase 3). */
  adminApproved: boolean | null;
  signal: { source: string; value: string };
  uiCopy: string;
  blockedBy: string[];
};

export type ReadinessProvider = {
  provider: 'email' | 'whatsapp' | 'whatsapp_templates_multilang' | 'calendar' | 'property_feed';
  status: ReadinessStatus;
  detail: string;
  source: string;
};

export type ReadinessGate = {
  gate: Gate;
  status: 'open' | 'blocked';
  blockedBy: string[];
};

/** Agency global pilot lifecycle (agencies.pilot_status, C2). */
export type PilotStatus = 'setup' | 'ready_for_pilot' | 'live' | 'paused' | 'blocked';

export type ReadinessResponse = {
  agencyId: string;
  /** The real agencies.pilot_status (C2); null if unreadable / unknown value. Read-only here. */
  pilotStatus: PilotStatus | null;
  items: ReadinessItem[];
  providers: ReadinessProvider[];
  gates: ReadinessGate[];
  goLive: {
    eligible: boolean;
    scope: string;
    blockedBy: string[];
    /** O5: catalog is a HARD, non-overridable go-live blocker (B1) — true only when enforcing AND the catalog fails a correctness check. */
    catalogHardBlock: boolean;
    catalogDetail: string;
    /** Gap-C: a real accepted DPA row exists → the dpa_consent_live attestation is signal-backed (auto-satisfied). */
    dpaAccepted: boolean;
    note: string;
  };
};

// --- Signal inputs (what the route gathers; null = could not read → degrade) ---

export type WhatsAppSignal = {
  whatsapp_sender_ready: boolean;
  whatsapp_channel_enabled: boolean;
  templates_provider_approved: { count: number };
  languages_ready: string[];
  template_send_path_proven: boolean;
  last_provider_sync_at: string | null;
};

export type ReadinessSignals = {
  agency: {
    legal_name: string | null;
    trading_name: string | null;
    status: string | null;
    primary_region: string | null;
    supported_languages: string[] | null;
  } | null;
  branding: {
    logo_url: string | null;
    primary_color: string | null;
    accent_color: string | null;
    phone: string | null;
    website_url: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    branding_reviewed_at: string | null;
  } | null;
  settings: {
    supported_languages: string[] | null;
    timezone: string | null;
    working_hours: Record<string, unknown> | null;
    tone: string | null;
    reply_rules: Record<string, unknown> | null;
    human_approval_required: boolean | null;
    reply_handling_mode: string | null;
  } | null;
  email: { from_email: string | null; send_proven: boolean | null; send_proven_at: string | null } | null;
  team: { owners: number; agents: number } | null;
  templates: { enApproved: number; nonEnApproved: number } | null;
  properties: {
    total_active: number; real_source_active: number; with_embedding: number;
    with_hotlinked_images: number; area_ambiguous: number; thin_description: number; no_image: number;
  } | null;
  consent: { count: number } | null;
  /** Gap-C: a real accepted DPA row (agency_agreements). null = read failed → treated as not-accepted. */
  agreements: { dpaAccepted: boolean; dpaVersion: string | null; dpaAcceptedAt: string | null } | null;
  calendar: { oauthCount: number } | null;
  /** null = the WhatsApp readiness RPC could not be consumed (not deployed / failed). */
  whatsapp: WhatsAppSignal | null;
  /** agencies.pilot_status (C2); null if unreadable or an unknown value. */
  pilotStatus: PilotStatus | null;
};

// --- helpers -----------------------------------------------------------------

const has = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/** A placeholder website is the AIVENA marketing site standing in for a real agency site. */
const isPlaceholderWebsite = (url: string | null): boolean =>
  has(url) && /(^|\/\/|\.)aivena\.es(\/|$)/i.test(url as string);

function workingHoursTimezone(wh: Record<string, unknown> | null): string | null {
  const tz = wh && typeof wh === 'object' ? (wh as { timezone?: unknown }).timezone : null;
  return typeof tz === 'string' && tz.length > 0 ? tz : null;
}

function anyDayEnabled(wh: Record<string, unknown> | null): boolean {
  if (!wh || typeof wh !== 'object') return false;
  return Object.values(wh).some(
    (slot) => slot && typeof slot === 'object' && (slot as { enabled?: unknown }).enabled === true,
  );
}

function defaultLane(reply_rules: Record<string, unknown> | null): string | null {
  const dl = reply_rules && typeof reply_rules === 'object' ? (reply_rules as { default_lane?: unknown }).default_lane : null;
  return typeof dl === 'string' ? dl : null;
}

// --- the compute -------------------------------------------------------------

// O5 — minimum active properties for a real catalog (tunable). Below this = "no real catalog".
const MIN_ACTIVE_CATALOG = 10;

/**
 * O5 — assess catalog quality from the gathered signals. `hardFail` = a correctness/honesty
 * failure (the B1 hard blocker): no real catalog / demo-only / mixed / below-min / hotlinked images.
 * Everything else (enrichment gaps, sub-90% embeddings, unlabelled area while built-vs-plot is
 * pending) is WARN-only and never blocks. A null signal degrades to unavailable (never blocks).
 */
function assessCatalog(p: ReadinessSignals['properties']): { status: ReadinessStatus; hardFail: boolean; detail: string } {
  if (p === null) return { status: 'unavailable', hardFail: false, detail: 'catalog read unavailable' };
  const hard: string[] = [];
  const warn: string[] = [];
  if (p.total_active === 0) hard.push('no properties');
  else {
    if (p.real_source_active === 0) hard.push('only demo/seed data (no real source)');
    else if (p.real_source_active < p.total_active) hard.push('mixed demo + real data');
    if (p.total_active < MIN_ACTIVE_CATALOG) hard.push(`only ${p.total_active} properties (min ${MIN_ACTIVE_CATALOG})`);
    if (p.with_hotlinked_images > 0) hard.push(`${p.with_hotlinked_images} with hotlinked images (needs O3)`);
  }
  if (p.area_ambiguous > 0) warn.push(`${p.area_ambiguous} unlabelled area (built-vs-plot pending)`);
  if (p.total_active > 0 && p.with_embedding < Math.ceil(p.total_active * 0.9)) warn.push(`${p.with_embedding}/${p.total_active} matching-ready`);
  if (p.thin_description > 0) warn.push(`${p.thin_description} thin descriptions`);
  if (p.no_image > 0) warn.push(`${p.no_image} without photos`);
  const hardFail = hard.length > 0;
  const status: ReadinessStatus = hardFail ? 'missing' : warn.length ? 'manual_fallback' : 'ready';
  const detail = hardFail ? hard.join('; ') : warn.length ? warn.join('; ') : 'catalog quality OK';
  return { status, hardFail, detail };
}

export function computeReadiness(
  agencyId: string,
  s: ReadinessSignals,
  opts: { catalogEnforce?: boolean } = {},
): ReadinessResponse {
  const items: ReadinessItem[] = [];
  const push = (i: ReadinessItem) => items.push(i);

  // ---- A. Identity / profile -------------------------------------------------
  const ag = s.agency;
  const br = s.branding;
  const st = s.settings;

  push({
    id: 'identity.name', label: 'Agency name', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: ag && has(ag.legal_name) && has(ag.trading_name) ? 'ready'
      : ag && (has(ag.legal_name) || has(ag.trading_name)) ? 'live_but_unproven'
      : ag ? 'missing' : 'unavailable',
    signal: { source: 'agencies.legal_name + trading_name', value: ag ? `legal=${ag.legal_name ?? '∅'} · trading=${ag.trading_name ?? '∅'}` : 'unavailable' },
    uiCopy: ag && has(ag.legal_name) && has(ag.trading_name) ? 'Agency name set' : 'Add the legal + trading name',
    blockedBy: [],
  });

  push({
    id: 'identity.logo', label: 'Logo', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: br && has(br.logo_url) ? 'ready' : br ? 'missing' : 'unavailable',
    signal: { source: 'agency_branding.logo_url (presence; object reachability not checked in Phase 1)', value: br?.logo_url ?? 'unavailable' },
    uiCopy: br && has(br.logo_url) ? 'Logo uploaded' : 'Add your logo (a monogram is used until then)',
    blockedBy: [],
  });

  push({
    id: 'identity.colors', label: 'Brand colours', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: br && has(br.primary_color) ? 'ready' : br ? 'missing' : 'unavailable',
    signal: { source: 'agency_branding.primary_color/accent_color', value: br ? `primary=${br.primary_color ?? '∅'} · accent=${br.accent_color ?? '∅'}` : 'unavailable' },
    uiCopy: br && has(br.primary_color) ? 'Brand colours set' : 'Set your brand colour (AIVENA defaults used until then)',
    blockedBy: [],
  });

  push({
    id: 'identity.phone', label: 'Contact phone', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: br && has(br.phone) ? 'ready' : br ? 'missing' : 'unavailable',
    signal: { source: 'agency_branding.phone', value: br?.phone ?? 'unavailable' },
    uiCopy: br && has(br.phone) ? 'Contact phone set' : 'Add a contact phone',
    blockedBy: [],
  });

  const website = br?.website_url ?? null;
  push({
    id: 'identity.website', label: 'Agency website', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: !br ? 'unavailable' : isPlaceholderWebsite(website) ? 'needs_decision' : has(website) ? 'ready' : 'needs_decision',
    signal: { source: 'agency_branding.website_url', value: website ?? '∅' },
    uiCopy: isPlaceholderWebsite(website) ? 'Website points to a placeholder — confirm the agency’s real site (or confirm it is not required for pilot)' : has(website) ? 'Website set' : 'Decide whether a website is required for pilot',
    blockedBy: [],
  });

  push({
    id: 'identity.areas', label: 'Service area', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: !br ? 'unavailable' : has(br.city) && (has(br.region) || has(ag?.primary_region ?? null)) ? 'ready' : has(br.city) ? 'live_but_unproven' : 'missing',
    signal: { source: 'agency_branding.city/region/country + agencies.primary_region', value: br ? `city=${br.city ?? '∅'} · region=${br.region ?? '∅'} · primary_region=${ag?.primary_region ?? '∅'}` : 'unavailable' },
    uiCopy: has(br?.city ?? null) && (has(br?.region ?? null) || has(ag?.primary_region ?? null)) ? 'Service area set' : 'Add the service region (matching still works on zone tables)',
    blockedBy: [],
  });

  // Languages + the dual-source drift check (D7).
  const sLangs = st?.supported_languages ?? null;
  const aLangs = ag?.supported_languages ?? null;
  const langsAgree = JSON.stringify((sLangs ?? []).slice().sort()) === JSON.stringify((aLangs ?? []).slice().sort());
  push({
    id: 'identity.languages', label: 'Languages served', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: !st ? 'unavailable' : (sLangs && sLangs.length > 0) ? (langsAgree ? 'ready' : 'live_but_unproven') : 'missing',
    signal: { source: 'agency_settings.supported_languages (+ agencies.supported_languages drift check)', value: `settings=[${(sLangs ?? []).join(',')}] · agencies=[${(aLangs ?? []).join(',')}] · agree=${langsAgree}` },
    uiCopy: (sLangs && sLangs.length > 0) ? (langsAgree ? `${sLangs.length} languages served` : 'Languages set but the two source columns disagree — reconcile (D7)') : 'Choose the languages you serve',
    blockedBy: [],
  });

  // Timezone — working_hours.timezone is authoritative; flag the W3 mismatch.
  const whTz = workingHoursTimezone(st?.working_hours ?? null);
  const colTz = st?.timezone ?? null;
  const tzMismatch = has(whTz) && has(colTz) && whTz !== colTz;
  push({
    id: 'identity.timezone', label: 'Timezone', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: !st ? 'unavailable' : has(whTz) ? (tzMismatch ? 'live_but_unproven' : 'ready') : 'missing',
    signal: { source: 'agency_settings.working_hours.timezone (authoritative) vs agency_settings.timezone', value: `working_hours=${whTz ?? '∅'} · column=${colTz ?? '∅'} · mismatch=${tzMismatch}` },
    uiCopy: tzMismatch ? 'Timezone sources disagree — the W3 send-timing fix reads working_hours.timezone (J4)' : has(whTz) ? 'Timezone set' : 'Set your timezone',
    blockedBy: [],
  });

  push({
    id: 'identity.working_hours', label: 'Working hours', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: true, adminApproved: null,
    status: !st ? 'unavailable' : anyDayEnabled(st.working_hours) ? 'ready' : 'missing',
    signal: { source: 'agency_settings.working_hours (enabled day slots)', value: anyDayEnabled(st?.working_hours ?? null) ? 'at least one open day' : 'no open days' },
    uiCopy: anyDayEnabled(st?.working_hours ?? null) ? 'Working hours set' : 'Set your working hours',
    blockedBy: [],
  });

  push({
    id: 'identity.tone', label: 'Follow-up tone', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: false, adminApproved: null,
    status: !st ? 'unavailable' : has(st.tone) ? 'ready' : 'missing',
    signal: { source: 'agency_branding.tone (trigger-synced mirror of canonical agency_settings.tone — D4)', value: st?.tone ?? '∅' },
    uiCopy: has(st?.tone ?? null) ? 'Follow-up tone set (read-only during pilot)' : 'Tone not set',
    blockedBy: [],
  });

  // Approval-first posture (system safety gate).
  const approvalFirst = !!st && st.reply_handling_mode === 'manual' && st.human_approval_required === true && defaultLane(st.reply_rules) !== 'auto_send';
  push({
    id: 'posture.approval_first', label: 'Approval-first safety posture', area: 'A', gate: 'G1', owner: 'system',
    agencyEditable: false, adminApproved: null,
    status: !st ? 'unavailable' : approvalFirst ? 'ready' : 'live_but_unproven',
    signal: { source: 'agency_settings.reply_handling_mode + human_approval_required + reply_rules.default_lane', value: st ? `mode=${st.reply_handling_mode} · approval=${st.human_approval_required} · default_lane=${defaultLane(st.reply_rules) ?? '∅'}` : 'unavailable' },
    uiCopy: approvalFirst ? 'Approval-first — your team reviews before anything sends' : 'Review the automation posture before any pilot',
    blockedBy: [],
  });

  // Team.
  push({
    id: 'team.owner', label: 'Owner', area: 'A', gate: 'G1', owner: 'agency',
    agencyEditable: false, adminApproved: true,
    status: !s.team ? 'unavailable' : s.team.owners >= 1 ? 'ready' : 'missing',
    signal: { source: 'user_agencies (role=owner count)', value: s.team ? `owners=${s.team.owners}` : 'unavailable' },
    uiCopy: s.team && s.team.owners >= 1 ? 'Owner assigned' : 'Assign an agency owner',
    blockedBy: [],
  });

  push({
    id: 'team.agents', label: 'Agent seats', area: 'A', gate: 'G1', owner: 'aivena',
    agencyEditable: false, adminApproved: true,
    status: 'manual_fallback',
    signal: { source: 'user_agencies (role=agent count)', value: s.team ? `agents=${s.team.agents}` : 'unavailable' },
    uiCopy: 'Team invites are handled by AIVENA during pilot — contact us',
    blockedBy: [],
  });

  // Consent capture (mechanism exists; enforcement-before-marketing-send is the unproven part).
  push({
    id: 'consent.captured', label: 'Consent capture', area: 'S', gate: 'G1', owner: 'system',
    agencyEditable: false, adminApproved: null,
    status: !s.consent ? 'unavailable' : 'live_but_unproven',
    signal: { source: 'consent_log (row presence; enforcement-before-marketing-send not verified here)', value: s.consent ? `rows=${s.consent.count}` : 'unavailable' },
    uiCopy: 'Consent is captured at intake; confirm it gates every marketing/re-engage send',
    blockedBy: [],
  });

  // Gap-C — DPA acceptance surfaced from a REAL agency_agreements row (never a transient checkbox, per S4).
  // Display-only (manual_fallback is SATISFIED → never a config blocker); the go-live enforcement is the
  // dpa_consent_live attestation, which evaluateGoLive auto-satisfies ONLY when this real row exists.
  const dpaSig = s.agreements;
  push({
    id: 'legal.dpa', label: 'DPA accepted', area: 'S', gate: 'G1', owner: 'aivena',
    agencyEditable: false, adminApproved: null,
    status: dpaSig === null ? 'unavailable' : dpaSig.dpaAccepted ? 'ready' : 'manual_fallback',
    signal: { source: 'agency_agreements (agreement_type=dpa)', value: dpaSig === null ? 'unavailable' : dpaSig.dpaAccepted ? `accepted v${dpaSig.dpaVersion} @ ${dpaSig.dpaAcceptedAt}` : 'no accepted DPA row' },
    uiCopy: dpaSig?.dpaAccepted ? 'DPA accepted (recorded) — the go-live DPA gate is satisfied by this real record' : 'No recorded DPA acceptance yet — the go-live DPA confirmation stays required (manual)',
    blockedBy: [],
  });

  // Lifecycle / admin go-live — reflects the REAL agencies.pilot_status (C2).
  // Read-only here; the admin WRITE path (flip to live) is C3. Never auto-flips.
  const ps = s.pilotStatus;
  const lifeStatus: ReadinessStatus =
    ps === 'live' ? 'ready'
    : ps === 'ready_for_pilot' ? 'live_but_unproven'
    : ps === null ? 'unavailable'
    : 'blocked'; // setup / paused / blocked → not live yet
  const lifeCopy =
    ps === 'live' ? 'Live in pilot'
    : ps === 'ready_for_pilot' ? 'Ready for pilot — awaiting AIVENA go-live'
    : ps === 'paused' ? 'Pilot paused by AIVENA'
    : ps === 'blocked' ? 'Held on a setup / external gate'
    : ps === 'setup' ? 'In setup — AIVENA flips live once required items pass'
    : 'Pilot lifecycle unavailable';
  push({
    id: 'lifecycle.go_live', label: 'Admin go-live approval', area: 'C', gate: 'G1', owner: 'aivena',
    agencyEditable: false, adminApproved: ps === 'live',
    status: lifeStatus,
    signal: { source: 'agencies.pilot_status (C2; admin-only flip via the C3 RPC, not yet built)', value: ps ?? 'unavailable' },
    uiCopy: lifeCopy,
    blockedBy: [],
  });

  // ---- B. Providers ----------------------------------------------------------
  const providers: ReadinessProvider[] = [];

  // Email — "proven" ONLY when a REAL successful send exists in provider_audit_log
  // (send_proven from dashboard_settings.profile: a Resend 2xx with a provider_message_id).
  // from_email present is merely "configured". We do NOT claim DNS/domain verification —
  // there is no real Resend domain signal yet (that is J3b); copy never says "domain verified".
  const emailConfigured = !!s.email && has(s.email.from_email);
  const sendProven = s.email?.send_proven === true;
  const sendProvenAt = s.email?.send_proven_at ?? null;
  const emailStatus: ReadinessStatus = !s.email
    ? 'unavailable'
    : emailConfigured && sendProven
      ? 'ready'
      : emailConfigured
        ? 'live_but_unproven'
        : 'missing';
  const emailDetail = !s.email
    ? 'unavailable'
    : !emailConfigured
      ? 'Not configured'
      : sendProven
        ? `Email sending proven — a real send succeeded at the provider${sendProvenAt ? ` (last: ${sendProvenAt})` : ''}`
        : 'Email configured — sending not proven';
  push({
    id: 'provider.email', label: 'Email sending', area: 'J', gate: 'G4', owner: 'agency',
    agencyEditable: false, adminApproved: null,
    status: emailStatus,
    signal: { source: 'agency_email_config.from_email + profile.send_proven (real successful Resend send in provider_audit_log)', value: s.email ? `from_email=${s.email.from_email ?? '∅'} · send_proven=${sendProven}${sendProvenAt ? ` · last=${sendProvenAt}` : ''}` : 'unavailable' },
    uiCopy: emailConfigured ? (sendProven ? 'Email sending proven — a real send succeeded' : 'Email configured — sending not proven') : 'Set up email sending',
    blockedBy: [],
  });
  providers.push({
    provider: 'email',
    status: emailStatus,
    detail: emailDetail,
    source: 'agency_email_config.from_email + profile.send_proven (real provider_audit_log send)',
  });

  // WhatsApp — CONSUMED from Chat 3's RPC. null = unavailable (RPC not deployed), never faked.
  const wa = s.whatsapp;
  const waStatus: ReadinessStatus = !wa
    ? 'unavailable'
    : wa.whatsapp_sender_ready && wa.whatsapp_channel_enabled && wa.template_send_path_proven
      ? 'ready'
      : wa.whatsapp_sender_ready
        ? 'live_but_unproven'
        : 'missing';
  push({
    id: 'provider.whatsapp', label: 'WhatsApp sending', area: 'H', gate: 'G2', owner: 'system',
    agencyEditable: false, adminApproved: null,
    status: waStatus,
    signal: { source: 'consumed from get_whatsapp_provider_readiness() via /whatsapp/readiness (Chat 3)', value: wa ? `sender_ready=${wa.whatsapp_sender_ready} · channel_enabled=${wa.whatsapp_channel_enabled} · send_proven=${wa.template_send_path_proven}` : 'unavailable (readiness RPC not deployed yet)' },
    uiCopy: !wa ? 'WhatsApp status not yet available (provider readiness service pending — Chat 3 H1)' : waStatus === 'ready' ? 'WhatsApp ready' : wa.whatsapp_sender_ready ? 'Sender connected — template send not yet proven; automation off' : 'WhatsApp not connected',
    blockedBy: [],
  });
  providers.push({
    provider: 'whatsapp',
    status: waStatus,
    detail: !wa ? 'Provider readiness RPC not deployed (consume-and-degrade); will light up when Chat 3 ships Phase 1c' : `sender_ready=${wa.whatsapp_sender_ready}, channel_enabled=${wa.whatsapp_channel_enabled}, send_proven=${wa.template_send_path_proven}, last_sync=${wa.last_provider_sync_at ?? 'unknown'}`,
    source: 'get_whatsapp_provider_readiness()',
  });

  // Multilingual WhatsApp templates.
  const nonEn = wa ? wa.languages_ready.filter((l) => l !== 'en').length : (s.templates?.nonEnApproved ?? null);
  const mlStatus: ReadinessStatus = nonEn === null ? 'unavailable' : nonEn > 0 ? 'ready' : 'missing';
  push({
    id: 'provider.templates_multilang', label: 'Multilingual WhatsApp templates', area: 'I', gate: 'G3', owner: 'aivena',
    agencyEditable: false, adminApproved: null,
    status: mlStatus,
    signal: { source: wa ? 'get_whatsapp_provider_readiness().languages_ready (non-en)' : 'whatsapp_templates (status=approved, language<>en) — seed, not provider-verified', value: nonEn === null ? 'unavailable' : `non_english_approved=${nonEn}` },
    uiCopy: mlStatus === 'ready' ? 'Multilingual templates approved' : 'English templates only — other languages in progress',
    blockedBy: [],
  });
  providers.push({
    provider: 'whatsapp_templates_multilang',
    status: mlStatus,
    detail: nonEn === null ? 'unavailable' : nonEn > 0 ? `${nonEn} non-English languages approved` : 'No non-English templates yet (English-only)',
    source: wa ? 'languages_ready' : 'whatsapp_templates (seed)',
  });

  // Calendar (viewings) — no connect flow exists yet; data-driven by oauth creds.
  const calStatus: ReadinessStatus = !s.calendar ? 'unavailable' : s.calendar.oauthCount > 0 ? 'live_but_unproven' : 'missing';
  push({
    id: 'provider.calendar', label: 'Calendar (viewings)', area: 'L', gate: 'G7', owner: 'agency',
    agencyEditable: false, adminApproved: null,
    status: calStatus,
    signal: { source: 'agency_oauth_credentials (count; Calendar OAuth connect flow + watcher not live yet)', value: s.calendar ? `oauth_credentials=${s.calendar.oauthCount}` : 'unavailable' },
    uiCopy: calStatus === 'missing' ? 'Calendar not connected — viewings handled manually' : 'Calendar credentials present — connect flow/watcher not yet live',
    blockedBy: [],
  });
  providers.push({
    provider: 'calendar',
    status: calStatus,
    detail: !s.calendar ? 'unavailable' : s.calendar.oauthCount > 0 ? 'OAuth credentials present; watcher not live' : 'Not connected (manual viewing fallback)',
    source: 'agency_oauth_credentials',
  });

  // Property feed / catalog.
  const catalog = assessCatalog(s.properties);
  const cp = s.properties;
  const catalogPresence: ReadinessStatus = cp === null ? 'unavailable' : cp.total_active > 0 ? 'manual_fallback' : 'missing';
  push({
    id: 'provider.property_feed', label: 'Property catalog / feed', area: 'O', gate: 'G8', owner: 'agency',
    agencyEditable: false, adminApproved: true,
    status: catalogPresence,
    signal: { source: 'properties (count; real source = agency feed/CSV, not the demo scrape)', value: cp === null ? 'unavailable' : `active=${cp.total_active} real_source=${cp.real_source_active}` },
    uiCopy: catalogPresence === 'manual_fallback' ? 'Catalog present — quality checked by the catalog gate' : 'No properties imported yet',
    blockedBy: [],
  });
  providers.push({
    provider: 'property_feed',
    status: catalogPresence,
    detail: cp === null ? 'unavailable' : cp.total_active > 0 ? `${cp.total_active} active (${cp.real_source_active} from a real source)` : 'No catalog',
    source: 'properties',
  });
  // O5 — catalog QUALITY gate (distinct from mere presence). Its hardFail feeds the non-overridable
  // go-live block (B1). Display-only here (gate G8, not G1) — enforcement is via goLive.catalogHardBlock.
  push({
    id: 'catalog.quality', label: 'Catalog quality', area: 'O', gate: 'G8', owner: 'agency',
    agencyEditable: false, adminApproved: true,
    status: catalog.status,
    signal: { source: 'properties (real-source count, owned images, area labelling, embeddings)', value: catalog.detail },
    uiCopy: catalog.status === 'ready' ? 'Catalog meets the real-pilot quality bar'
      : catalog.status === 'missing' ? `Catalog not real-pilot-ready: ${catalog.detail}`
      : catalog.status === 'unavailable' ? 'Catalog quality unavailable'
      : `Catalog usable — quality lifts pending: ${catalog.detail}`,
    blockedBy: [],
  });

  // ---- Gates rollup ----------------------------------------------------------
  const gateList: Gate[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11'];
  const gates: ReadinessGate[] = gateList.map((g) => {
    const blockedBy = items.filter((it) => it.gate === g && !SATISFIED.has(it.status)).map((it) => it.id);
    return { gate: g, status: blockedBy.length ? 'blocked' : 'open', blockedBy };
  });

  // ---- Go-live (Phase 1: eligibility signals only; the write is Phase 3) -----
  const g1 = gates.find((x) => x.gate === 'G1')!;
  const goLiveBlockers = Array.from(new Set([...g1.blockedBy]));
  // O5 — catalog is a HARD, non-overridable go-live blocker (B1), but ONLY when enforcing.
  // Default (flag unset) = WARN: catalogHardBlock stays false, so nothing is blocked yet; the
  // catalog.quality item still reports honestly. Flip enforcement on once O3 + built-vs-plot land.
  const catalogHardBlock = (opts.catalogEnforce ?? false) && catalog.hardFail;
  const goLive = {
    eligible: false, // never true until the C3 admin go-live gate exists; go-live is flipped admin-only, never auto on computed eligibility
    scope: 'agency-config readiness only (the admin go-live gate + manual-gate attestations land in C3)',
    blockedBy: goLiveBlockers,
    catalogHardBlock,
    catalogDetail: catalog.detail,
    /** Gap-C: a real accepted DPA row exists → evaluateGoLive auto-satisfies the dpa_consent_live attestation. */
    dpaAccepted: dpaSig?.dpaAccepted ?? false,
    note: `Pilot lifecycle = agencies.pilot_status='${s.pilotStatus ?? 'unavailable'}' (read-only here). Eligibility stays false until the C3 admin gate exists; manual gates (autónomo, legal pages, test-data cleanup) have no DB signal and show blocked/awaiting-AIVENA — never passed.${catalogHardBlock ? ` O5 catalog gate ENFORCING + blocking: ${catalog.detail}.` : catalog.hardFail ? ` O5 catalog gate WARN-only (not enforcing): ${catalog.detail}.` : ''}`,
  };

  return { agencyId, pilotStatus: s.pilotStatus, items, providers, gates, goLive };
}

// --- Go-live decision (C3) — PURE; the admin endpoint recomputes readiness then calls this ---

export type GoLiveAttestations = {
  autonomo_corrected?: boolean;
  legal_pages_published?: boolean;
  dpa_consent_live?: boolean;
  test_data_cleaned?: boolean;
};

/** The external/manual gates with no DB signal — all required (and NOT override-able) for `live`. */
export const REQUIRED_ATTESTATIONS = [
  'autonomo_corrected',
  'legal_pages_published',
  'dpa_consent_live',
  'test_data_cleaned',
] as const;

export type GoLiveDecision = {
  allowed: boolean;
  reason: string;
  /** readiness item ids blocking (excludes the self-referential `lifecycle.go_live`). */
  configBlockers: string[];
  missingAttestations: string[];
  overrideUsed: boolean;
};

/**
 * Decide whether a staff-initiated pilot_status transition is allowed, from a
 * SERVER-SIDE readiness recompute (never the browser's word).
 *  - setup / paused / blocked: always allowed (staff lifecycle control).
 *  - ready_for_pilot: requires all non-lifecycle G1 readiness items satisfied,
 *    unless `override` (a soft-block bypass that is RECORDED, never silent).
 *  - live: the above PLUS every manual attestation true. Attestations are a HARD
 *    gate — `override` can bypass a readiness gap but NEVER the legal/external
 *    attestations, so an unready agency can't be forced live without confirming
 *    the autónomo / legal-pages / DPA / test-data-clean gates.
 */
export function evaluateGoLive(
  target: PilotStatus,
  readiness: ReadinessResponse,
  attestations: GoLiveAttestations,
  override: boolean,
): GoLiveDecision {
  const configBlockers = readiness.goLive.blockedBy.filter((id) => id !== 'lifecycle.go_live');

  if (target === 'setup' || target === 'paused' || target === 'blocked') {
    return { allowed: true, reason: `Set to ${target}.`, configBlockers: [], missingAttestations: [], overrideUsed: false };
  }

  // O5 — catalog quality is a HARD blocker for ready_for_pilot/live (B1): a real catalog is required,
  // and this CANNOT be bypassed by override (like the attestations). Only fires when enforcing (else false).
  if (readiness.goLive.catalogHardBlock) {
    return {
      allowed: false,
      reason: `Catalog not real-pilot-ready (${readiness.goLive.catalogDetail}) — this cannot be overridden.`,
      configBlockers,
      missingAttestations: [],
      overrideUsed: false,
    };
  }

  if (configBlockers.length > 0 && !override) {
    return {
      allowed: false,
      reason: `Not ready — resolve these first: ${configBlockers.join(', ')}.`,
      configBlockers,
      missingAttestations: [],
      overrideUsed: false,
    };
  }

  if (target === 'live') {
    const missingAttestations = REQUIRED_ATTESTATIONS.filter((k) => {
      // Gap-C: dpa_consent_live is signal-backed — a real accepted DPA row (agency_agreements)
      // satisfies it without a manual tick. No row → the manual attestation stays required (no fake success).
      if (k === 'dpa_consent_live' && readiness.goLive.dpaAccepted) return false;
      return attestations[k] !== true;
    });
    if (missingAttestations.length > 0) {
      return {
        allowed: false,
        reason: `Go-live needs every manual confirmation first: ${missingAttestations.join(', ')}.`,
        configBlockers,
        missingAttestations,
        overrideUsed: false,
      };
    }
  }

  const overrideUsed = override && configBlockers.length > 0;
  return {
    allowed: true,
    reason: overrideUsed
      ? `Allowed via explicit override (unresolved readiness: ${configBlockers.join(', ')}).`
      : `Eligible for ${target}.`,
    configBlockers,
    missingAttestations: [],
    overrideUsed,
  };
}
