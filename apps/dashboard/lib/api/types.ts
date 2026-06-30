export type ApiMembership = {
  agencyId: string;
  role: string;
  isDefault: boolean;
  displayName: string;
};

export type ApiActiveAgency = {
  agencyId: string;
  role: string;
  displayName: string;
  status: string;
  region: string | null;
  languages: string[];
};

export type MeResponse = {
  userId: string;
  email: string;
  isAivenaStaff: boolean;
  activeAgency: ApiActiveAgency | null;
  agencies: ApiMembership[];
};

export type ApiTask = {
  id: string;
  taskType: string;
  status: string;
  subject: string | null;
  body: string;
  createdAt: string;
  conversationId: string | null;
  lead: {
    id: string;
    fullName: string | null;
    email: string | null;
    language: string | null;
    source: string | null;
    sourceType: string | null;
    score: number | null;
    temperature: string | null;
    intent: string | null;
    listingId: string | null;
    summary: string | null;
  };
};

export type TasksResponse = {
  tasks: ApiTask[];
};

// ─── Settings (dashboard_settings(0)) ─────────────────────────────────────

export type DaySlot = { enabled: boolean; start: string; end: string };

export type WorkingHours = {
  monday: DaySlot;
  tuesday: DaySlot;
  wednesday: DaySlot;
  thursday: DaySlot;
  friday: DaySlot;
  saturday: DaySlot;
  sunday: DaySlot;
  timezone: string;
};

export type DashboardToggles = {
  draft_replies_auto: boolean;
  auto_send_cold: boolean;
  require_approval_hot: boolean;
  auto_whatsapp_recovery: boolean;
};

export type ChecklistItem = { completed: boolean; completed_at: string | null };

export type TeamMember = {
  user_id: string;
  email: string;
  role: string;
  is_default: boolean;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  send_attempts: number;
  last_sent_at: string | null;
  invited_by: string;
};

export type Lane = "auto_send" | "review_first";

export type ReplyLanes = {
  default_lane: Lane | string;
  by_temperature: Partial<Record<"cold" | "warm" | "hot" | "super_hot", string>>;
  by_channel: Record<string, string>;
  by_action: Record<string, string>;
};

export type SettingsResponse = {
  reply_lanes?: ReplyLanes;
  profile: {
    agency_id: string;
    name: string;
    legal_name: string | null;
    region: string | null;
    status: string;
    supported_languages: string[];
    sending_domain: string;
    from_email: string;
    from_name: string;
    reply_to: string;
    domain_verified: boolean;
  };
  config: {
    approve_before_sending: boolean;
    auto_first_response: boolean;
    reply_handling_mode: string;
    fallback_mode: string;
    timezone: string;
    working_hours: WorkingHours;
    followup_style: string;
    daily_send_cap: number | null;
    monthly_send_cap: number | null;
    data_retention_days: number;
    agency_paused: boolean;
    dashboard_toggles: DashboardToggles;
  };
  channels: {
    email: { enabled: boolean; live: boolean };
    whatsapp: {
      enabled: boolean;
      connected: boolean;
      live: boolean;
      no_source: boolean;
    };
  };
  branding: {
    brand_name: string;
    logo_url: string | null;
    primary_color: string;
    accent_color: string | null;
    phone: string | null;
    whatsapp_number: string | null;
    website_url: string | null;
    booking_url: string | null;
    office_address: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    instagram_url: string | null;
    facebook_url: string | null;
    linkedin_url: string | null;
    email_signature_name: string;
    email_signature_role: string;
    email_footer_text: string | null;
    tone: string;
    brand_voice: string;
    content_style: string | null;
    reviewed_at: string | null;
  };
  team: {
    members: TeamMember[];
    member_count: number;
    invitations: InvitationRow[];
    pending_invitation_count: number;
  };
  setup_checklist: {
    domain_verified: ChecklistItem;
    branding_added: ChecklistItem;
    ai_rules_set: ChecklistItem;
    team_invited: ChecklistItem;
    whatsapp_connected: ChecklistItem;
  };
  network: { value: unknown; no_source: boolean; label: string };
  // ── v1.15 commerce + v1.14 agency-language fields (merged in by the API
  //    directly off agency_settings; not part of dashboard_settings(0)) ──
  plan_tier: PlanTier;
  quotas: QuotaBlock;
  translation_target_language: string;
  /** Per-agency DEFAULT dashboard language a new team member inherits. */
  dashboard_display_language: string;
};

