import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";

async function readyRun(deps: AppDeps, projectId: string, runId: string, createdAt: string, stats: { total: number; passed: number; failed: number; broken: number; skipped: number }) {
  await deps.runs.create(projectId, runId, "R", createdAt);
  await deps.runs.claimPending(runId, createdAt);
  await deps.runs.markReady(runId, stats, createdAt);
}

describe("quality-gate + summary routes", () => {
  it("GET/PUT quality-gate (PUT is auth-gated) round-trips and clears", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());

    expect((await app.inject({ method: "GET", url: "/api/projects/p/quality-gate" })).json()).toEqual({});
    const put = await app.inject({ method: "PUT", url: "/api/projects/p/quality-gate", payload: { maxFailures: 0 } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/quality-gate" })).json()).toEqual({ maxFailures: 0 });
    // empty body clears
    await app.inject({ method: "PUT", url: "/api/projects/p/quality-gate", payload: {} });
    expect((await app.inject({ method: "GET", url: "/api/projects/p/quality-gate" })).json()).toEqual({});
    await app.close();
  });

  it("PUT quality-gate is rejected (401) when the project is token-protected", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } }); // locks the project
    expect((await app.inject({ method: "PUT", url: "/api/projects/p/quality-gate", payload: { maxFailures: 0 } })).statusCode).toBe(401);
    await app.close();
  });

  it("summary returns the verdict, report path, and previous ready run", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await deps.projects.setQualityGate("p", { maxFailures: 0 });
    await readyRun(deps, "p", "r1", "2026-06-06T00:00:01.000Z", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 });
    await readyRun(deps, "p", "r2", "2026-06-06T00:00:02.000Z", { total: 2, passed: 1, failed: 1, broken: 0, skipped: 0 });

    const s = (await app.inject({ method: "GET", url: "/api/projects/p/runs/r2/summary" })).json();
    expect(s.run.id).toBe("r2");
    expect(s.reportPath).toBe("/api/projects/p/runs/r2/report/index.html");
    expect(s.previousReadyRunId).toBe("r1");
    expect(s.qualityGate).toMatchObject({ configured: true, passed: false }); // 1 failure > maxFailures 0
    expect(s.qualityGate.checks[0]).toMatchObject({ rule: "maxFailures", actual: 1, threshold: 0, ok: false });

    // r1 passes the gate and has no previous ready run
    const s1 = (await app.inject({ method: "GET", url: "/api/projects/p/runs/r1/summary" })).json();
    expect(s1.qualityGate.passed).toBe(true);
    expect(s1.previousReadyRunId).toBeNull();
    await app.close();
  });

  it("summary 404s an unknown or cross-project run", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs/nope/summary" })).statusCode).toBe(404);
    await app.close();
  });
});
