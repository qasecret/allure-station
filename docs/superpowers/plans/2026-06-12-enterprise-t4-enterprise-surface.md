# Enterprise T4: Enterprise Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-service account security (password change, visible/revocable sessions), expiring API tokens, honest 401/403 semantics, and operator branding.

**Architecture:** Per `docs/superpowers/specs/2026-06-12-enterprise-t4-enterprise-surface-design.md` (read it first). Server-first: the 401/403 split lands before the new endpoints so they are born with correct semantics; then sessions/account routes, token expiry, branding config; then the web Account page, token-expiry UI, and branding consumption. **Two schema changes** (sessions +userAgent/+ip, api_tokens +expiresAt) → migrations for BOTH dialects + PG conformance runs.

**Tech Stack:** Fastify + drizzle dual-dialect, zod contracts in `@allure-station/shared`, React 18 + TanStack Query, T3 conventions (TimeStamp, QueryErrorState, skeletons, humanizeError), Playwright e2e (open + authed projects).

**Verification commands:**
```bash
pnpm --filter @allure-station/server test src/routes/<file>.test.ts
pnpm test && pnpm typecheck
docker compose -f docker/docker-compose.test.yml up -d postgres
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
rm -rf packages/e2e/.e2e-data packages/e2e/.e2e-data-authed && pnpm --filter @allure-station/e2e test:e2e
```

**Key existing code facts (verified):**
- `auth.ts`: `authorizeProjectWrite/Owner/Create` + `requireAdmin` return `"ok" | "unauthorized"`; `requireProjectWrite/Owner(deps, req, projectId)` wrap authenticate+authorize; `authenticate()` maps invalid bearer → `anonymous`; `SESSION_COOKIE = "as_session"`; `hashSessionToken`, `generateSessionToken` exported.
- `routes/auth.ts`: login sets cookie (`maxAge: sessionTtlMs/1000`, path "/"), computes `expiresAt = now + deps.sessionTtlMs`, creates session via `deps.sessions.create(tokenHash, userId, now, expiresAt)`; logout `removeByHash` + clearCookie; `GET /auth/me` returns user or `200 null`.
- `db/session-repo.ts` `SessionRepository`: `create`, `findByHash`, `removeByHash`, `deleteExpired`.
- `db/schema.sqlite.ts:67-76` sessions table (id, tokenHash, userId→cascade, createdAt, expiresAt; unique idx_sessions_hash, idx_sessions_user). `schema.pg.ts` mirrors. api_tokens has `createdAt`, `lastUsedAt`, NO expiry.
- `password.ts`: `hashPassword(pw)`, `verifyPassword(pw, stored)` (scrypt).
- `routes/tokens.ts`: create validates `createTokenRequestSchema`, 401s via `authorizeProjectWrite === "unauthorized"`; audits token_created/deleted.
- `routes/meta.ts` `GET /config` returns `{ securityEnabled, oidc, allure }`.
- `config.ts`: `AppConfig` interface + `loadConfig(env)`; `sessionTtlMs` pattern at line ~141.
- `contracts.ts`: `auditActionSchema` z.enum at ~311 (17 actions); web `lib/audit-format.ts` `DESCRIBERS` is enum-complete-tested.
- Web: `Login.tsx` hardcodes "Allure Station" ×3 + tagline (lines ~40-50); `Sidebar.tsx:15-17` wordmark; `index.html` title; `UserMenu.tsx` has Sign out item (~70); `getConfig()` in api/client.ts. T3 primitives: `TimeStamp`, `QueryErrorState`, `CardSkeleton/TableSkeleton`, `humanizeError`, `errors.ts` 401-bridge copy (to delete), `docs/FUTURE-WORK.md` 401/403 entry (to delete).
- e2e: authed project (:5098, env block in playwright.config.ts), `login()` helper in authed.spec.ts, unique-email pattern for un-wiped re-runs.

---

### Task 1: 401/403 split (server + client copy)

**Files:**
- Modify: `packages/server/src/auth.ts` (verdict type + helpers + a reply helper)
- Modify: every route using the helpers — `routes/{tokens,projects,members,users,audit,notifications,results,quality-gate,runs}.ts` (grep `"unauthorized"`)
- Modify: their co-located `*.test.ts` (~27 `toBe(401)` assertions split per case)
- Modify: `packages/server/src/openapi/registry.ts` (only if error codes are declared per-route — read it; add 403 where 401 was declared for role-gated routes)
- Modify: `packages/web/src/lib/errors.ts` + `errors.test.ts`
- Delete entry: `docs/FUTURE-WORK.md` (the "Auth: split 401/403" section)

- [ ] **Step 1: Failing server tests** — pick three representative cases and ADD them (the existing 27 get updated in Step 3): in `routes/users.test.ts` style files:

```ts
it("splits 401 (anonymous) from 403 (insufficient role)", async () => {
  // anonymous on an admin route → 401 unauthenticated
  const anon = await app.inject({ method: "GET", url: "/api/users" });
  expect(anon.statusCode).toBe(401);
  expect(anon.json().error).toBe("unauthenticated");
  // signed-in non-admin → 403 forbidden
  const viewer = await loginAs(app, "viewer@example.com"); // reuse the file's session helper
  const res = await app.inject({ method: "GET", url: "/api/users", headers: viewer });
  expect(res.statusCode).toBe(403);
  expect(res.json().error).toBe("forbidden");
});
it("invalid bearer token stays 401 (no oracle)", async () => {
  const res = await app.inject({ method: "POST", url: "/api/projects/p/generate", headers: { authorization: "Bearer ast_bogus" } });
  expect([401, 404]).toContain(res.statusCode); // 401 unauthenticated, never 403
  if (res.statusCode === 401) expect(res.json().error).toBe("unauthenticated");
});
```
(Adapt seeding/helpers per file — read each test file's existing fixtures.)

- [ ] **Step 2: auth.ts** — new verdict type and helper:

```ts
/** Authorization verdict: distinguish "who are you?" (401) from "you may not" (403).
 *  Anonymous principals (including invalid/expired bearer tokens, which authenticate()
 *  resolves to anonymous — deliberate no-oracle) → unauthenticated. A known principal
 *  (session user or valid token) with insufficient role/scope → forbidden. */
export type AuthzVerdict = "ok" | "unauthenticated" | "forbidden";

/** Map a non-ok verdict onto the HTTP reply. Usage: if (v !== "ok") return denyAuth(reply, v); */
export function denyAuth(reply: FastifyReply, verdict: Exclude<AuthzVerdict, "ok">) {
  return verdict === "unauthenticated"
    ? reply.code(401).send({ error: "unauthenticated" })
    : reply.code(403).send({ error: "forbidden" });
}
```
Change the four authorize helpers' failure returns: `anonymous` branches → `"unauthenticated"`; `user`/`token` insufficient branches → `"forbidden"`. Exact mapping:
- `authorizeProjectWrite`: user non-admin below maintainer → `forbidden`; token wrong project → `forbidden`; anonymous (accounts exist or project has tokens) → `unauthenticated`.
- `authorizeProjectOwner`: `principal.kind !== "user"` → token? `forbidden` : `unauthenticated` (split the check); user below owner → `forbidden`.
- `authorizeProjectCreate`: user non-admin → `forbidden`; token → `forbidden`; anonymous with accounts → `unauthenticated`.
- `requireAdmin`: anonymous → `unauthenticated`; otherwise non-admin → `forbidden`.
`requireProjectWrite/Owner` return types follow. Import `FastifyReply`.

- [ ] **Step 3: Route sweep** — every `if ((await …) === "unauthorized") return reply.code(401).send({ error: "unauthorized" })` becomes:

```ts
    const verdict = await authorizeProjectWrite(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
```
Grep `error: "unauthorized"` under packages/server/src — ZERO remain. Update all affected test assertions: anonymous cases keep 401 (body `"unauthenticated"`), signed-in-insufficient cases become 403 `"forbidden"`, token-wrong-project cases become 403. Read each failing test to classify; run per-file until green.

- [ ] **Step 4: OpenAPI** — read `openapi/registry.ts`; if route declarations enumerate error responses, add 403 alongside 401 on role-gated routes (drift test will confirm coverage either way).

- [ ] **Step 5: Client copy** — `packages/web/src/lib/errors.ts`: replace the 401 block with:

```ts
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return "You don't have permission to do that — ask an owner for access.";
```
(The "unauthorized"-body special case and its comment are deleted — the server now disambiguates.) Update `errors.test.ts` (the 401-"unauthorized" case now expects session-expired; add a 403 case). Delete the `## Auth: split 401/403 on write routes` section from `docs/FUTURE-WORK.md`.

- [ ] **Step 6: Gates + commit** — `pnpm test && pnpm typecheck` (server + web). Full wiped e2e (11/11; the triage error-leg asserts 404 copy — unaffected).
`git add -A && git commit -m "feat(server)!: split 401 unauthenticated from 403 forbidden; tighten client copy"`

---

### Task 2: Sessions schema + repository (both dialects)

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts` + `schema.pg.ts` (sessions +userAgent +ip)
- Generate: one migration per dialect (`db:generate:sqlite` / `db:generate:pg`)
- Modify: `packages/server/src/db/session-repo.ts` (+ conformance tests in `db/repositories.test.ts`)

- [ ] **Step 1: Failing conformance tests** — append to the repositories suite (runs on sqlite always, pg when PG_TEST_URL set — follow the file's existing setup):

```ts
it("sessions: stores device info, lists by user newest-first, revokes by id (user-scoped), revokes all-except", async () => {
  const u1 = await users.create("a@x.com", "hash", "user", now());
  const u2 = await users.create("b@x.com", "hash", "user", now());
  const s1 = await sessions.create("h1", u1.id, "2026-06-12T01:00:00.000Z", future, { userAgent: "UA1", ip: "10.0.0.1" });
  const s2 = await sessions.create("h2", u1.id, "2026-06-12T02:00:00.000Z", future, { userAgent: "UA2", ip: null });
  const s3 = await sessions.create("h3", u2.id, "2026-06-12T03:00:00.000Z", future, {});
  const list = await sessions.listByUser(u1.id);
  expect(list.map((s) => s.id)).toEqual([s2.id, s1.id]);          // newest first, own only
  expect(list[1]).toMatchObject({ userAgent: "UA1", ip: "10.0.0.1" });
  expect(await sessions.removeById(s3.id, u1.id)).toBe(false);    // cannot revoke another user's
  expect(await sessions.removeById(s1.id, u1.id)).toBe(true);
  expect(await sessions.removeAllExcept(u1.id, s2.id)).toBe(0);   // only s2 left → nothing revoked
  await sessions.create("h4", u1.id, now(), future, {});
  expect(await sessions.removeAllExcept(u1.id, s2.id)).toBe(1);
});
```
(Adapt `users.create` signature and `now()/future` to the file's fixtures.)

- [ ] **Step 2: Schema both dialects** — add to the sessions table in BOTH files: `userAgent: text("user_agent"),` and `ip: text("ip"),` (nullable). Regenerate:
```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```

- [ ] **Step 3: Repository** — `session-repo.ts`: `create` gains a 5th param `meta: { userAgent?: string | null; ip?: string | null }` (existing callers updated in this task — only routes/auth.ts login + oidc callback; pass `{}` there for now, Task 3 wires real values); add:

```ts
  /** All sessions for a user, newest first. Caller decides what's "current" by hash. */
  async listByUser(userId: string): Promise<SessionRow[]> {
    return this.db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt), desc(sessions.id));
  }
  /** Delete one session by id, scoped to the owning user (revoking others' is a silent no-op → 404 upstream). */
  async removeById(id: string, userId: string): Promise<boolean> {
    const rows = await this.db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId))).returning({ id: sessions.id });
    return rows.length > 0;
  }
  /** Delete all of a user's sessions except the given one. Returns the revoked count. */
  async removeAllExcept(userId: string, keepId: string): Promise<number> {
    const rows = await this.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepId))).returning({ id: sessions.id });
    return rows.length;
  }
