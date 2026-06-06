import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("trends route", () => {
  it("returns ready runs as an oldest-first stats series", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z");
    await deps.runs.markReady("r1", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:02.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/trends" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { runId: "r1", createdAt: "2026-06-06T00:00:01.000Z", stats: { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 } },
    ]);
    await app.close();
  });

  it("carries the flaky count through to the trend series", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z");
    await deps.runs.markReady("r1", { total: 3, passed: 3, failed: 0, broken: 0, skipped: 0, flaky: 2 }, "2026-06-06T00:00:02.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/trends" });
    expect(res.json()[0].stats.flaky).toBe(2);
    await app.close();
  });
});
