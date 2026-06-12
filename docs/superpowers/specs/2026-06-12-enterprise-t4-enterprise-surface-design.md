# Enterprise upgrade, sub-project 4: Enterprise surface — design

**Date:** 2026-06-12 · **Status:** approved · **Owner:** Rabindra + Claude

Fourth and final sub-project (1 Reach & access ✅ · 2 Triage surfaces ✅ · 3 Polish & trust ✅ ·
**4 Enterprise surface**). Goal: the account-security and identity features an enterprise
evaluator checks for — self-service password change, visible/revocable sessions, expiring API
tokens, honest authorization semantics, and operator branding.

## Decisions made

| Decision | Choice |
|---|---|
| Scope | Core four: account/sessions, token expiry, white-label login, 401/403 split. **Density mode dropped** (tables already uniformly compact — nothing to toggle); **i18n deferred** (no demand; high-churn strings already centralized in `lib/errors.ts`/`lib/audit-format.ts`) |
| Sessions | Full: capture user-agent + IP at login, list own sessions, revoke single / all-others; password change revokes other sessions |
| Token expiry | Optional at creation — Never / 30 / 90 (default) / 365 days; expired ≡ invalid (same 401, no oracle); existing tokens stay perpetual |
| Branding | Env vars (`BRAND_NAME`, `BRAND_TAGLINE`, `BRAND_LOGO_URL`) with current branding as zero-config defaults, exposed via existing `GET /api/config` |
| Structure | One PR, server-first (the 401/403 split lands before the new endpoints so they are born with correct semantics), then web |

> Verified current state (survey 2026-06-12): `sessions(id, tokenHash, userId, createdAt, expiresAt)` —
> no device info, no list/revoke endpoints; `api_tokens(…, createdAt, lastUsedAt)` — no expiry;
> users have NO password-change path (admin create/delete only); all authz failures return
> `401 {"error":"unauthorized"}` (debt recorded in docs/FUTURE-WORK.md, ~27 route-test
> assertions); branding hardcoded in `Login.tsx` (~3 strings) + sidebar; `GET /api/config`
> already serves `securityEnabled`/`oidc` to the web.

## 1. Server — 401/403 split (first)

- Authorize helpers (`authorizeProjectWrite`, `authorizeProjectOwner`, `authorizeProjectCreate`,
  `requireAdmin` in `auth.ts`) return `"ok" | "unauthenticated" | "forbidden"` instead of
  `"ok" | "unauthorized"`: anonymous principal → **401 `{error:"unauthenticated"}`**; signed-in
  (or token) principal with insufficient role/scope → **403 `{error:"forbidden"}`**.
- Exception (no-oracle rule): invalid/expired/missing **bearer tokens** on write routes stay
  401 — a probing client cannot distinguish "bad token" from "no token".
- All route tests updated to assert the correct code per case (split the existing ~27
  `toBe(401)` assertions); OpenAPI error declarations updated where codes are declared.
- Web `lib/errors.ts`: 401 → "Your session has expired — sign in again." (now truthful),
  403 → "You don't have permission to do that — ask an owner for access." Delete the combined
  bridge copy and the `docs/FUTURE-WORK.md` entry.

## 2. Server — sessions & account

- **Schema** (both dialects + regenerated migrations): `sessions` gains `userAgent` (text,
  nullable) and `ip` (text, nullable), captured at login (`request.headers["user-agent"]`,
  Fastify `request.ip` — respects `trustProxy` when operators configure it; document in README).