export type PlanTier = "starter" | "pro" | "unlimited";

/** `quota === null` ⇒ unlimited (the tier convention). */
export type QuotaUsage = { quota: number | null; used: number };

export type QuotaBlock = {
  voiceMinutes: QuotaUsage;
  adCreative: QuotaUsage;
  socialPost: QuotaUsage;
  renovation: QuotaUsage;
};

// ── Properties (catalog) ──────────────────────────────────────────────────

export type PropertyRow = {
  id: string;
  external_id: string;
  title: string;
  property_type: string | null;
  status: string;
  price: number | null;
  price_currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  location_city: string | null;
  location_region: string | null;
  /** jsonb array of image URLs; images[0] is the thumbnail. May be empty. */
  images: string[];
  /** Whether Vega's embedding step has filled the vector yet. */
  has_embedding: boolean;
  updated_at: string;
};

export type PropertiesResponse = { properties: PropertyRow[] };

// ── Bookings / viewings (W11-lite) ────────────────────────────────────────

export type BookingRow = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  property_id: string | null;
  property_title: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  location: string | null;
  agent_name: string | null;
  status: string;
  notes: string | null;
  booking_type: string;
  /** Computed server-side (DB clock): future & not cancelled/no-show/completed. */
  is_upcoming: boolean;
};

export type BookingsResponse = { bookings: BookingRow[] };

// ── Content library (Studio Library tab) ──────────────────────────────────

export type ContentItemRow = {
  id: string;
  content_type: string;
  platform: string | null;
  title: string;
  body: string;
  hashtags: string[] | null;
  /** jsonb array of media URLs; media_urls[0] is the thumbnail. */
  media_urls: string[];
  media_type: string | null;
  status: string;
  property_id: string | null;
  lead_id: string | null;
  tone: string | null;
  length: string | null;
  created_at: string;
};

export type ContentItemsResponse = { items: ContentItemRow[] };

// ── Image generation (W13) ────────────────────────────────────────────────

export type ImageGenType = "ad_creative" | "social_post" | "renovation";
export type ImageGenStatus = "pending" | "processing" | "completed" | "failed";

