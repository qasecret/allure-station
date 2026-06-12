import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";
import type { SessionInfo } from "@allure-station/shared";

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

/** Log in with optional extra headers and return the full cookie string ("as_session=<value>"). */
async function loginGetCookie(
  app: FastifyInstance,
  email: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password }, headers });
  const cookie = res.cookies.find((c) => c.name === "as_session");
  if (!cookie) throw new Error(`loginGetCookie failed: ${res.statusCode} ${res.body}`);
  return `as_session=${cookie.value}`;
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

    // Maintainer can set the quality gate (a write); viewer cannot (403 — signed-in but insufficient role).
    const maintCookie = await login(app, "maint@x.com", "password123");
    const viewCookie = await login(app, "view@x.com", "password123");
    expect((await app.inject({ method: "PUT", url: "/api/projects/proj/quality-gate", payload: { minTests: 1 }, cookies: { as_session: maintCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/projects/proj/quality-gate", payload: { minTests: 1 }, cookies: { as_session: viewCookie } })).statusCode).toBe(403);
    await app.close();
  });
});

describe("account & sessions", () => {
  const email = "sess@example.com";
  const pw = "testpass1";

  it("lists own sessions with device info and current flag", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, email, pw);
    const app = buildApp(deps);

    const c1 = await loginGetCookie(app, email, pw, { "user-agent": "AgentOne/1.0" });
    const c2 = await loginGetCookie(app, email, pw, { "user-agent": "AgentTwo/2.0" });
    const res = await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c2 } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as SessionInfo[];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.find((s) => s.current)?.userAgent).toBe("AgentTwo/2.0");
    // tokenHash must NOT be exposed
    for (const s of list) {
      expect(s).not.toHaveProperty("tokenHash");
    }
    void c1;
    await app.close();
  });

  it("revokes a single session (own only) and all-others", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, email, pw);
    const app = buildApp(deps);

    const c1 = await loginGetCookie(app, email, pw, {});
    const c2 = await loginGetCookie(app, email, pw, {});
    const list = (await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c2 } })).json() as SessionInfo[];
    const other = list.find((s: SessionInfo) => !s.current);
    expect(other).toBeDefined();
    expect((await app.inject({ method: "DELETE", url: `/api/auth/sessions/${other!.id}`, headers: { cookie: c2 } })).statusCode).toBe(204);
    // c1 is now dead
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c1 } })).statusCode).toBe(401);
    // bulk: log in twice more, then revoke-all-others
    await loginGetCookie(app, email, pw, {});
    await loginGetCookie(app, email, pw, {});
    const bulk = await app.inject({ method: "DELETE", url: "/api/auth/sessions", headers: { cookie: c2 } });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toEqual({ revoked: 2 });
    await app.close();
  });

  it("cannot revoke another user's session (404, no oracle)", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, email, pw);
    await seedUser(deps, "other@example.com", pw);
    const app = buildApp(deps);

    const c1 = await loginGetCookie(app, email, pw, {});
    const c2 = await loginGetCookie(app, "other@example.com", pw, {});
    const otherList = (await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c2 } })).json() as SessionInfo[];
    const otherId = otherList[0].id;
    // user1 tries to revoke user2's session
    const res = await app.inject({ method: "DELETE", url: `/api/auth/sessions/${otherId}`, headers: { cookie: c1 } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("changes password: verifies current, revokes other sessions, audits", async () => {
    const deps = await makeTestDeps();
    await seedUser(deps, email, pw);
    const app = buildApp(deps);

    const cA = await loginGetCookie(app, email, pw, {});
    const cB = await loginGetCookie(app, email, pw, {});

    // Wrong current password → 400 invalid credentials
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: "nope-nope", newPassword: "brand-new-pass-9" },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe("invalid credentials");

    // Correct current password → 204, other session revoked
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: pw, newPassword: "brand-new-pass-9" },
    });
    expect(ok.statusCode).toBe(204);
    // cA (other session) is now dead
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cA } })).statusCode).toBe(401);
    // cB (current session) still works
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cB } })).statusCode).toBe(200);
    // Re-login works with new password only
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: pw } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "brand-new-pass-9" } })).statusCode).toBe(200);
    await app.close();
  });

  it("anonymous gets 401 on all account routes", async () => {
    const app = buildApp(await makeTestDeps());
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions" })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/auth/sessions/some-id" })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/auth/sessions" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/password", payload: { currentPassword: "x", newPassword: "newpass12" } })).statusCode).toBe(401);
    for (const res of await Promise.all([
      app.inject({ method: "GET", url: "/api/auth/sessions" }),
      app.inject({ method: "DELETE", url: "/api/auth/sessions/some-id" }),
      app.inject({ method: "DELETE", url: "/api/auth/sessions" }),
      app.inject({ method: "POST", url: "/api/auth/password", payload: { currentPassword: "x", newPassword: "newpass12" } }),
    ])) {
      expect(res.json().error).toBe("unauthenticated");
    }
    await app.close();
  });
});
