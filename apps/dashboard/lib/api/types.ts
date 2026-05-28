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

export type ThreadMessage = {
  id: string;
  direction: string;
  messageType: string;
  content: string | null;
  /** Server-cleaned inbound body (quote chain / footer stripped at ingestion). */
  bodyClean: string | null;
  createdAt: string;
};

export type TaskDetailResponse = {
  task: {
    id: string;
    taskType: string;
    status: string;
    subject: string | null;
    body: string;
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
 * Inbox left-list row from the `dashboard_inbox` RPC. Unlike `dashboard_needs_you`
 * this spans every bucket (needs_you + handled_*), carries the conversation id,
 * the latest cleaned inbound preview, and the last-outbound classification used
 * for the state badges.
 *
 * NOTE: `dashboard_inbox` does NOT currently return `leadType`, `area`, `source`,
 * or `score`. They're kept optional here so the Buyers/Sellers split, the
 * 3-pane lead summary, and the cards degrade gracefully (Sellers tab stays
 * empty; missing summary fields show "—") rather than break. If those surfaces
 * must show real values again, Vega needs to add the columns to dashboard_inbox.
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
  // Not provided by dashboard_inbox today — see note above.
  leadType?: string | null;
  area?: string | null;
  source?: string | null;
  score?: number | null;
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