- **Routes** (session-cookie auth required; all under the existing `/api/auth` scope):
  - `GET /auth/sessions` → own sessions: `{ id, createdAt, expiresAt, userAgent, ip, current }`
    (never tokenHash). Ordered newest-first.
  - `DELETE /auth/sessions/:id` → revoke one of YOUR sessions (404 for others' — no oracle);
    revoking the current session also clears the cookie (≡ logout).
  - `DELETE /auth/sessions` → revoke all EXCEPT current; returns `{ revoked: n }`.
  - `POST /auth/password` `{ currentPassword, newPassword }` → verifies current (401-style
    `{error:"invalid credentials"}` mirror of login, NOT the session-expired path), zod
    `min(8)` on new, rehashes, **revokes all other sessions**, audits.
- **Audit**: new actions `password_changed`, `session_revoked` (single + bulk) added to the
  shared `auditActionSchema` enum + `describeAuditEntry` sentences (the enum-complete unit test
  forces this) — logged with actorLabel; session metadata (ua/ip) included for revokes.
- **Contracts**: `sessionInfoSchema`, request/response schemas in `@allure-station/shared`;
  OpenAPI declarations for all four routes.

## 3. Server — token expiry + branding

- **Schema** (both dialects + migrations): `api_tokens.expiresAt` (text ISO, nullable; null =
  never). Existing tokens unaffected.
- **Create route**: optional `expiresInDays` ∈ {30, 90, 365} (zod-validated; absent/null =
  never). Server computes `expiresAt` from `deps.now()`. List route returns `expiresAt`.
- **Auth**: the bearer-token lookup rejects tokens with `expiresAt <= now` exactly like
  unknown tokens (same 401, no touchLastUsed). Boundary tested.
- **Branding**: `config.ts` gains `BRAND_NAME` (default "Allure Station"), `BRAND_TAGLINE`
  (default current login tagline), `BRAND_LOGO_URL` (default null → built-in logo). Exposed in
  `GET /api/config` as `branding: { name, tagline, logoUrl }`. README env table updated.

## 4. Web

- **Account page** — new route `/account` (inside AppShell), linked from UserMenu ("Account
  settings"). Three cards:
  - Profile: email + role (read-only).
  - Password: current/new/confirm fields (client zod mirror, 8+ chars, confirm match), submit
    → success toast "Password changed — other sessions were signed out."; wrong current
    password shows the login-style inline error, not session-expired.
  - Sessions: list via `GET /auth/sessions` — device line from a tiny pure `lib/user-agent.ts`
    parser ("Chrome · macOS", "Firefox · Linux", fallback "Unknown device" — no dependency,
    unit-tested), IP, created/expires via the existing `TimeStamp`, "Current" badge, per-row
    Revoke (confirm for current ≡ sign out), "Sign out everywhere else" button with revoked-count
    toast. Loading = `CardSkeleton`/`TableSkeleton`; errors = `QueryErrorState` (T3 conventions).
- **TokensCard** (`ProjectSettings.tsx`): create form gains an expiry Select (Never / 30 days /
  90 days (default) / 1 year); list gains an expiry column — "never", "in Xd" (amber badge when
  ≤14d), red "expired" badge. Uses shared `relativeTime`/`TimeStamp` conventions.
- **Branding consumption**: the config query already exists — `Login.tsx` h1/tagline/logo
  (`logoUrl` falls back to the built-in SVG), sidebar wordmark text, and `document.title`
  (`{brand.name}`) all read `config.branding`. No raw "Allure Station" literals remain in
  rendered UI (README/docs keep the product name).
- **errors.ts**: tightened 401/403 copy per §1.

## 5. Testing & docs

- **Server route tests**: password change (success revokes others — assert other session 401s
  afterward; wrong current → invalid-credentials error; weak new → 400 with field hint);
  sessions (list shows own only + current flag; A cannot revoke B's — 404; bulk revoke spares
  current); token expiry (expired token rejected on write exactly like invalid; boundary at
  `expiresAt === now`; create validates expiresInDays); branding config defaults + overrides;
  the 401/403 split across representative routes (anonymous vs viewer vs token cases).
- **PG conformance**: run the repositories suite against Postgres (two migrations are
  dialect-sensitive) via `docker/docker-compose.test.yml`.
- **Web unit**: `lib/user-agent.ts` parser table; expiry badge thresholds; password-form
  validation messages.
- **e2e** (authed project): account page renders profile + at least one session with Current
  badge → axe scan; password-change flow happy path on a DEDICATED user created for the leg
  (unique email per run, like the existing authed-spec pattern — never mutate the seeded
  admin, so un-wiped re-runs stay green): change password, sign out, re-login with the new
  one; branded login: set `BRAND_NAME` on the authed
  webServer env and assert the login h1 shows it (also implicitly proves /api/config plumbing).
  Open-project leg: token create with expiry select visible.
- **Docs**: README (env table: BRAND_*, trustProxy note; features: account/sessions/token
  expiry), user-guide new §Account + §15 token-expiry note, design-system MASTER.md only if new
  patterns emerge (expiry badge colors documented under status tokens). Screenshots post-merge
  (account page + branded login + tokens card).

## Out of scope (recorded, not planned)

Density mode (no baseline to compact); i18n scaffolding (revisit on demand — strings stay
centralized); admin-editable branding UI (env vars suffice for self-hosted); session geo-lookup;
2FA/passkeys (natural T5 if the arc continues); token-expiry proactive notifications.
