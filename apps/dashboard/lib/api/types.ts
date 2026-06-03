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

export type SettingsResponse = {
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
  /** Whether Vega's embedding step has filled the vector yet. */
  has_embedding: boolean;
  updated_at: string;
};

export type PropertiesResponse = { properties: PropertyRow[] };

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
  createdAt: string;
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
  occurredAt: string;
};

export type ActivityResponse = { rows: ActivityRow[] };

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
