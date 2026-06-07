import type {
  Project, Run, TrendPoint, RunEvent, CompareResult,
  SessionUser, User, GlobalRole, MembershipWithUser, ProjectRole, AuditEntry,
} from "@allure-station/shared";

export interface ApiClient {
  listProjects(opts?: { q?: string; limit?: number; offset?: number }): Promise<{ items: Project[]; total: number }>;
  createProject(id: string): Promise<Project>;
  listRuns(projectId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<Run[]>;
  sendResults(projectId: string, files: File[]): Promise<{ runId: string }>;
  generate(projectId: string): Promise<Run>;
  listTrends(projectId: string): Promise<TrendPoint[]>;
  compareRuns(projectId: string, base: string, target: string): Promise<CompareResult>;
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
    listProjects: (opts = {}) => listWithTotal<Project>(`/projects${qs(opts)}`),
    createProject: (id) =>
      json<Project>("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }),
    listRuns: (projectId, opts = {}) => json<Run[]>(`/projects/${projectId}/runs${qs(opts)}`, { method: "GET" }),
    sendResults: (projectId, files) => {
      const fd = new FormData();
      for (const file of files) fd.append("files", file, file.name);
      return json<{ runId: string }>(`/projects/${projectId}/send-results`, { method: "POST", body: fd });
    },
    generate: (projectId) => json<Run>(`/projects/${projectId}/generate`, { method: "POST" }),
    listTrends: (projectId) => json<TrendPoint[]>(`/projects/${projectId}/trends`, { method: "GET" }),
    compareRuns: (projectId, base, target) =>
      json<CompareResult>(`/projects/${projectId}/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`, { method: "GET" }),
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
