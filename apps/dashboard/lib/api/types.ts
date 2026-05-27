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
