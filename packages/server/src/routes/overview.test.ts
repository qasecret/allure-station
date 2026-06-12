import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";

describe("GET /overview", () => {
  it("counts projects, failing, gate breaches, runs in 24h, generating — scoped by visibility", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "ok" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "bad" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "busy" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "genfail" } });
    // ok: healthy ready run
    await deps.runs.create("ok", "r-ok", "R", deps.now());
    await deps.runs.claimPending("r-ok", deps.now());
    await deps.runs.markReady("r-ok", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 }, deps.now());
    // bad: latest run has failures + breaches its gate
    await deps.projects.setQualityGate("bad", { maxFailures: 0 });
    await deps.runs.create("bad", "r-bad", "R", deps.now());
    await deps.runs.claimPending("r-bad", deps.now());
    await deps.runs.markReady("r-bad", { total: 2, passed: 1, failed: 1, broken: 0, skipped: 0 }, deps.now());
    // busy: a run still generating
    await deps.runs.create("busy", "r-busy", "R", deps.now());
    await deps.runs.claimPending("r-busy", deps.now());
    // genfail: latest run failed generation (null stats)
    await deps.runs.create("genfail", "r-genfail", "R", deps.now());
    await deps.runs.claimPending("r-genfail", deps.now());
    await deps.runs.markFailed("r-genfail", deps.now(), "boom");

    const res = await app.inject({ method: "GET", url: "/api/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: 4, failing: 2, gateBreached: 1, runsLast24h: 4, generating: 1 });
    await app.close();
  });

  it("anonymous overview excludes private projects", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "pub" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "priv" } });
    await deps.projects.setVisibility("priv", "private");
    // seed a run on the private project
    await deps.runs.create("priv", "r-priv", "R", deps.now());
    await deps.runs.claimPending("r-priv", deps.now());
    await deps.runs.markReady("r-priv", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, deps.now());
    // seed a user so security is on and anonymous is actually scoped
    await deps.users.create("a@example.com", await hashPassword("password123"), "admin", deps.now());
    const res = await app.inject({ method: "GET", url: "/api/overview" });
    expect(res.json().projects).toBe(1);
    expect(res.json().runsLast24h).toBe(0);
    await app.close();
  });
});
