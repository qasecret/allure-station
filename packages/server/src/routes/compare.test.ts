import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";
import type { TestSummary } from "@allure-station/shared";

const stats = { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 };

async function readyRun(deps: AppDeps, projectId: string, runId: string, tests: TestSummary[]): Promise<void> {
  await deps.runs.create(projectId, runId, "R", deps.now());
  await deps.runs.claimPending(runId, deps.now());
  await deps.testResults.replaceForRun(runId, tests);
  await deps.runs.markReady(runId, stats, deps.now());
}

const sum = (name: string, status: TestSummary["status"], flaky = false): TestSummary => ({
  historyId: name, name, fullName: name, status, duration: null, flaky,
});

describe("GET /compare", () => {
  it("diffs two ready runs into buckets", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "base", [sum("a", "passed"), sum("b", "failed"), sum("gone", "passed")]);
    await readyRun(deps, "p", "target", [sum("a", "failed"), sum("b", "passed"), sum("new", "passed", true)]);

    const res = await app.inject({ method: "GET", url: "/api/projects/p/compare?base=base&target=target" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.newlyFailing.map((d: { name: string }) => d.name)).toEqual(["a"]);
    expect(body.fixed.map((d: { name: string }) => d.name)).toEqual(["b"]);
    expect(body.added.map((d: { name: string }) => d.name)).toEqual(["new"]);
    expect(body.removed.map((d: { name: string }) => d.name)).toEqual(["gone"]);
    expect(body.flaky.map((d: { name: string }) => d.name)).toEqual(["new"]);
    await app.close();
  });

  it("validates params and run state", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "ready1", [sum("a", "passed")]);
    await deps.runs.create("p", "pending1", "R", deps.now()); // stays pending

    // 404 unknown project
    expect((await app.inject({ method: "GET", url: "/api/projects/ghost/compare?base=ready1&target=ready1" })).statusCode).toBe(404);
    // 400 missing params
    expect((await app.inject({ method: "GET", url: "/api/projects/p/compare?base=ready1" })).statusCode).toBe(400);
    // 404 unknown run
    expect((await app.inject({ method: "GET", url: "/api/projects/p/compare?base=ready1&target=nope" })).statusCode).toBe(404);
    // 409 run not ready
    expect((await app.inject({ method: "GET", url: "/api/projects/p/compare?base=ready1&target=pending1" })).statusCode).toBe(409);
    await app.close();
  });
});