export type ImageGeneration = {
  id: string;
  generationType: string;
  status: string;
  prompt: string;
  sourceImageUrl: string | null;
  resultImageUrl: string | null;
  failureReason: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type ImageGenerationsResponse = {
  ok: true;
  generations: ImageGeneration[];
};

export type ImageGenerationResponse = {
  ok: true;
  generation: ImageGeneration;
};

export type CreateImageResponse = {
  ok: true;
  generationId: string;
  kieTaskId: string | null;
  status: string;
};

/** image_gen_check_quota jsonb. quota === null ⇒ unlimited. */
export type ImageQuota = {
  used: number;
  quota: number | null;
  remaining: number | null;
  unlimited: boolean;
};

// ── Lead notes ────────────────────────────────────────────────────────────

export type LeadNoteRow = {
  id: string;
  body: string;
  author_user_id: string | null;
  context_for_ai: boolean;
  created_at: string;
  updated_at: string;
};

export type LeadNotesResponse = { notes: LeadNoteRow[] };

// ── Matches (W20 reverse-prospecting, read-only) ───────────────────────────

export interface Match {
  rank: number;
  similarity: number;
  property_id: string;
  external_id: string | null;
  title: string;
  property_type: string;
  price: number | null;
  price_currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  location_city: string | null;
  location_region: string | null;
  source_url: string | null;
  images: string[] | null;
}

export interface LeadWithMatch {
  lead_id: string;
  full_name: string;
  language: string | null;
  score: number | null;
  temperature: 'super_hot' | 'hot' | 'warm' | 'cold' | string;
  property_type_pref: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  budget_extracted: string | null;
  location_interest_extracted: string | null;
  summary: string | null;
  match_count: number;
  top_property_id: string;
  top_title: string;
  top_property_type: string;
  top_price: number | null;
  top_price_currency: string | null;
  top_bedrooms: number | null;
  top_bathrooms: number | null;
  top_location_city: string | null;
  top_images: string[] | null;
  top_similarity: number;
}

export type ThreadMessage = {
  id: string;
  direction: string;
  messageType: string;
  content: string | null;
  /** Server-cleaned inbound body (quote chain / footer stripped at ingestion). */
  bodyClean: string | null;
  /**
   * v1.14.4 — owner-language translation of this message. NULL when the
   * pipeline hasn't filled it yet, or when source language == target (in both
   * cases the UI shows only the original — no empty translation pane).
   */
  bodyTranslatedOwner: string | null;
  /**
   * Delivery status: received | queued | sent | read | undelivered | failed |
   * cancelled. The last three mean the outbound never reached the buyer and
   * must render as "not delivered", never as sent. May be null on old rows.
   */
  status: string | null;
  createdAt: string;
};

/** A past outbound that did NOT deliver (undelivered/failed/cancelled). */
export type WhatsappFailedMessage = {
  message_id: string;
  status: string;
  /** Raw provider code (e.g. "twilio_error_63016"); map to friendly copy, never show raw. */
  failure_reason_code: string | null;
};

/**
 * WhatsApp 24-hour-window state for a lead (Vega's dashboard_lead_whatsapp_state
 * RPC). `window_open` is the single source of truth for composer gating — never
 * recompute client-side. `channel` self-reports so the window UI applies only to
 * WhatsApp leads. All timestamp fields are null when the buyer never messaged.
 */
export type WhatsappState = {
  lead_id: string;
  channel: string | null;
  window_open: boolean;
  last_inbound_whatsapp_at: string | null;
  window_expires_at: string | null;
  hours_since_last_inbound: number | null;
  failed_messages: WhatsappFailedMessage[];
};

export type TaskDetailResponse = {
  task: {
    id: string;
    taskType: string;
    status: string;
    subject: string | null;
    body: string;
    /** v1.14.4 — owner-language translation of the AI draft; NULL until filled. */
    suggestedReplyTranslatedOwner: string | null;
    conversationId: string | null;
    createdAt: string;
  };
  lead: ApiTask["lead"];
  originalMessage: string | null;
  thread: ThreadMessage[];
  /** Null for non-WhatsApp leads or if the state lookup failed (degrade gracefully). */
  whatsappState: WhatsappState | null;
};

export type ApproveResponse = {
  ok: true;
  sendQueueId: string;
  conversationMessageId: string;
  finalSubject: string | null;
  finalBody: string | null;
  wasEdited: boolean;
};

// ---- Overview ---------------------------------------------------------------

export type KpiPoint = {
  value: number;
  prev: number;
  delta: number;
};
export type KpiPointInTime = { value: number; point_in_time: true };
export type KpiPreview = {
  value: number;
  prev?: number;
  delta?: number;
  pilot2_preview: true;
};

export type OverviewKpisResponse = {
  period_days: number;
  as_of: string;
  new_buyers: KpiPoint;
  followups_sent: KpiPoint;
  new_sellers: KpiPreview;
  needs_you: KpiPointInTime;
  hot_leads: KpiPointInTime;
};

export type NeedsYouRow = {
  taskId: string;
  leadId: string;
  fullName: string | null;
  leadType: string | null;
  area: string | null;
  source: string | null;
  channel: string | null;
  language: string | null;
  leadStatus: string | null;
  temperature: string | null;
  score: number | null;
  aiReplySubject: string | null;
  aiReplyBody: string | null;
  priority: string;
  taskCreatedAt: string;
};

export type NeedsYouResponse = { rows: NeedsYouRow[] };

/**
 * Inbox left-list row from the `dashboard_inbox` RPC — a 25-field superset of
 * `dashboard_needs_you`. Spans every bucket (needs_you + handled_*), carries
 * the conversation id, the latest cleaned inbound preview, the last-outbound
 * classification used for the state badges, plus the leadType/area/source/score
 * fields that drive the Buyers/Sellers split and the 3-pane lead summary.
 */
export type InboxRow = {
  taskId: string;
  leadId: string;
  conversationId: string | null;
  fullName: string | null;
  channel: string | null;
  language: string | null;
  temperature: string | null;
  leadStatus: string | null;
  taskStatus: string | null;
  bucket: string | null;
  aiReplySubject: string | null;
  aiReplyBody: string | null;
  priority: string;
  taskCreatedAt: string;
  handledAt: string | null;
  handledBy: string | null;
  ageSeconds: number | null;
  latestInboundPreview: string | null;
  latestInboundAt: string | null;
  lastOutboundKind: string | null;
  lastOutboundAt: string | null;
  leadType: string | null;
  area: string | null;
  source: string | null;
  score: number | null;
};

export type InboxResponse = { rows: InboxRow[] };

export type ActivityRow = {
  eventId: string;
  leadId: string | null;
  fullName: string | null;
  eventType: string;
  label: string;
  channel: string | null;
  /** Message excerpt (original) and its owner-language translation. */
  excerpt: string | null;
  excerptTranslated: string | null;
  occurredAt: string;
};

export type ActivityResponse = { rows: ActivityRow[] };

export type LeadPickerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
};

