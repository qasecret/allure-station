import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import { hashSessionToken, generateSessionToken } from "../auth.js";
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
    // A password-seeded (local) account reports no SSO provider.
    expect(me.json().authProvider).toBeNull();

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { as_session: cookie.value } });
    expect(logout.statusCode).toBe(204);
    // Session row is gone → the same cookie no longer authenticates.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: { as_session: cookie.value } })).json()).toBeNull();
    await app.close();
  });

  it("me reports authProvider 'oidc' for SSO-provisioned users (so the UI can hide the password form)", async () => {
    const deps = await makeTestDeps();
    // Mirror OIDC provisioning: create with the "oidc" provider + an unusable random password.
    const user = await deps.users.create("sso@x.com", await hashPassword("unusable-placeholder"), "user", deps.now(), "oidc");
    const token = generateSessionToken();
    const expiresAt = new Date(Date.parse(deps.now()) + 3_600_000).toISOString();
    await deps.sessions.create(hashSessionToken(token), user.id, deps.now(), expiresAt);
    const app = buildApp(deps);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { as_session: token } });
    expect(me.json()).toMatchObject({ email: "sso@x.com", authProvider: "oidc" });
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
    // Extract just the token value of cB for later comparison
    const oldCBValue = cB.split("=")[1];

    // Wrong current password → 400 invalid credentials
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: "nope-nope", newPassword: "brand-new-pass-9" },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe("invalid credentials");

    // Weak new password (< 8 chars) → 400
    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: pw, newPassword: "short" },
    });
    expect(weak.statusCode).toBe(400);

    // Correct current password → 204, session rotated
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: pw, newPassword: "brand-new-pass-9" },
    });
    expect(ok.statusCode).toBe(204);
    // Response must carry a new set-cookie (rotated session)
    const newCookie = ok.cookies.find((c) => c.name === "as_session");
    expect(newCookie).toBeDefined();
    expect(newCookie!.value).not.toBe(oldCBValue); // fresh token — not the old one
    const newCookieHeader = `as_session=${newCookie!.value}`;

    // cA (other session) is now dead
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cA } })).statusCode).toBe(401);
    // OLD cB cookie is now dead too (session was rotated)
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cB } })).statusCode).toBe(401);
    // The NEW cookie from the password-change response works
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: newCookieHeader } })).statusCode).toBe(200);
    // Re-login works with new password only
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: pw } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "brand-new-pass-9" } })).statusCode).toBe(200);

    // Audit log must contain password_changed
    const auditEntries = await deps.audit.list({ limit: 100 });
    expect(auditEntries.map((e) => e.action)).toContain("password_changed");

    await app.close();
  });

  it("expired sessions are excluded from GET /auth/sessions list", async () => {
    // Fix #4: listByUser must filter out expired rows so they never appear in the account sessions list.
    let nowMs = Date.parse("2026-06-06T00:00:00.000Z");
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    await seedUser(deps, email, pw);
    const app = buildApp(deps);

    // Login at time T — produces a live session.
    const liveCookie = await loginGetCookie(app, email, pw, {});

    // Directly seed an expired session row (already expired when seeded).
    const expiredToken = generateSessionToken();
    const expiredHash = hashSessionToken(expiredToken);
    const user = await deps.users.findByEmail(email);
    await deps.sessions.create(expiredHash, user!.id, deps.now(), "2020-01-01T00:00:00.000Z"); // past

    // GET /auth/sessions must only return the live session, not the expired one.
    const res = await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: liveCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1); // expired row excluded

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

  it("password change: new cookie works, other sessions dead, password_changed audit row exists", async () => {
    // Fix #1: safe reorder — setPasswordHash → startSession (new session minted FIRST) →
    // removeAllExcept(userId, newSessionId) → audit. A failure after setPasswordHash still leaves
    // the caller with a working new session; other sessions cleaned on success.
    const deps = await makeTestDeps();
    await seedUser(deps, email, pw);
    const app = buildApp(deps);

    const cA = await loginGetCookie(app, email, pw, {});
    const cB = await loginGetCookie(app, email, pw, {});
    const newPassword = "super-new-pass-42";

    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cB },
      payload: { currentPassword: pw, newPassword },
    });
    expect(ok.statusCode).toBe(204);

    // The response must set a fresh session cookie.
    const newCookie = ok.cookies.find((c) => c.name === "as_session");
    expect(newCookie).toBeDefined();
    expect(newCookie!.value).not.toBe(cB.split("=")[1]);
    const newCookieHeader = `as_session=${newCookie!.value}`;

    // NEW cookie authenticates successfully.
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: newCookieHeader } })).statusCode).toBe(200);
    // OLD sessions (cA and cB) are dead.
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cA } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cB } })).statusCode).toBe(401);
    // A password_changed audit row exists.
    const auditActions = (await deps.audit.list({ limit: 100 })).map((e) => e.action);
    expect(auditActions).toContain("password_changed");

    await app.close();
  });

  it("OIDC-provisioned user (no usable local password) cannot change password: any currentPassword yields 400 invalid credentials", async () => {
    // Mirrors oidc.ts auto-provisioning: a random 32-byte hex string is hashed as the local password,
    // making the plaintext permanently unknowable. POST /auth/password must reject with 400.
    const deps = await makeTestDeps();
    const oidcEmail = "oidc-user@example.com";
    const randomPlaintext = randomBytes(32).toString("hex");
    await deps.users.create(oidcEmail, await hashPassword(randomPlaintext), "user", deps.now());
    const app = buildApp(deps);

    // Create a session directly (simulating a successful OIDC callback) rather than going via
    // /auth/login (which would require knowing the random plaintext password).
    const tokenPlaintext = generateSessionToken();
    const tokenHash = hashSessionToken(tokenPlaintext);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const user = await deps.users.findByEmail(oidcEmail);
    await deps.sessions.create(tokenHash, user!.id, deps.now(), expiresAt);
    const cookieHeader = `as_session=${tokenPlaintext}`;

    // Attempt password change with any currentPassword — must fail with 400 "invalid credentials"
    // because the local password hash was set from an unknown random value.
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: cookieHeader },
      payload: { currentPassword: "any-guess-12", newPassword: "brand-new-pass-9" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid credentials");

    await app.close();
  });
});
