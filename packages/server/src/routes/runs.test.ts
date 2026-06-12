import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AuditEntry } from "@allure-station/shared";

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

describe("DELETE run", () => {
  it("hard-deletes a run: row gone, storage prefix removed, audited", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");
    await deps.storage.putBuffer("p/runs/r1/results/x-result.json", Buffer.from("{}"));

    const res = await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(res.statusCode).toBe(204);
    expect(await deps.runs.get("r1")).toBeNull();
    expect(await deps.storage.exists("p/runs/r1")).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs/r1" })).statusCode).toBe(404);

    const audit = await deps.audit.list({ limit: 10 });
    expect(audit.some((e: AuditEntry) => e.action === "run_deleted" && e.targetId === "r1")).toBe(true);

    await app.close();
  });

  it("409s while generating, 404s cross-project (IDOR) and unknown ids", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "other" } });
    await deps.runs.create("p", "busy", "R", "2026-06-10T00:00:01.000Z");
    await deps.runs.claimPending("busy", "2026-06-10T00:00:02.000Z"); // now 'generating'

    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/runs/busy" })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/other/runs/busy" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/runs/nope" })).statusCode).toBe(404);
    await app.close();
  });

  it("publishes a deleted run event", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");
    const events: unknown[] = [];
    const unsub = deps.bus.subscribe((e) => { if (e.projectId === "p") events.push(e); });
    await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(events.some((e) => (e as { deleted?: boolean }).deleted === true)).toBe(true);
    unsub();
    await app.close();
  });

  it("cascade regression: test_results rows are gone after run is deleted", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");
    // Seed test results for the run
    await deps.testResults.replaceForRun("r1", [
      { historyId: "h1", name: "Test A", fullName: "suite.TestA", status: "passed", duration: 100, flaky: false },
    ]);
    // Verify they exist before delete
    expect(await deps.testResults.listByRun("r1")).toHaveLength(1);

    const res = await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(res.statusCode).toBe(204);

    // Row gone from runs
    expect(await deps.runs.get("r1")).toBeNull();
    // test_results rows must also be gone (cascade)
    expect(await deps.testResults.listByRun("r1")).toHaveLength(0);

    await app.close();
  });

  it("anonymous DELETE returns 401 when security is enabled (a user exists)", async () => {
    const deps = await makeTestDeps();
    // Seeding a user enables security (zero-config open mode requires no users).
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
    const app = buildApp(deps);
    // Seed project and run directly through the repos (API is now auth-guarded).
    await deps.projects.create("p", deps.now());
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");

    const res = await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(res.statusCode).toBe(401);

    await app.close();
  });
});

describe("DELETE run — private-project existence-tell fix (A1)", () => {
  it("anonymous DELETE on a run in a private project returns 404", async () => {
    const deps = await makeTestDeps();
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
    const app = buildApp(deps);

    // Log in as admin to set up the project and run
    const adminLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@x.com", password: "password123" } });
    const adminCookie = adminLogin.cookies.find((c) => c.name === "as_session")!.value;

    await deps.projects.create("secret", deps.now());
    await deps.projects.setVisibility("secret", "private");
    await deps.runs.create("secret", "r1", "R", "2026-06-10T00:00:01.000Z");

    // Anonymous DELETE must return 404 — 401 would reveal the project exists
    const res = await app.inject({ method: "DELETE", url: "/api/projects/secret/runs/r1" });
    expect(res.statusCode).toBe(404);

    // Admin can still delete it successfully
    const adminRes = await app.inject({ method: "DELETE", url: "/api/projects/secret/runs/r1", cookies: { as_session: adminCookie } });
    expect(adminRes.statusCode).toBe(204);

    await app.close();
  });

  it("anonymous DELETE on a run in a public project returns 401", async () => {
    const deps = await makeTestDeps();
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
    const app = buildApp(deps);

    await deps.projects.create("open", deps.now());
    // public visibility (default) — unauthorized should get 401
    await deps.runs.create("open", "r1", "R", "2026-06-10T00:00:01.000Z");

    const res = await app.inject({ method: "DELETE", url: "/api/projects/open/runs/r1" });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("anonymous DELETE on a missing project returns 404 — indistinguishable from private", async () => {
    const deps = await makeTestDeps();
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now()); // security on
    const app = buildApp(deps);

    // No project created — does-not-exist must return 404, same as a private project
    const res = await app.inject({ method: "DELETE", url: "/api/projects/does-not-exist/runs/x" });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});

describe("runs sorting + trends limit", () => {
  it("sorts by duration desc with nulls last, and by status; validates params", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "slow", "R", "2026-06-11T01:00:00.000Z");
    await deps.runs.claimPending("slow", "x"); await deps.runs.markReady("slow", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0, durationMs: 9000 }, "x");
    await deps.runs.create("p", "fast", "R", "2026-06-11T02:00:00.000Z");
    await deps.runs.claimPending("fast", "x"); await deps.runs.markReady("fast", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0, durationMs: 1000 }, "x");
    await deps.runs.create("p", "pend", "R", "2026-06-11T03:00:00.000Z"); // no stats → null duration

    const dur = await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=duration&order=desc" });
    expect((dur.json() as Array<{ id: string }>).map((r) => r.id)).toEqual(["slow", "fast", "pend"]);
    const st = await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=status" });
    expect(st.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=nope" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs?order=sideways" })).statusCode).toBe(400);
    await app.close();
  });

  it("trends honors ?limit within 10..100", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    for (let i = 0; i < 12; i++) {
      const id = `r${String(i).padStart(2, "0")}`;
      await deps.runs.create("p", id, "R", `2026-06-11T0${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}:00.000Z`);
      await deps.runs.claimPending(id, "x");
      await deps.runs.markReady(id, { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "x");
    }
    expect(((await app.inject({ method: "GET", url: "/api/projects/p/trends?limit=10" })).json() as unknown[])).toHaveLength(10);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/trends?limit=5" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/trends" })).json()).toHaveLength(12); // default 30 cap
    await app.close();
  });
});