// ---- Performance --------------------------------------------------------------

export type PerfRange = {
  from: string;
  to: string;
  days: number;
  prior_from: string;
  prior_to: string;
};

export type PerfLeadsAnswered = {
  count: number;
  total: number;
  pct: number;
  /** Percentage-point change vs prior week. Null when no prior baseline. */
  delta_pp: number | null;
  prior: { count: number; total: number; pct: number };
};

export type PerfAvgReply = {
  median_seconds: number | null;
  sample_n: number;
  low_sample: boolean;
  delta_seconds: number | null;
  prior_median_seconds: number | null;
  prior_sample_n: number;
};

export type PerfLanguages = {
  distinct: number;
  unknown_count: number;
  list: string[];
};

export type PerfDailyAnswered = { date: string; answered_count: number };

export type PerfWeeklyReplyTime = {
  week_start: string;
  median_seconds: number | null;
  n: number;
};

export type PerfLanguageBreakdown = { language: string; count: number };

/** Honest-empty gated metric (Voice not live in Pilot 1). */
export type PerfGatedMetric = {
  value: number | null;
  no_source: boolean;
  reason: string;
};

export type PerformanceResponse = {
  range: PerfRange;
  /** ISO timestamp the snapshot was computed. */
  as_of: string;
  /** IANA tz the day/week buckets are computed in (e.g. "Europe/Madrid"). */
  timezone: string;
  kpis: {
    leads_answered: PerfLeadsAnswered;
    avg_reply: PerfAvgReply;
    languages: PerfLanguages;
  };
  daily_answered: PerfDailyAnswered[];
  weekly_reply_time: PerfWeeklyReplyTime[];
  language_breakdown: PerfLanguageBreakdown[];
  recovered_leads: PerfGatedMetric;
  missed_call_recovery: PerfGatedMetric;
};

// ── Day-2 Client Intelligence ──────────────────────────────────────────────

/**
 * Match explanation (dashboard_match_explanation) — honest "why matched" for a
 * lead's property matches. Verdicts mean exactly what they say: `not_confirmed`
 * is "the listing data doesn't say", NOT "no"; `unknown` is "preference/data
 * missing". Never render either as a hard negative.
 */
export type MatchDimensionKey =
  | "budget"
  | "location"
  | "bedrooms"
  | "bathrooms"
  | "property_type";

export type MatchDimensionVerdict =
  | "match"
  | "slightly_over"
  | "over_budget"
  | "different_area"
  | "mismatch"
  | "unknown";

export type MatchDimension = {
  key: MatchDimensionKey;
  lead_value: string | number | null;
  property_value: string | number | null;
  verdict: MatchDimensionVerdict;
};

export type MatchFeatureVerdict = "confirmed" | "not_confirmed";

export type MatchFeature = {
  name: string;
  requested: boolean;
  verdict: MatchFeatureVerdict;
};

export type MatchExplanationItem = {
  property_id: string;
  reference: string | null;
  title: string | null;
  similarity: number;
  rank: number | null;
  match_status: string | null;
  dimensions: MatchDimension[];
  features: MatchFeature[];
};

export type MatchExplanationResponse = {
  ok: true;
  lead_id: string;
  matches: MatchExplanationItem[];
};

/**
 * Lead intel (GET /api/v1/leads/:leadId/intel) — read-only buyer-profile,
 * next-best-action, and follow-up fields off `leads`. Every field is nullable;
 * a null is an honest "not captured yet", rendered as "—" — never fabricated.
 * Day-3 fields (motivation/objections/best_property_angle) are deliberately NOT
 * here and stay "Unknown" placeholders in the UI.
 */
export type LeadIntel = {
  urgency: string | null;
  timeframe: string | null;
  budget_extracted: number | null;
  budget_raw: string | null;
  location_interest_extracted: string | null;
  location_interest_raw: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  property_type_pref: string | null;
  next_action: string | null;
  recommended_channel: string | null;
  reasoning_summary: string | null;
  followup_paused: boolean | null;
  next_followup_at: string | null;
};

