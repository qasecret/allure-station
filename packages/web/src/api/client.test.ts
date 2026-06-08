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
});
