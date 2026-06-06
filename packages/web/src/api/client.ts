import type { Project, Run, TrendPoint, RunEvent, CompareResult } from "@allure-station/shared";

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
}

export function createClient(base: string, f: typeof fetch = fetch): ApiClient {
  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, init);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
  // GET a list endpoint, surfacing the X-Total-Count header for pagination UIs.
  async function listWithTotal<T>(path: string): Promise<{ items: T[]; total: number }> {
    const res = await f(`${base}${path}`, { method: "GET" });
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
    subscribeRuns: (projectId, onEvent) => {
      // No-op where EventSource is unavailable (e.g. jsdom/SSR); the page still works via fetch.
      if (typeof EventSource === "undefined") return () => {};
      const es = new EventSource(`${base}/projects/${projectId}/events`);
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
