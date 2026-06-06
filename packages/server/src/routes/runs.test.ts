import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("run routes", () => {
  it("lists runs for a project and 404s unknown run", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", deps.newId(), "R", deps.now());

    const list = await app.inject({ method: "GET", url: "/api/projects/p/runs" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs/nope" })).statusCode).toBe(404);
    await app.close();
  });

  it("filters runs by ?status, paginates, sets X-Total-Count, and 400s bad status", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z"); // pending
    await deps.runs.create("p", "r2", "R", "2026-06-06T00:00:02.000Z");
    await deps.runs.claimPending("r2", "2026-06-06T00:00:03.000Z");
    await deps.runs.markReady("r2", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:04.000Z");

    const ready = await app.inject({ method: "GET", url: "/api/projects/p/runs?status=ready" });
    expect(ready.json().map((r: { id: string }) => r.id)).toEqual(["r2"]);
    expect(ready.headers["x-total-count"]).toBe("1");

    const all = await app.inject({ method: "GET", url: "/api/projects/p/runs" });
    expect(all.headers["x-total-count"]).toBe("2");

    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs?status=bogus" })).statusCode).toBe(400);
    await app.close();
  });

  it("GET run-by-id enforces project ownership (IDOR fix)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);

    // Create two projects
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p1" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p2" } });

    // Create a run under p2
    const p2RunId = deps.newId();
    await deps.runs.create("p2", p2RunId, "P2 Report", deps.now());

    // Fetching the p2 run via p1's URL must return 404 (IDOR protection)
    const idor = await app.inject({ method: "GET", url: `/api/projects/p1/runs/${p2RunId}` });
    expect(idor.statusCode).toBe(404);

    // Fetching the p2 run via p2's URL must return 200
    const ok = await app.inject({ method: "GET", url: `/api/projects/p2/runs/${p2RunId}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().projectId).toBe("p2");

    await app.close();
  });
});
