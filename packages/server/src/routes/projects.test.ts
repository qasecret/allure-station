import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AuditEntry } from "@allure-station/shared";
import type { AppDeps } from "../app.js";

async function seedUsers(deps: AppDeps) {
  await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
  await deps.users.create("maintainer@x.com", await hashPassword("password123"), "user", deps.now());
  await deps.users.create("viewer@x.com", await hashPassword("password123"), "user", deps.now());
  await deps.users.create("anon@x.com", await hashPassword("password123"), "user", deps.now());
}
async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
  return res.cookies.find((c) => c.name === "as_session")!.value;
}

describe("project routes", () => {
  it("creates, lists, gets and deletes a project", async () => {
    const app = buildApp(await makeTestDeps());

    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { id: "team-a" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "team-a", latestRunId: null });

    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.json().map((p: { id: string }) => p.id)).toEqual(["team-a"]);

    const got = await app.inject({ method: "GET", url: "/api/projects/team-a" });
    expect(got.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: "/api/projects/team-a" });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects/team-a" })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects an invalid id with 400 and a duplicate with 409", async () => {
    const app = buildApp(await makeTestDeps());
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "a/b" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } });
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } })).statusCode).toBe(409);
    await app.close();
  });

  it("supports ?q search, ?limit/?offset pagination, and X-Total-Count", async () => {
    const app = buildApp(await makeTestDeps());
    for (const id of ["alpha", "alpine", "beta"]) await app.inject({ method: "POST", url: "/api/projects", payload: { id } });

    const search = await app.inject({ method: "GET", url: "/api/projects?q=alp" });
    expect(search.json().map((p: { id: string }) => p.id)).toEqual(["alpha", "alpine"]);
    expect(search.headers["x-total-count"]).toBe("2");

    const page = await app.inject({ method: "GET", url: "/api/projects?limit=1&offset=1" });
    expect(page.json().map((p: { id: string }) => p.id)).toEqual(["alpine"]);
    expect(page.headers["x-total-count"]).toBe("3"); // total ignores pagination

    expect((await app.inject({ method: "GET", url: "/api/projects?limit=-1" })).statusCode).toBe(400);
    await app.close();
  });
});

describe("project display name", () => {
  it("creates with a display name, trims it, and returns it on GET", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { id: "named", displayName: "  Demo Web App  " } });
    expect(created.statusCode).toBe(201);
    expect(created.json().displayName).toBe("Demo Web App");
    expect((await app.inject({ method: "GET", url: "/api/projects/named" })).json().displayName).toBe("Demo Web App");
    await app.close();
  });

  it("defaults displayName to null and PATCH updates + clears it (audited)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "GET", url: "/api/projects/p" })).json().displayName).toBeNull();

    const renamed = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "Payments" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().displayName).toBe("Payments");

    // empty string clears back to null
    const cleared = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "" } });
    expect(cleared.json().displayName).toBeNull();

    const audit = await deps.audit.list({ limit: 10 });
    expect(audit.some((e: AuditEntry) => e.action === "project_renamed")).toBe(true);
    await app.close();
  });

  it("PATCH 404s unknown project and 400s an over-long name", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    expect((await app.inject({ method: "PATCH", url: "/api/projects/nope", payload: { displayName: "x" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "x".repeat(121) } })).statusCode).toBe(400);
    await app.close();
  });
});

describe("PATCH /projects/:id — private-project existence-tell fix (A1)", () => {
  it("anonymous PATCH on a private project returns 404 (not 401)", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps);
    const app = buildApp(deps);
    const adminCookie = await loginAs(app, "admin@x.com");

    // Create and make private (only accessible to admin)
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "secret" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/secret/visibility", payload: { visibility: "private" }, cookies: { as_session: adminCookie } });

    // Anonymous PATCH must return 404 — 401 would reveal the project exists
    const res = await app.inject({ method: "PATCH", url: "/api/projects/secret", payload: { displayName: "leaked" } });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("anonymous PATCH on a public project returns 401 (not 404)", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps);
    const app = buildApp(deps);
    const adminCookie = await loginAs(app, "admin@x.com");

    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "open" }, cookies: { as_session: adminCookie } });
    // public visibility (default) — unauthorized should get 401
    const res = await app.inject({ method: "PATCH", url: "/api/projects/open", payload: { displayName: "x" } });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("anonymous PATCH on a missing project returns 404 — indistinguishable from private", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps); // security on — ensures auth check runs before existence check
    const app = buildApp(deps);

    // No project created — does-not-exist must return 404, same as a private project
    const res = await app.inject({ method: "PATCH", url: "/api/projects/does-not-exist", payload: { displayName: "x" } });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});

describe("GET /projects/:id — canWrite field (A3)", () => {
  it("open mode: anonymous gets canWrite=true", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });

    const res = await app.inject({ method: "GET", url: "/api/projects/p" });
    expect(res.statusCode).toBe(200);
    expect(res.json().canWrite).toBe(true);
    await app.close();
  });

  it("security on: anonymous on public project gets canWrite=false", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps);
    const app = buildApp(deps);
    const adminCookie = await loginAs(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });

    const res = await app.inject({ method: "GET", url: "/api/projects/p" });
    expect(res.statusCode).toBe(200);
    expect(res.json().canWrite).toBe(false);
    await app.close();
  });

  it("admin gets canWrite=true", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps);
    const app = buildApp(deps);
    const adminCookie = await loginAs(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });

    const res = await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().canWrite).toBe(true);
    await app.close();
  });

  it("viewer member gets canWrite=false; maintainer member gets canWrite=true", async () => {
    const deps = await makeTestDeps();
    await seedUsers(deps);
    const app = buildApp(deps);
    const adminCookie = await loginAs(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "viewer@x.com", role: "viewer" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "maintainer@x.com", role: "maintainer" }, cookies: { as_session: adminCookie } });

    const viewerCookie = await loginAs(app, "viewer@x.com");
    const viewerRes = await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: viewerCookie } });
    expect(viewerRes.json().canWrite).toBe(false);

    const maintainerCookie = await loginAs(app, "maintainer@x.com");
    const maintainerRes = await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: maintainerCookie } });
    expect(maintainerRes.json().canWrite).toBe(true);

    await app.close();
  });
});
