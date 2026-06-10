import type {
  Project, Run, TrendPoint, RunEvent, CompareResult, TestHistory, TestTrace,
  SessionUser, User, GlobalRole, MembershipWithUser, ProjectRole, AuditEntry, ProjectVisibility,
  ApiToken, CreatedToken, QualityGateConfig, RunSummary, Notification, NotificationKind, NotificationTrigger,
} from "@allure-station/shared";

export interface AppConfigInfo {
  securityEnabled: boolean;
  oidc: { enabled: boolean; label?: string };
  allure: string;
}

export interface ApiClient {
  getConfig(): Promise<AppConfigInfo>;
  listProjects(opts?: { q?: string; limit?: number; offset?: number }): Promise<{ items: Project[]; total: number }>;
  createProject(id: string, displayName?: string): Promise<Project>;
  updateProject(id: string, body: { displayName: string | null }): Promise<Project>;
  getProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  setVisibility(id: string, visibility: ProjectVisibility): Promise<Project>;
  listRuns(projectId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<Run[]>;
  getRunSummary(projectId: string, runId: string): Promise<RunSummary>;
  retryRun(projectId: string, runId: string): Promise<Run>;
  sendResults(projectId: string, files: File[]): Promise<{ runId: string }>;
  generate(projectId: string): Promise<Run>;
  listTrends(projectId: string): Promise<TrendPoint[]>;
  compareRuns(projectId: string, base: string, target: string): Promise<CompareResult>;
  getTestHistory(projectId: string, params: { historyId?: string; fullName?: string; name?: string; limit?: number }): Promise<TestHistory>;
  getTestTrace(projectId: string, params: { runId: string; historyId?: string; fullName?: string }): Promise<TestTrace>;
  /** Subscribe to live run events for a project over SSE. Returns an unsubscribe function. */
  subscribeRuns(projectId: string, onEvent: (event: RunEvent) => void): () => void;
  // --- Auth & RBAC (5b) ---
  me(): Promise<SessionUser | null>;
  login(email: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  listMembers(projectId: string): Promise<MembershipWithUser[]>;
  setMember(projectId: string, email: string, role: ProjectRole): Promise<MembershipWithUser>;
  removeMember(projectId: string, userId: string): Promise<void>;
  listUsers(): Promise<User[]>;
  createUser(email: string, password: string, role: GlobalRole): Promise<User>;
  deleteUser(id: string): Promise<void>;
  listAudit(opts?: { limit?: number; offset?: number }): Promise<{ items: AuditEntry[]; total: number }>;
  listProjectAudit(projectId: string, opts?: { limit?: number; offset?: number }): Promise<{ items: AuditEntry[]; total: number }>;
  getQualityGate(projectId: string): Promise<QualityGateConfig>;
  setQualityGate(projectId: string, cfg: QualityGateConfig): Promise<QualityGateConfig>;
  listTokens(projectId: string): Promise<ApiToken[]>;
  createToken(projectId: string, name: string): Promise<CreatedToken>;
  deleteToken(projectId: string, tokenId: string): Promise<void>;
  listNotifications(projectId: string): Promise<Notification[]>;
  createNotification(projectId: string, body: { kind: NotificationKind; url: string; events: NotificationTrigger[] }): Promise<Notification>;
  testNotification(projectId: string, notificationId: string): Promise<{ ok: boolean; status?: number; error?: string }>;
  deleteNotification(projectId: string, notificationId: string): Promise<void>;
}

export function createClient(base: string, f: typeof fetch = fetch): ApiClient {
  // credentials:"include" so the session cookie is sent even when the UI is served from a
  // different origin than the API in dev (same-origin prod sends it regardless).
  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, { credentials: "include", ...init });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
  // For 204/no-body endpoints (logout, delete): assert ok without parsing a body.
  async function noContent(path: string, init: RequestInit): Promise<void> {
    const res = await f(`${base}${path}`, { credentials: "include", ...init });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  }
  // GET a list endpoint, surfacing the X-Total-Count header for pagination UIs.
  async function listWithTotal<T>(path: string): Promise<{ items: T[]; total: number }> {
    const res = await f(`${base}${path}`, { method: "GET", credentials: "include" });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const items = (await res.json()) as T[];
    const header = res.headers.get("X-Total-Count");
    return { items, total: header === null ? items.length : Number(header) };
  }
  const qs = (o: Record<string, unknown>): string => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  return {
    getConfig: () => json<AppConfigInfo>("/config", { method: "GET" }),
    listProjects: (opts = {}) => listWithTotal<Project>(`/projects${qs(opts)}`),
    createProject: (id, displayName) =>
      json<Project>("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(displayName ? { id, displayName } : { id }) }),
    updateProject: (id, body) =>
      json<Project>(`/projects/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    getProject: (id) => json<Project>(`/projects/${id}`, { method: "GET" }),
    deleteProject: (id) => noContent(`/projects/${id}`, { method: "DELETE" }),
    setVisibility: (id, visibility) =>
      json<Project>(`/projects/${id}/visibility`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility }) }),
    listRuns: (projectId, opts = {}) => json<Run[]>(`/projects/${projectId}/runs${qs(opts)}`, { method: "GET" }),
    getRunSummary: (projectId, runId) => json<RunSummary>(`/projects/${projectId}/runs/${runId}/summary`, { method: "GET" }),
    retryRun: (projectId, runId) => json<Run>(`/projects/${projectId}/runs/${runId}/retry`, { method: "POST" }),
    sendResults: (projectId, files) => {
      const fd = new FormData();
      for (const file of files) fd.append("files", file, file.name);
      return json<{ runId: string }>(`/projects/${projectId}/send-results`, { method: "POST", body: fd });
    },
    generate: (projectId) => json<Run>(`/projects/${projectId}/generate`, { method: "POST" }),
    listTrends: (projectId) => json<TrendPoint[]>(`/projects/${projectId}/trends`, { method: "GET" }),
    compareRuns: (projectId, base, target) =>
      json<CompareResult>(`/projects/${projectId}/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`, { method: "GET" }),
    getTestHistory: (projectId, params) =>
      json<TestHistory>(`/projects/${projectId}/tests/history${qs(params)}`, { method: "GET" }),
    getTestTrace: (projectId, params) =>
      json<TestTrace>(`/projects/${projectId}/tests/history/trace${qs(params)}`, { method: "GET" }),
    me: () => json<SessionUser | null>("/auth/me", { method: "GET" }),
    login: (email, password) =>
      json<SessionUser>("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }),
    logout: () => noContent("/auth/logout", { method: "POST" }),
    listMembers: (projectId) => json<MembershipWithUser[]>(`/projects/${projectId}/members`, { method: "GET" }),
    setMember: (projectId, email, role) =>
      json<MembershipWithUser>(`/projects/${projectId}/members`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) }),
    removeMember: (projectId, userId) => noContent(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
    listUsers: () => json<User[]>("/users", { method: "GET" }),
    createUser: (email, password, role) =>
      json<User>("/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, role }) }),
    deleteUser: (id) => noContent(`/users/${id}`, { method: "DELETE" }),
    listAudit: (opts = {}) => listWithTotal<AuditEntry>(`/audit${qs(opts)}`),
    listProjectAudit: (projectId, opts = {}) => listWithTotal<AuditEntry>(`/projects/${projectId}/audit${qs(opts)}`),
    getQualityGate: (projectId) => json<QualityGateConfig>(`/projects/${projectId}/quality-gate`, { method: "GET" }),
    setQualityGate: (projectId, cfg) =>
      json<QualityGateConfig>(`/projects/${projectId}/quality-gate`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) }),
    listTokens: (projectId) => json<ApiToken[]>(`/projects/${projectId}/tokens`, { method: "GET" }),
    createToken: (projectId, name) =>
      json<CreatedToken>(`/projects/${projectId}/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
    deleteToken: (projectId, tokenId) => noContent(`/projects/${projectId}/tokens/${tokenId}`, { method: "DELETE" }),
    listNotifications: (projectId) => json<Notification[]>(`/projects/${projectId}/notifications`, { method: "GET" }),
    createNotification: (projectId, body) =>
      json<Notification>(`/projects/${projectId}/notifications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    testNotification: (projectId, notificationId) =>
      json<{ ok: boolean; status?: number; error?: string }>(`/projects/${projectId}/notifications/${notificationId}/test`, { method: "POST" }),
    deleteNotification: (projectId, notificationId) => noContent(`/projects/${projectId}/notifications/${notificationId}`, { method: "DELETE" }),
    subscribeRuns: (projectId, onEvent) => {
      // No-op where EventSource is unavailable (e.g. jsdom/SSR); the page still works via fetch.
      if (typeof EventSource === "undefined") return () => {};
      const es = new EventSource(`${base}/projects/${projectId}/events`, { withCredentials: true });
      es.onmessage = (m) => {
        try {
          onEvent(JSON.parse(m.data) as RunEvent);
        } catch {
          /* ignore malformed frames (e.g. heartbeats are comments, not messages) */
        }
      };
      return () => es.close();
    },
  };
}
