import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";

describe("api client", () => {
  const headers = (h: Record<string, string> = {}) => ({ get: (k: string) => h[k] ?? null });

  it("lists projects via GET /projects and surfaces X-Total-Count", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: headers({ "X-Total-Count": "42" }),
      json: async () => [{ id: "p", createdAt: "x", latestRunId: null }],
    });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.listProjects();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "GET" }));
    expect(res.items[0].id).toBe("p");
    expect(res.total).toBe(42);
  });

  it("listProjects passes q/limit/offset as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: headers(), json: async () => [] });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.listProjects({ q: "ab", limit: 20, offset: 40 });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects?q=ab&limit=20&offset=40", expect.objectContaining({ method: "GET" }));
    expect(res.total).toBe(0); // falls back to items.length when header absent
  });

  it("listRuns passes ?status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.listRuns("p", { status: "ready" });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/runs?status=ready", expect.objectContaining({ method: "GET" }));
  });

  it("throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, headers: headers(), text: async () => "boom" });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await expect(client.listProjects()).rejects.toThrow("500");
  });

  it("testNotification POSTs to the notification test endpoint and returns the delivery result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, status: 500, error: "HTTP 500" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.testNotification("p", "n1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications/n1/test", expect.objectContaining({ method: "POST" }));
    expect(res).toEqual({ ok: false, status: 500, error: "HTTP 500" });
  });

  it("deleteProject DELETEs the project endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, headers: headers() });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.deleteProject("p");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p", expect.objectContaining({ method: "DELETE" }));
  });

  it("retryRun POSTs to the run retry endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "r1", status: "generating" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.retryRun("p", "r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/runs/r1/retry", expect.objectContaining({ method: "POST" }));
    expect(res.status).toBe("generating");
  });

  it("getRunSummary GETs the run summary endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ qualityGate: { configured: true, passed: false, checks: [] } }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.getRunSummary("p", "r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/runs/r1/summary", expect.objectContaining({ method: "GET" }));
    expect(res.qualityGate.passed).toBe(false);
  });

  it("compareRuns GETs /compare with base+target query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ newlyFailing: [], fixed: [] }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.compareRuns("p", "r1", "r2");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/compare?base=r1&target=r2", expect.objectContaining({ method: "GET" }));
  });

  it("subscribeRuns opens an EventSource and delivers parsed events; unsubscribe closes it", () => {
    const closed: boolean[] = [];
    class FakeEventSource {
      onmessage: ((m: { data: string }) => void) | null = null;
      constructor(public url: string) { instances.push(this); }
      close() { closed.push(true); }
    }
    const instances: FakeEventSource[] = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

    const client = createClient("/api");
    const got: string[] = [];
    const unsub = client.subscribeRuns("p", (e) => got.push(e.run.id));
    expect(instances[0].url).toBe("/api/projects/p/events");

    instances[0].onmessage?.({ data: JSON.stringify({ type: "run", projectId: "p", run: { id: "r1", projectId: "p", status: "ready", reportName: "R", createdAt: "x", finishedAt: null, stats: null } }) });
    instances[0].onmessage?.({ data: ": ping" }); // heartbeat / malformed — ignored, no throw
    expect(got).toEqual(["r1"]);

    unsub();
    expect(closed).toEqual([true]);
    vi.unstubAllGlobals();
  });

  it("me/login/logout hit the auth endpoints with credentials included", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => null }) // me
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "u", email: "a@x", role: "admin", createdAt: "t" }) }) // login
      .mockResolvedValueOnce({ ok: true }); // logout (204, no body parsed)
    const client = createClient("/api", fetchMock as unknown as typeof fetch);

    expect(await client.me()).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/me", expect.objectContaining({ method: "GET", credentials: "include" }));

    const user = await client.login("a@x", "pw");
    expect(user.role).toBe("admin");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/login", expect.objectContaining({ method: "POST", credentials: "include" }));

    await client.logout(); // must not throw despite no JSON body
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST", credentials: "include" }));
  });

  it("setMember PUTs the project members endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: "u", email: "a@x", role: "viewer" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.setMember("p", "a@x", "viewer");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/members", expect.objectContaining({ method: "PUT", credentials: "include" }));
  });

  it("listAudit GETs /audit with paging and surfaces X-Total-Count", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: headers({ "X-Total-Count": "7" }), json: async () => [{ id: "a1", action: "login" }] });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const res = await client.listAudit({ limit: 50, offset: 50 });
    expect(fetchMock).toHaveBeenCalledWith("/api/audit?limit=50&offset=50", expect.objectContaining({ method: "GET", credentials: "include" }));
    expect(res.total).toBe(7);
  });

  it("getTestHistory GETs /tests/history with identity + limit query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ identity: { historyId: "h1", fullName: null, name: "t" }, window: 0, flakeRate: 0, entries: [] }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.getTestHistory("p", { historyId: "h1", limit: 50 });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tests/history?historyId=h1&limit=50", expect.objectContaining({ method: "GET", credentials: "include" }));
  });

  it("getTestTrace GETs /tests/history/trace with runId + identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trace: "x" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.getTestTrace("p", { runId: "r1", historyId: "h1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tests/history/trace?runId=r1&historyId=h1", expect.objectContaining({ method: "GET", credentials: "include" }));
  });

  it("subscribeRuns is a no-op when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const client = createClient("/api");
    const unsub = client.subscribeRuns("p", () => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("getQualityGate GETs /quality-gate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ maxFailures: 0 }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.getQualityGate("p");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/quality-gate", expect.objectContaining({ method: "GET" }));
  });

  it("setQualityGate PUTs the config as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ minPassRate: 0.95 }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.setQualityGate("p", { minPassRate: 0.95 });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/quality-gate",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ minPassRate: 0.95 }) }));
  });

  it("listTokens GETs /tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.listTokens("p");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens", expect.objectContaining({ method: "GET" }));
  });

  it("createToken POSTs the name and surfaces the plaintext token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t1", token: "ast_secret" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const created = await client.createToken("p", "ci");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ name: "ci" }) }));
    expect(created.token).toBe("ast_secret");
  });

  it("deleteToken DELETEs via the no-body path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.deleteToken("p", "t1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens/t1", expect.objectContaining({ method: "DELETE", credentials: "include" }));
  });

  it("listNotifications GETs /notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.listNotifications("p");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications", expect.objectContaining({ method: "GET" }));
  });

  it("createNotification POSTs kind/url/events", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "n1" }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const body = { kind: "webhook" as const, url: "https://x.test/h", events: ["failed" as const] };
    await client.createNotification("p", body);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
  });

  it("deleteNotification DELETEs via the no-body path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.deleteNotification("p", "n1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications/n1", expect.objectContaining({ method: "DELETE" }));
  });

  it("createProject sends displayName and updateProject PATCHes it", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "p", displayName: "Demo", createdAt: "", latestRunId: null, visibility: "public" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = createClient("/api", f);
    await c.createProject("p", "Demo");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ id: "p", displayName: "Demo" });
    await c.updateProject("p", { displayName: null });
    expect(calls[1].init.method).toBe("PATCH");
  });
});
