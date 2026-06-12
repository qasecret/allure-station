import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";

async function seedAdmin(deps: AppDeps) {
  return deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
}
async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return res.cookies.find((c) => c.name === "as_session")!.value;
}

describe("user routes (admin-gated)", () => {
  it("admin creates, lists, and deletes users; password is never returned", async () => {
    const deps = await makeTestDeps();
    const admin = await seedAdmin(deps);
    const app = buildApp(deps);
    const cookie = await login(app, "admin@x.com", "password123");

    const created = await app.inject({ method: "POST", url: "/api/users", payload: { email: "dev@x.com", password: "devpass12", role: "user" }, cookies: { as_session: cookie } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: "dev@x.com", role: "user" });
    expect(created.json()).not.toHaveProperty("passwordHash");
    expect(created.json()).not.toHaveProperty("password");

    const list = await app.inject({ method: "GET", url: "/api/users", cookies: { as_session: cookie } });
    expect(list.json()).toHaveLength(2); // admin + dev

    const devId = created.json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/users/${devId}`, cookies: { as_session: cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/users", cookies: { as_session: cookie } })).json()).toHaveLength(1);

    // self-deletion is blocked
    expect((await app.inject({ method: "DELETE", url: `/api/users/${admin.id}`, cookies: { as_session: cookie } })).statusCode).toBe(400);
    await app.close();
  });

  it("rejects duplicate email and invalid input", async () => {
    const deps = await makeTestDeps();
    await seedAdmin(deps);
    const app = buildApp(deps);
    const cookie = await login(app, "admin@x.com", "password123");

    expect((await app.inject({ method: "POST", url: "/api/users", payload: { email: "admin@x.com", password: "password123" }, cookies: { as_session: cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/users", payload: { email: "x@x.com", password: "short" }, cookies: { as_session: cookie } })).statusCode).toBe(400);
    await app.close();
  });

  it("non-admins and anonymous cannot manage users", async () => {
    const deps = await makeTestDeps();
    await seedAdmin(deps);
    await deps.users.create("u@x.com", await hashPassword("password123"), "user", deps.now());
    const app = buildApp(deps);
    const userCookie = await login(app, "u@x.com", "password123");

    const anon = await app.inject({ method: "GET", url: "/api/users" });
    expect(anon.statusCode).toBe(401); // anonymous → 401 unauthenticated
    expect(anon.json().error).toBe("unauthenticated");
    const nonAdmin = await app.inject({ method: "GET", url: "/api/users", cookies: { as_session: userCookie } });
    expect(nonAdmin.statusCode).toBe(403); // signed-in non-admin → 403 forbidden
    expect(nonAdmin.json().error).toBe("forbidden");
    await app.close();
  });

  it("splits 401 (anonymous) from 403 (insufficient role)", async () => {
    const deps = await makeTestDeps();
    await seedAdmin(deps);
    await deps.users.create("viewer@example.com", await hashPassword("password123"), "user", deps.now());
    const app = buildApp(deps);

    // anonymous on an admin route → 401 unauthenticated
    const anon = await app.inject({ method: "GET", url: "/api/users" });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error).toBe("unauthenticated");
    // signed-in non-admin → 403 forbidden
    const viewer = await login(app, "viewer@example.com", "password123");
    const res = await app.inject({ method: "GET", url: "/api/users", cookies: { as_session: viewer } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
    await app.close();
  });

  it("invalid bearer token stays 401 (no oracle)", async () => {
    const deps = await makeTestDeps();
    await seedAdmin(deps);
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: await login(app, "admin@x.com", "password123") } });
    const res = await app.inject({ method: "POST", url: "/api/projects/p/generate", headers: { authorization: "Bearer ast_bogus" } });
    expect([401, 404]).toContain(res.statusCode); // 401 unauthenticated, never 403
    if (res.statusCode === 401) expect(res.json().error).toBe("unauthenticated");
    await app.close();
  });
});
