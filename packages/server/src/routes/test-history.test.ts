import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";
import type { TestSummary } from "@allure-station/shared";

const stats = { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 };
async function readyRun(deps: AppDeps, projectId: string, runId: string, tests: TestSummary[], createdAt: string): Promise<void> {
  await deps.runs.create(projectId, runId, "R", createdAt, { branch: "main", ciUrl: "http://ci/" + runId });
  await deps.runs.claimPending(runId, createdAt);
  await deps.testResults.replaceForRun(runId, tests);
  await deps.runs.markReady(runId, stats, createdAt);
}
const sum = (status: TestSummary["status"], flaky = false, message: string | null = null): TestSummary => ({
  historyId: "h1", name: "t", fullName: "s#t", status, duration: 5, flaky, message, trace: null,
});

describe("GET /tests/history", () => {
  it("returns a test's timeline newest-first with flake rate", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    await readyRun(deps, "p", "r2", [sum("failed", true, "boom")], "2026-06-02T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries.map((e: { runId: string }) => e.runId)).toEqual(["r2", "r1"]);
    expect(body.identity).toMatchObject({ historyId: "h1", name: "t" });
    expect(body.window).toBe(2);
    expect(body.flakeRate).toBeCloseTo(0.5);
    expect(body.entries[0]).toMatchObject({ status: "failed", message: "boom", ciUrl: "http://ci/r2" });
    await app.close();
  });

  it("400 when no identity key is given", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 for a private project to an anonymous caller", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await deps.projects.setVisibility("p", "private");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("clamps limit and tolerates pre-F0 null error fields", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1&limit=9999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.length).toBeLessThanOrEqual(200);
    expect(res.json().entries[0].message).toBeNull();
    await app.close();
  });

  it("limit=0 / negative falls back to the default window, not 1 row", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    await readyRun(deps, "p", "r2", [sum("failed")], "2026-06-02T00:00:00.000Z");
    for (const limit of ["0", "-5"]) {
      const res = await app.inject({ method: "GET", url: `/api/projects/p/tests/history?historyId=h1&limit=${limit}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().entries).toHaveLength(2); // default 50, not clamped to 1
    }
    await app.close();
  });

  it("identity.fullName/historyId come from the DB even when queried by historyId only", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().identity).toMatchObject({ historyId: "h1", fullName: "s#t", name: "t" });
    await app.close();
  });
});