```
(Imports: and, ne, desc from drizzle-orm. `findByHash` must now also return the new columns + id — verify the row type.)

- [ ] **Step 4: Both-dialect gates** — sqlite suite + fresh-pg conformance (docker `down -v` first so the new migration applies from scratch), `pnpm test && pnpm typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(server): session device info (user-agent, ip) + list/revoke repository ops (both dialects)"`

---

### Task 3: Account & session routes + audit actions

**Files:**
- Modify: `packages/shared/src/contracts.ts` (sessionInfoSchema, changePasswordRequestSchema, +2 audit actions)
- Modify: `packages/server/src/routes/auth.ts` (capture ua/ip at login; new routes)
- Modify: `packages/web/src/lib/audit-format.ts` (+2 describers; enum-complete test forces this)
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/auth.test.ts` (append)

- [ ] **Step 1: Failing route tests** (reuse the file's login/session helpers):

```ts
describe("account & sessions", () => {
  it("lists own sessions with device info and current flag", async () => {
    // login twice with different user-agent headers → two sessions
    const c1 = await loginGetCookie(app, email, pw, { "user-agent": "AgentOne/1.0" });
    const c2 = await loginGetCookie(app, email, pw, { "user-agent": "AgentTwo/2.0" });
    const res = await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c2 } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string; userAgent: string | null; current: boolean }>;
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.find((s) => s.current)?.userAgent).toBe("AgentTwo/2.0");
  });
  it("revokes a single session (own only) and all-others", async () => {
    const c1 = await loginGetCookie(app, email, pw, {});
    const c2 = await loginGetCookie(app, email, pw, {});
    const list = (await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c2 } })).json();
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await app.inject({ method: "DELETE", url: `/api/auth/sessions/${other.id}`, headers: { cookie: c2 } })).statusCode).toBe(204);
    // c1 is now dead:
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: c1 } })).statusCode).toBe(401);
    // bulk: log in twice more, then revoke-all-others
    await loginGetCookie(app, email, pw, {}); await loginGetCookie(app, email, pw, {});
    const bulk = await app.inject({ method: "DELETE", url: "/api/auth/sessions", headers: { cookie: c2 } });
    expect(bulk.json()).toEqual({ revoked: 2 });
  });
  it("cannot revoke another user's session (404, no oracle)", async () => { /* seed 2nd user, attempt cross-revoke, expect 404 */ });
  it("changes password: verifies current, revokes other sessions, audits", async () => {
    const cA = await loginGetCookie(app, email, pw, {});
    const cB = await loginGetCookie(app, email, pw, {});
    const wrong = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: cB }, payload: { currentPassword: "nope-nope", newPassword: "brand-new-pass-9" } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe("invalid credentials");
    const ok = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: cB }, payload: { currentPassword: pw, newPassword: "brand-new-pass-9" } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cA } })).statusCode).toBe(401); // other session revoked
    expect((await app.inject({ method: "GET", url: "/api/auth/sessions", headers: { cookie: cB } })).statusCode).toBe(200); // current survives
    // re-login works with the new password only
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: pw } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "brand-new-pass-9" } })).statusCode).toBe(200);
  });
  it("anonymous gets 401 on all account routes", async () => { /* GET/DELETE sessions + POST password without cookie → 401 unauthenticated */ });
});
```
(`loginGetCookie` may not exist — build on the file's existing login-test pattern; headers param threads user-agent.)

- [ ] **Step 2: Contracts** — `contracts.ts`:

```ts
export const sessionInfoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
```
`auditActionSchema` enum gains `"password_changed"` and `"session_revoked"`.

- [ ] **Step 3: Routes** — in `routes/auth.ts` (inside `registerAuthRoutes`):
  - Login (and the OIDC callback session creation): pass `{ userAgent: req.headers["user-agent"] ?? null, ip: req.ip ?? null }` into `deps.sessions.create`.
  - New handlers (all start with `const principal = await authenticate(deps, req); if (principal.kind !== "user") return denyAuth(reply, "unauthenticated");` — tokens cannot manage sessions, but a token principal here is effectively unauthenticated for account purposes; keep it simple: non-user → 401):

```ts
  app.get("/auth/sessions", async (req, reply) => {
    /* auth gate as above */
    const currentHash = hashSessionToken(req.cookies[SESSION_COOKIE]!);
    const rows = await deps.sessions.listByUser(principal.userId);
    return rows.map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, userAgent: s.userAgent, ip: s.ip, current: s.tokenHash === currentHash }));
  });

  app.delete("/auth/sessions/:id", async (req, reply) => {
    /* auth gate */
    const { id } = req.params as { id: string };
    const currentHash = hashSessionToken(req.cookies[SESSION_COOKIE]!);
    const rows = await deps.sessions.listByUser(principal.userId);
    const target = rows.find((s) => s.id === id);
    if (!target) return reply.code(404).send({ error: "not found" });   // others' sessions look identical
    await deps.sessions.removeById(id, principal.userId);
    if (target.tokenHash === currentHash) reply.clearCookie(SESSION_COOKIE, { path: "/" }); // revoking self ≡ logout
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "session_revoked", targetType: "session", targetId: id, metadata: { userAgent: target.userAgent, ip: target.ip } });
    return reply.code(204).send();
  });

  app.delete("/auth/sessions", async (req, reply) => {
    /* auth gate */
    const currentHash = hashSessionToken(req.cookies[SESSION_COOKIE]!);
    const current = (await deps.sessions.listByUser(principal.userId)).find((s) => s.tokenHash === currentHash);
    if (!current) return reply.code(401).send({ error: "unauthenticated" }); // race: current session just expired
    const revoked = await deps.sessions.removeAllExcept(principal.userId, current.id);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "session_revoked", targetType: "session", targetId: "all-others", metadata: { revoked } });
    return { revoked };
  });

  app.post("/auth/password", async (req, reply) => {
    /* auth gate */
    const parsed = changePasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const user = await deps.users.findById(principal.userId);
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(400).send({ error: "invalid credentials" }); // 400 not 401: the SESSION is valid
    }
    await deps.users.setPasswordHash(principal.userId, await hashPassword(parsed.data.newPassword));
    const currentHash = hashSessionToken(req.cookies[SESSION_COOKIE]!);
    const current = (await deps.sessions.listByUser(principal.userId)).find((s) => s.tokenHash === currentHash);
    if (current) await deps.sessions.removeAllExcept(principal.userId, current.id);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "password_changed", targetType: "user", targetId: principal.userId });
    return reply.code(204).send();
  });