export type LeadIntelResponse = { ok: true; data: LeadIntel };

// --- Readiness (Phase 1) — mirrors apps/api/src/lib/readiness/compute.ts -----
// GET /api/v1/readiness. Per-item/provider/gate go-live readiness, computed from
// live signals only. Item `label`/`uiCopy` + provider `detail` are server-provided
// copy (English source of truth); the dashboard renders them as data.
export type ReadinessStatus =
  | "ready"
  | "live_but_unproven"
  | "manual_fallback"
  | "missing"
  | "blocked"
  | "needs_decision"
  | "unavailable";

export type ReadinessOwner = "agency" | "aivena" | "system";

export type ReadinessGateId =
  | "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11";

export type ReadinessItem = {
  id: string;
  label: string;
  area: string;
  gate: ReadinessGateId;
  owner: ReadinessOwner;
  status: ReadinessStatus;
  agencyEditable: boolean;
  adminApproved: boolean | null;
  signal: { source: string; value: string };
  uiCopy: string;
  blockedBy: string[];
};

export type ReadinessProviderId =
  | "email" | "whatsapp" | "whatsapp_templates_multilang" | "calendar" | "property_feed";

export type ReadinessProviderState = {
  provider: ReadinessProviderId;
  status: ReadinessStatus;
  detail: string;
  source: string;
};

export type ReadinessGateState = {
  gate: ReadinessGateId;
  status: "open" | "blocked";
  blockedBy: string[];
};

export type PilotStatus = "setup" | "ready_for_pilot" | "live" | "paused" | "blocked";

export type ReadinessResponse = {
  computedAt: string;
  agencyId: string;
  /** Real agencies.pilot_status (C2) — global pilot lifecycle; null if unreadable. */
  pilotStatus: PilotStatus | null;
  items: ReadinessItem[];
  providers: ReadinessProviderState[];
  gates: ReadinessGateState[];
  goLive: { eligible: boolean; scope: string; blockedBy: string[]; note: string };
};

// --- Command center / operations (F1 + F2 + F4) — read-only ops surface ------

export type OpsProviderState =
  | "ready"
  | "degraded"
  | "disconnected"
  | "unavailable" // signal could not be read — NOT asserted as disconnected
  | "unknown"; // no verification mechanism yet — never faked as ready

export type OpsHealthBucket =
  | "at_risk"
  | "stuck"
  | "waiting_on_you"
  | "awaiting_reply"
  | "healthy";

export type OpsFailedSend = {
  messageId: string;
  leadId: string | null;
  leadName: string | null;
  channel: string | null;
  status: string;
  at: string | null;
  ageHours: number | null;
  preview: string | null;
  /** True = this lead is openable in the Inbox (has a dashboard_inbox row). */
  inInbox: boolean;
};

export type OpsTask = {
  taskId: string;
  leadId: string | null;
  leadName: string | null;
  type: string;
  label: string;
  status: string;
  priority: string | null;
  temperature: string | null;
  title: string | null;
  createdAt: string | null;
  ageHours: number | null;
  /** True = this lead is openable in the Inbox (has a dashboard_inbox row). */
  inInbox: boolean;
};

export type OpsAtRiskLead = {
  leadId: string;
  leadName: string | null;
  bucket: OpsHealthBucket;
  reason: string;
  temperature: string | null;
  ageHours: number | null;
  lastActivityAt: string | null;
  /** True = this lead is openable in the Inbox (has a dashboard_inbox row). */
  inInbox: boolean;
};

export type OperationsResponse = {
  computedAt: string;
  agencyId: string;
  attention: {
    failedSends: number;
    openTasks: number;
    atRiskLeads: number;
    providerIssues: number;
    openActionItems: number;
  };
  failedSends: {
    count: number;
    items: OpsFailedSend[];
    note: string;
    available: boolean;
  };
  actionQueue: {
    total: number;
    byType: Array<{ type: string; label: string; count: number }>;
    items: OpsTask[];
    available: boolean;
  };
  providers: Array<{
    provider: "whatsapp" | "email";
    state: OpsProviderState;
    detail: string;
    source: string;
  }>;
  lifecycle: {
    buckets: Array<{ key: OpsHealthBucket; label: string; count: number }>;
    atRisk: OpsAtRiskLead[];
    available: boolean;
  };
  signalHealth: Array<{ signal: string; ok: boolean; source: string }>;
};
