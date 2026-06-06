import type { Project, Run, TrendPoint, RunEvent } from "@allure-station/shared";

export interface ApiClient {
  listProjects(): Promise<Project[]>;
  createProject(id: string): Promise<Project>;
  listRuns(projectId: string): Promise<Run[]>;
  sendResults(projectId: string, files: File[]): Promise<{ runId: string }>;
  generate(projectId: string): Promise<Run>;
  listTrends(projectId: string): Promise<TrendPoint[]>;
  /** Subscribe to live run events for a project over SSE. Returns an unsubscribe function. */
  subscribeRuns(projectId: string, onEvent: (event: RunEvent) => void): () => void;
}

export function createClient(base: string, f: typeof fetch = fetch): ApiClient {
  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, init);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
  return {
    listProjects: () => json<Project[]>("/projects", { method: "GET" }),
    createProject: (id) =>
      json<Project>("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }),
    listRuns: (projectId) => json<Run[]>(`/projects/${projectId}/runs`, { method: "GET" }),
    sendResults: (projectId, files) => {
      const fd = new FormData();
      for (const file of files) fd.append("files", file, file.name);
      return json<{ runId: string }>(`/projects/${projectId}/send-results`, { method: "POST", body: fd });
    },
    generate: (projectId) => json<Run>(`/projects/${projectId}/generate`, { method: "POST" }),
    listTrends: (projectId) => json<TrendPoint[]>(`/projects/${projectId}/trends`, { method: "GET" }),
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
