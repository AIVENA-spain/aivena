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
