import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";

async function seedUser(deps: AppDeps, email: string, password: string, role: "admin" | "user" = "user") {
  return deps.users.create(email, await hashPassword(password), role, deps.now());
}

/** Log in and return the session cookie value for use in subsequent injects. */
async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  const cookie = res.cookies.find((c) => c.name === "as_session");
  if (!cookie) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return cookie.value;
}

describe("auth routes", () => {
  it("login sets an httpOnly session cookie; me reflects the user; logout clears it", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, "admin@x.com", "password123", "admin");
    const app = buildApp(deps);

    const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@x.com", password: "password123" } });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json()).toMatchObject({ email: "admin@x.com", role: "admin" });
    const cookie = loginRes.cookies.find((c) => c.name === "as_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite?.toLowerCase()).toBe("lax");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { as_session: cookie.value } });
    expect(me.json()).toMatchObject({ email: "admin@x.com", role: "admin" });

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { as_session: cookie.value } });
    expect(logout.statusCode).toBe(204);
    // Session row is gone → the same cookie no longer authenticates.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: { as_session: cookie.value } })).json()).toBeNull();
    await app.close();
  });

  it("rejects bad credentials with a generic 401 and no cookie", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, "u@x.com", "rightpass1", "user");
    const app = buildApp(deps);

    const wrongPass = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "u@x.com", password: "nope" } });
    expect(wrongPass.statusCode).toBe(401);
    expect(wrongPass.cookies.find((c) => c.name === "as_session")).toBeUndefined();

    const noUser = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@x.com", password: "whatever1" } });
    expect(noUser.statusCode).toBe(401);
    await app.close();
  });

  it("me returns null when anonymous", async () => {
    const app = buildApp(await makeTestDeps());
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json()).toBeNull();
    await app.close();
  });

  it("email is case-insensitive: seeded as mixed case, login with any casing", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, "Admin@X.com", "password123", "admin"); // stored lowercased
    const app = buildApp(deps);
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ADMIN@x.COM", password: "password123" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe("admin@x.com");
    await app.close();
  });

  it("a maintainer session can write; a viewer session cannot; anonymous is blocked once accounts exist", async () => {
    const deps = await makeTestDeps();
    const admin = await seedUser(deps, "admin@x.com", "password123", "admin");
    const maint = await seedUser(deps, "maint@x.com", "password123", "user");
    const view = await seedUser(deps, "view@x.com", "password123", "user");
    void admin;
    const app = buildApp(deps);

    // Admin creates the project + assigns roles.
    const adminCookie = await login(app, "admin@x.com", "password123");
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "proj" }, cookies: { as_session: adminCookie } })).statusCode).toBe(201);
    await app.inject({ method: "PUT", url: "/api/projects/proj/members", payload: { email: "maint@x.com", role: "maintainer" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/proj/members", payload: { email: "view@x.com", role: "viewer" }, cookies: { as_session: adminCookie } });
    void maint; void view;

    // Anonymous cannot create projects now that accounts exist.
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "nope" } })).statusCode).toBe(401);

    // Maintainer can set the quality gate (a write); viewer cannot.
    const maintCookie = await login(app, "maint@x.com", "password123");
    const viewCookie = await login(app, "view@x.com", "password123");
    expect((await app.inject({ method: "PUT", url: "/api/projects/proj/quality-gate", payload: { minTests: 1 }, cookies: { as_session: maintCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/projects/proj/quality-gate", payload: { minTests: 1 }, cookies: { as_session: viewCookie } })).statusCode).toBe(401);
    await app.close();
  });
});
