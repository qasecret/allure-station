import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { renderBadge } from "../badge.js";
import type { AppDeps } from "../app.js";

async function readyRun(deps: AppDeps, projectId: string, runId: string, stats: { total: number; passed: number; failed: number; broken: number; skipped: number }) {
  await deps.runs.create(projectId, runId, "R", deps.now());
  await deps.runs.claimPending(runId, deps.now());
  await deps.runs.markReady(runId, stats, deps.now());
}

describe("badge route", () => {
  it("renders a grey 'no data' badge for an unknown project (always 200 svg)", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/projects/ghost/badge.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toContain("no data");
    expect(res.body).toContain("#9f9f9f");
    await app.close();
  });

  it("renders green pass-ratio for an all-passed latest run", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 });
    const res = await app.inject({ method: "GET", url: "/api/projects/p/badge.svg" });
    expect(res.body).toContain(">2/2<");
    expect(res.body).toContain("#4c1");
    await app.close();
  });

  it("renders red when the latest run has failures", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", { total: 3, passed: 1, failed: 1, broken: 1, skipped: 0 });
    const res = await app.inject({ method: "GET", url: "/api/projects/p/badge.svg" });
    expect(res.body).toContain(">1/3<");
    expect(res.body).toContain("#e05d44");
    await app.close();
  });
});

describe("renderBadge", () => {
  it("escapes markup and widens with text", () => {
    const svg = renderBadge("tests", "<x>", "#4c1");
    expect(svg).toContain("&lt;x&gt;");
    expect(svg).not.toContain("<x>");
    const wide = renderBadge("tests", "a-very-long-message", "#4c1");
    const narrow = renderBadge("tests", "1/1", "#4c1");
    const widthOf = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
  });
});
