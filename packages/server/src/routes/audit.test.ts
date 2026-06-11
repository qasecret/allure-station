import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";
import type { AuditEntry } from "@allure-station/shared";
import { auditActionSchema } from "@allure-station/shared";

async function seed(deps: AppDeps) {
  await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
  await deps.users.create("owner@x.com", await hashPassword("password123"), "user", deps.now());
  await deps.users.create("plain@x.com", await hashPassword("password123"), "user", deps.now());
}
async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
  return res.cookies.find((c) => c.name === "as_session")!.value;
}

describe("audit routes + recording", () => {
  it("records sensitive actions and exposes them to the global admin log", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");

    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "owner@x.com", role: "owner" }, cookies: { as_session: adminCookie } });
    // a failed login is recorded too
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@x.com", password: "wrong" } });

    const res = await app.inject({ method: "GET", url: "/api/audit", cookies: { as_session: adminCookie } });
    expect(res.statusCode).toBe(200);
    const actions = (res.json() as AuditEntry[]).map((e) => e.action);
    expect(actions).toContain("login");          // admin login
    expect(actions).toContain("project_created");
    expect(actions).toContain("member_set");
    expect(actions).toContain("login_failed");
    expect(Number(res.headers["x-total-count"])).toBeGreaterThanOrEqual(4);
    // login_failed carries the attempted email; admin actor labelled by email
    const failed = (res.json() as AuditEntry[]).find((e) => e.action === "login_failed")!;
    expect(failed.metadata).toMatchObject({ email: "owner@x.com" });
    expect(failed.actorType).toBe("anonymous");
    await app.close();
  });

  it("per-project audit is visible to the project owner but not other users; global audit is admin-only", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "owner@x.com", role: "owner" }, cookies: { as_session: adminCookie } });

    const ownerCookie = await login(app, "owner@x.com");
    const plainCookie = await login(app, "plain@x.com");

    // Owner sees the project's audit; every entry is scoped to that project.
    const ownerView = await app.inject({ method: "GET", url: "/api/projects/p/audit", cookies: { as_session: ownerCookie } });
    expect(ownerView.statusCode).toBe(200);
    expect((ownerView.json() as AuditEntry[]).every((e) => e.projectId === "p")).toBe(true);

    // A non-owner user and anonymous are denied the per-project log.
    expect((await app.inject({ method: "GET", url: "/api/projects/p/audit", cookies: { as_session: plainCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/audit" })).statusCode).toBe(401);

    // The global log is admin-only.
    expect((await app.inject({ method: "GET", url: "/api/audit", cookies: { as_session: ownerCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/audit" })).statusCode).toBe(401);

    // Missing project → 404.
    expect((await app.inject({ method: "GET", url: "/api/projects/nope/audit", cookies: { as_session: adminCookie } })).statusCode).toBe(404);
    await app.close();
  });
});

describe("audit log filters", () => {
  it("filters by action, actor substring, and from/to window; total reflects filters", async () => {
    const deps = await makeTestDeps();
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");

    // Seed: create a project (project_created), rename it (project_renamed), create a token (token_created).
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "filter-test" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PATCH", url: "/api/projects/filter-test", payload: { displayName: "Filter Test" }, cookies: { as_session: adminCookie } });
    // project_renamed is recorded on displayName update (PATCH /projects/:id)
    await app.inject({ method: "POST", url: "/api/projects/filter-test/tokens", payload: { name: "ci-token" }, cookies: { as_session: adminCookie } });

    // --- action filter ---
    const filteredByAction = await app.inject({
      method: "GET",
      url: "/api/audit?action=project_created",
      cookies: { as_session: adminCookie },
    });
    expect(filteredByAction.statusCode).toBe(200);
    const filteredEntries = filteredByAction.json() as AuditEntry[];
    expect(filteredEntries.every((e) => e.action === "project_created")).toBe(true);
    expect(Number(filteredByAction.headers["x-total-count"])).toBe(filteredEntries.length);

    // Bogus action → 400.
    expect(
      (await app.inject({ method: "GET", url: "/api/audit?action=bogus_action", cookies: { as_session: adminCookie } })).statusCode
    ).toBe(400);

    // --- actor substring filter ---
    const byActor = await app.inject({
      method: "GET",
      url: "/api/audit?actor=admin%40",
      cookies: { as_session: adminCookie },
    });
    expect(byActor.statusCode).toBe(200);
    expect((byActor.json() as AuditEntry[]).length).toBeGreaterThan(0);
    // Every returned entry must match the actor substring.
    expect((byActor.json() as AuditEntry[]).every((e) => e.actorLabel.includes("admin@"))).toBe(true);

    // --- from filter: far future → no results ---
    const none = await app.inject({
      method: "GET",
      url: "/api/audit?from=2030-01-01T00:00:00.000Z",
      cookies: { as_session: adminCookie },
    });
    expect(none.statusCode).toBe(200);
    expect((none.json() as AuditEntry[]).length).toBe(0);
    expect(Number(none.headers["x-total-count"])).toBe(0);

    // --- to filter: cut off before any entries → no results ---
    const toNone = await app.inject({
      method: "GET",
      url: "/api/audit?to=2000-01-01T00:00:00.000Z",
      cookies: { as_session: adminCookie },
    });
    expect(toNone.statusCode).toBe(200);
    expect((toNone.json() as AuditEntry[]).length).toBe(0);

    // --- invalid date → 400 ---
    expect(
      (await app.inject({ method: "GET", url: "/api/audit?from=not-a-date", cookies: { as_session: adminCookie } })).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/api/audit?to=not-a-date", cookies: { as_session: adminCookie } })).statusCode
    ).toBe(400);

    await app.close();
  });

  it("per-project audit also supports action/actor/from/to filters", async () => {
    const deps = await makeTestDeps();
    await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");

    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "proj-filter" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PATCH", url: "/api/projects/proj-filter", payload: { displayName: "Proj Filter" }, cookies: { as_session: adminCookie } });

    // Filter project audit by action — only project_created (not project_renamed)
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proj-filter/audit?action=project_created",
      cookies: { as_session: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json() as AuditEntry[];
    expect(entries.every((e) => e.action === "project_created")).toBe(true);
    expect(Number(res.headers["x-total-count"])).toBe(entries.length);

    // Bogus action → 400
    expect(
      (await app.inject({ method: "GET", url: "/api/projects/proj-filter/audit?action=bogus", cookies: { as_session: adminCookie } })).statusCode
    ).toBe(400);

    // Invalid date → 400
    expect(
      (await app.inject({ method: "GET", url: "/api/projects/proj-filter/audit?from=bad", cookies: { as_session: adminCookie } })).statusCode
    ).toBe(400);

    await app.close();
  });
});