```
ADAPT: OIDC users have a placeholder/absent password hash — check how OIDC provisioning stores `passwordHash` (read the callback/user creation); if OIDC-only users can't verify a current password, return the same `400 invalid credentials` (they must use SSO; note in the route comment). `deps.users.setPasswordHash` may not exist — add it to the user repo (one UPDATE, both-dialect-safe via drizzle).

- [ ] **Step 4: Audit describers** — `packages/web/src/lib/audit-format.ts` DESCRIBERS gains:

```ts
  password_changed: (e) => `${e.actorLabel} changed their password`,
  session_revoked: (e) =>
    e.targetId === "all-others"
      ? `${e.actorLabel} signed out all other sessions${typeof e.metadata?.revoked === "number" ? ` (${e.metadata.revoked})` : ""}`
      : `${e.actorLabel} revoked a session`,
```
(The enum-complete unit test fails until both exist — that's the TDD signal for this step.)

- [ ] **Step 5: OpenAPI** — declare GET/DELETE(/:id)/DELETE `/api/auth/sessions` + POST `/api/auth/password` (tag auth; response schemas from contracts; drift test enforces).

- [ ] **Step 6: Gates + commit** — server tests + web unit (audit-format) + `pnpm test && pnpm typecheck`.
`git commit -m "feat(server): account routes — session list/revoke, password change (revokes other sessions), audit actions"`

---

### Task 4: Token expiry (schema, create, enforcement)

**Files:**
- Modify: `packages/shared/src/contracts.ts` (createTokenRequestSchema +expiresInDays; apiTokenSchema +expiresAt)
- Modify: `packages/server/src/db/schema.sqlite.ts` + `schema.pg.ts` (api_tokens +expiresAt) + regenerate both migrations
- Modify: `packages/server/src/db/token-repo.ts` (or wherever ApiTokenRepository lives — create stores expiresAt; findByHash returns it)
- Modify: `packages/server/src/auth.ts` (authenticate rejects expired bearer)
- Modify: `packages/server/src/routes/tokens.ts`
- Test: `packages/server/src/routes/tokens.test.ts` (append) + conformance case

- [ ] **Step 1: Failing tests:**

```ts
describe("token expiry", () => {
  it("creates with expiresInDays and lists expiresAt; rejects invalid values", async () => {
    const res = await createToken(app, projectId, { name: "ci", expiresInDays: 30 });
    expect(res.statusCode).toBe(201);
    const days = (Date.parse(res.json().expiresAt) - Date.parse(NOW)) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
    expect((await createToken(app, projectId, { name: "x", expiresInDays: 7 })).statusCode).toBe(400);  // not in {30,90,365}
    const never = await createToken(app, projectId, { name: "legacy" });
    expect(never.json().expiresAt).toBeNull();
  });
  it("expired token is rejected exactly like an invalid one (401 unauthenticated)", async () => {
    const tok = (await createToken(app, projectId, { name: "t", expiresInDays: 30 })).json().token;
    advanceClock(31 * 86_400_000); // the test deps' now() is injectable — use the suite's clock pattern
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/generate`, headers: { authorization: `Bearer ${tok}` }, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthenticated");
  });
  it("boundary: expiresAt === now is expired", async () => { /* advance exactly to expiry, assert 401 */ });
});
```
(READ the test-helpers' clock: `makeTestDeps` exposes a controllable `now` — find the pattern; if `now` is fixed, build deps with a mutable now fn.)

- [ ] **Step 2: Contracts** — `createTokenRequestSchema` gains `expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional()`; the token response/list schema gains `expiresAt: z.string().nullable()`.

- [ ] **Step 3: Schema + migrations both dialects** — `expiresAt: text("expires_at"),` on api_tokens in both files; `db:generate:sqlite` + `db:generate:pg`.

- [ ] **Step 4: Repo + auth + route** — token repo `create(..., expiresAt: string | null)`; route computes `const expiresAt = parsed.data.expiresInDays ? new Date(Date.parse(deps.now()) + parsed.data.expiresInDays * 86_400_000).toISOString() : null;`. In `auth.ts` `authenticate()`:

```ts
    const token = await deps.tokens.findByHash(hashToken(bearer));
    if (token && (token.expiresAt === null || token.expiresAt > deps.now())) {
      void deps.tokens.touchLastUsed(token.id, deps.now()).catch(() => {});
      return { kind: "token", projectId: token.projectId, tokenId: token.id };
    }
```
(Expired → falls through to anonymous → 401 unauthenticated, identical to invalid. `>` not `>=`: expiresAt === now is expired.)

- [ ] **Step 5: Both-dialect gates + commit** — sqlite + fresh-pg conformance (`down -v`), full `pnpm test && pnpm typecheck`, OpenAPI updated for the create request/response.
`git commit -m "feat(server): optional API token expiry (30/90/365d) — expired ≡ invalid, both dialects"`

---

### Task 5: Branding config

**Files:**
- Modify: `packages/server/src/config.ts`, `packages/server/src/deps.ts` (or wherever AppDeps carries config values — read how `sessionTtlMs` flows), `packages/server/src/routes/meta.ts`
- Modify: `packages/shared/src/contracts.ts` (app config schema if one exists — grep; else the web types)
- Modify: `README.md` (env table)
- Test: `packages/server/src/routes/meta.test.ts` (append or create following siblings)

- [ ] **Step 1: Failing test:**

```ts
it("serves branding with zero-config defaults and env overrides", async () => {
  const deps = await makeTestDeps();
  const app = buildApp(deps);
  const res = await app.inject({ method: "GET", url: "/api/config" });
  expect(res.json().branding).toEqual({ name: "Allure Station", tagline: "Your test reports, beautifully hosted.", logoUrl: null });
  await app.close();
  const deps2 = await makeTestDeps({ branding: { name: "Acme QA", tagline: "Ship it.", logoUrl: "https://cdn.acme/logo.svg" } });
  const app2 = buildApp(deps2);
  expect((await app2.inject({ method: "GET", url: "/api/config" })).json().branding.name).toBe("Acme QA");
  await app2.close();
});
```
(`makeTestDeps` override mechanics — read the helper; thread branding the same way sessionTtlMs/version are threaded.)

- [ ] **Step 2: Implement** — `config.ts` `AppConfig` gains `branding: { name: string; tagline: string; logoUrl: string | null }`; `loadConfig`: `name: env.BRAND_NAME ?? "Allure Station"`, `tagline: env.BRAND_TAGLINE ?? "Your test reports, beautifully hosted."`, `logoUrl: env.BRAND_LOGO_URL ?? null`. Thread through deps to `meta.ts` `GET /config` → `branding: deps.branding`. README env table rows for the three vars (+ a `trustProxy`/`x-forwarded-for` note next to the session-IP feature). OpenAPI config-response schema updated if declared.

- [ ] **Step 3: Gates + commit** — `git commit -m "feat(server): white-label branding via BRAND_NAME/TAGLINE/LOGO_URL in /api/config"`

---

### Task 6: Web — Account page

**Files:**
- Create: `packages/web/src/pages/Account.tsx`, `packages/web/src/lib/user-agent.ts` (+ `user-agent.test.ts`)
- Modify: `packages/web/src/api/client.ts` (4 methods), `packages/web/src/main.tsx` (route), `packages/web/src/components/UserMenu.tsx` (link)

- [ ] **Step 1: Failing parser tests** — `lib/user-agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome · macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox · Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome · Linux"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari · macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Safari · iOS"],
    ["curl/8.4.0", "Unknown device"],
  ])("parses %s", (ua, expected) => expect(describeUserAgent(ua)).toBe(expected));
  it("null/empty → Unknown device", () => {
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("")).toBe("Unknown device");
  });
});
```

- [ ] **Step 2: Implement parser** — `lib/user-agent.ts`:

```ts
/** Tiny UA → "Browser · OS" summary for the sessions list. Deliberately coarse — no dependency,
 *  ordered checks (Edge/Chrome overlap, Safari claims everything WebKit). */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /edg\//i.test(ua) ? "Edge"
    : /firefox\//i.test(ua) ? "Firefox"
    : /chrome\//i.test(ua) ? "Chrome"
    : /safari\//i.test(ua) && /version\//i.test(ua) ? "Safari"
    : null;
  const os = /iphone|ipad|ios/i.test(ua) ? "iOS"
    : /android/i.test(ua) ? "Android"
    : /mac os x|macintosh/i.test(ua) ? "macOS"
    : /windows/i.test(ua) ? "Windows"
    : /linux|x11/i.test(ua) ? "Linux"
    : null;
  if (!browser && !os) return "Unknown device";
  return [browser ?? "Browser", os ?? "Unknown OS"].join(" · ");
}
```
(Order: iOS before macOS — iPhone UAs contain "like Mac OS X".)

- [ ] **Step 3: Client methods** — `api/client.ts` interface + impl:

```ts
  listSessions(): Promise<SessionInfo[]>;                              // GET /auth/sessions
  revokeSession(id: string): Promise<void>;                            // DELETE /auth/sessions/:id (noContent)
  revokeOtherSessions(): Promise<{ revoked: number }>;                 // DELETE /auth/sessions
  changePassword(body: { currentPassword: string; newPassword: string }): Promise<void>; // POST /auth/password (noContent)
```

- [ ] **Step 4: Page** — `pages/Account.tsx` (route `/account` added inside the AppShell group in main.tsx; UserMenu gains `<DropdownMenuItem asChild><Link to="/account"><Settings className="size-4" /> Account settings</Link></DropdownMenuItem>` above Sign out). Page = Topbar title="Account" + three Cards (T3 conventions throughout — CardSkeleton while auth loads, QueryErrorState on sessions failure, TimeStamp for dates):
  - **Profile**: email + role from `useAuth()`.
  - **Password**: three inputs (labels "Current password" / "New password" / "Confirm new password", `type="password"`, `autocomplete` current-password/new-password); client checks: new ≥8 chars, confirm matches (inline `role="alert"` errors, T3 style); submit mutation → on 400 `invalid credentials` show inline "Current password is incorrect." (check `e instanceof ApiError && e.status === 400 && e.serverMessage.includes("invalid credentials")`), other errors `humanizeError`; success → clear fields + `toast.success("Password changed — other sessions were signed out.")`.
  - **Sessions**: `useQuery(["sessions"], api.listSessions)`; rows: `describeUserAgent(s.userAgent)` + (s.ip ?? "") + `<TimeStamp iso={s.createdAt} />` + "Current" Badge; per-row Revoke button (current row's says "Sign out", goes through the existing logout-style confirm if any) → invalidate; header button "Sign out everywhere else" (disabled when only one session) → `toast.success(\`Signed out ${n} other session${n === 1 ? "" : "s"}.\`)`. Revoking CURRENT session → after 204, navigate to /login (cookie was cleared).

- [ ] **Step 5: Gates + commit** — web unit + typecheck + e2e smoke/authed quick run.
`git commit -m "feat(web): account page — profile, password change, session list/revoke"`

---

### Task 7: Web — token expiry UI + branding consumption

**Files:**
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (TokensCard)
- Modify: `packages/web/src/pages/Login.tsx`, `packages/web/src/components/Sidebar.tsx`, `packages/web/src/components/AppShell.tsx` or main.tsx (document.title)
- Test: extend an existing web unit file for the badge logic if extracted (keep logic in a small pure fn `tokenExpiryStatus(expiresAt, now): { label: string; tone: "muted" | "warn" | "expired" }` in `lib/format.ts` + tests)

- [ ] **Step 1: Failing tests** — append to `lib/format.test.ts`:

```ts
describe("tokenExpiryStatus", () => {
  const now = Date.parse("2026-06-12T00:00:00.000Z");
  it("never / far / soon / expired", () => {
    expect(tokenExpiryStatus(null, now)).toEqual({ label: "never expires", tone: "muted" });
    expect(tokenExpiryStatus("2026-09-12T00:00:00.000Z", now).tone).toBe("muted");
    expect(tokenExpiryStatus("2026-06-20T00:00:00.000Z", now)).toEqual({ label: "expires in 8d", tone: "warn" });   // ≤14d
    expect(tokenExpiryStatus("2026-06-11T00:00:00.000Z", now)).toEqual({ label: "expired", tone: "expired" });
  });
});
```

- [ ] **Step 2: Implement** — `lib/format.ts`:

```ts
/** Token-expiry badge model. warn within 14 days; expiresAt <= now is expired. */
export function tokenExpiryStatus(expiresAt: string | null, now: number = Date.now()): { label: string; tone: "muted" | "warn" | "expired" } {
  if (!expiresAt) return { label: "never expires", tone: "muted" };
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return { label: "expired", tone: "expired" };
  const days = Math.ceil(ms / 86_400_000);
  return { label: `expires in ${days}d`, tone: days <= 14 ? "warn" : "muted" };
}
```
TokensCard: create form gains a Select (label "Expires", options: "90 days" default / "30 days" / "1 year" / "Never") mapping to `expiresInDays` 90/30/365/undefined; list gains an Expiry cell rendering the status — tone muted = plain `text-muted-foreground`, warn = `text-status-broken-text`, expired = `text-status-fail-text` Badge (color-not-alone: the label text carries the meaning).

- [ ] **Step 3: Branding** — the `["config"]` query exists; derive `const brand = config?.branding;`:
  - `Login.tsx`: wordmark text, `<h1>Sign in to {brand?.name ?? "Allure Station"}</h1>`, tagline `<h2>{brand?.tagline ?? …}</h2>`, logo `<img src={brand?.logoUrl ?? "/favicon.svg"} …>` (both logo spots).
  - `Sidebar.tsx`: wordmark span + aria-label use `brand?.name` (Sidebar needs the config query — `useQuery(["config"], …)` is cached, cheap).
  - `document.title`: one effect where config loads (AppShell or main-level component): `useEffect(() => { if (brand?.name) document.title = brand.name; }, [brand?.name]);`
  - Grep rendered-UI literals: no `"Allure Station"` remains in src/ JSX text (index.html static title stays as fallback).

- [ ] **Step 4: Gates + commit** — web unit + typecheck + full wiped e2e (11/11 — the a11y login scan must stay green with the dynamic h1).
`git commit -m "feat(web): token expiry select + badges; white-label branding consumption"`

---

### Task 8: e2e + docs + final gates

**Files:**
- Modify: `packages/e2e/playwright.config.ts` (BRAND_NAME on the authed server env)
- Modify: `packages/e2e/tests/authed.spec.ts` (+account/password/branding legs)
- Modify: `packages/e2e/tests/ux-fixes.spec.ts` or wherever TokensCard is exercised — else add the expiry-select assertion to the authed/triage spec that touches settings
- Modify: `README.md`, `docs/user-guide/README.md`

- [ ] **Step 1: Authed server env** — add `BRAND_NAME: "Acme QA"` to the authed webServer env block (proves config plumbing end-to-end; the open server keeps defaults so existing specs are untouched).

- [ ] **Step 2: e2e legs** — extend `authed.spec.ts`:

```ts
test("account: sessions visible, password change works, branding applied", async ({ page }) => {
  // branded login (authed server has BRAND_NAME=Acme QA)
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in to Acme QA/ })).toBeVisible();
  // dedicated user so un-wiped re-runs stay green (never mutate the seeded admin)
  await login(page); // admin
  const email = `account-${Date.now()}@e2e.local`;
  await createUserViaUI(page, email, "first-pass-123"); // reuse/extract the existing add-user steps
  await logout(page);
  await loginAs(page, email, "first-pass-123");
  await page.goto("/account");
  await expect(page.getByText("Current", { exact: true })).toBeVisible();           // session list + current badge
  await expectNoSeriousViolations(page, "account");
  await page.getByLabel("Current password").fill("first-pass-123");
  await page.getByLabel("New password", { exact: true }).fill("second-pass-456");
  await page.getByLabel("Confirm new password").fill("second-pass-456");
  await page.getByRole("button", { name: /change password/i }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
  await logout(page);
  await loginAs(page, email, "second-pass-456");                                     // new password works
  await expect(page).toHaveURL("/");
});
```
(Extract `logout`/`loginAs`/`createUserViaUI` helpers from the existing spec body as needed; exact label strings must match Account.tsx/Users.tsx.) Token expiry: in the OPEN project's settings flow (or a small new leg in triage/authed): open a project's settings → Tokens card → assert the "Expires" select is visible with "90 days" default.

- [ ] **Step 3: Docs** — README: features (account/sessions/token expiry/branding), env table (`BRAND_NAME`, `BRAND_TAGLINE`, `BRAND_LOGO_URL`, trustProxy note for session IPs); user-guide: new "Your account" section (password change + sessions + sign-out-everywhere), token-expiry note in the tokens section, branding note in deployment section. MASTER.md: expiry badge tones under the status-token section (one line). Screenshots post-merge.

- [ ] **Step 4: Final gates**

```bash
pnpm test && pnpm typecheck
docker compose -f docker/docker-compose.test.yml down -v && docker compose -f docker/docker-compose.test.yml up -d postgres && sleep 3
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
rm -rf packages/e2e/.e2e-data packages/e2e/.e2e-data-authed && pnpm --filter @allure-station/e2e test:e2e   # 12/12 (11 + account leg)
pnpm --filter @allure-station/e2e test:e2e                                                                   # un-wiped re-run
```

- [ ] **Step 5: Commit** — `git commit -m "test(e2e)+docs: account/branding legs, T4 documentation"`

---

## Self-review notes (already applied)

- **Spec coverage:** §1 split → Task 1; §2 sessions/account → Tasks 2–3; §3 expiry+branding → Tasks 4–5; §4 web → Tasks 6–7; §5 testing/docs → per-task TDD + Task 8. Dropped scope (density/i18n) needs no tasks.
- **Judgment points explicitly left to the implementer:** test-suite clock control for expiry tests (Task 4 Step 1), OIDC-user password-hash shape (Task 3 Step 3), makeTestDeps branding threading (Task 5 Step 1), exact e2e helper extraction (Task 8 Step 2).
- **Type consistency:** `AuthzVerdict`/`denyAuth` (T1) used by T3 routes; `sessions.create(hash, userId, now, expiresAt, meta)` 5-arg shape consistent T2→T3; `SessionInfo` contract = route mapping = client return = Account page consumption; `expiresInDays ∈ {30,90,365}` matches the web Select values and tests; `tokenExpiryStatus` tones map to the T2-era status-text tokens.
- **Breaking-change note:** Task 1 changes error bodies (`unauthorized` → `unauthenticated`/`forbidden`) — the commit is marked `!` and the README API section should mention it (folded into Task 8 docs).
