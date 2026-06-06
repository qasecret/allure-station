import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";

describe("api client", () => {
  it("lists projects via GET /projects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => [{ id: "p", createdAt: "x", latestRunId: null }],
    });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const projects = await client.listProjects();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "GET" }));
    expect(projects[0].id).toBe("p");
  });

  it("throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await expect(client.listProjects()).rejects.toThrow("500");
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

  it("subscribeRuns is a no-op when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const client = createClient("/api");
    const unsub = client.subscribeRuns("p", () => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
