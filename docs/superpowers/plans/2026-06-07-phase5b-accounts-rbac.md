# Slice 5b — Accounts + Sessions + Per-Project RBAC

**Goal:** Layer real user identities, cookie-based login, and per-project roles
(owner/maintainer/viewer) on top of the existing opt-in API-token model — without
breaking zero-config dev mode or public reads.

**Decisions (locked with user):**
- **Login:** local email + password (scrypt), httpOnly cookie sessions (DB-backed,
  session id hashed in DB like API tokens). OIDC is a later slice and will reuse this
  session machinery.
- **Reads stay public.** RBAC gates *writes + management + delete*. Per-project private
  visibility is an explicit follow-up (NOT this slice).
- **Bootstrap:** env-seeded admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), upserted on startup.
  No public self-registration — admins create users (invite-style).

## Authorization model

Two global roles: `admin` (manage users, create/delete any project, full power) and
`user` (powers come only from memberships). Per-project roles rank
`viewer(1) < maintainer(2) < owner(3)`.

Capability → requirement:
| Action | Requirement |
| --- | --- |
| reads (projects/runs/report/badge/compare/events) | public (unchanged) |
| send-results, generate, quality-gate set, notifications CRUD, token CRUD | maintainer+ **OR** project API token **OR** zero-config fallback |
| project delete | maintainer+ OR project token (unchanged from today) |
| member CRUD (`/projects/:id/members`) | **owner OR global admin** (session only; tokens never satisfy) |
| project create | global admin (when auth configured) OR zero-config fallback |
| user CRUD (`/users`) | global admin |

**Zero-config fallback (preserve today's behavior):** if *no users exist* AND the project
has *no tokens*, anonymous writes succeed. Once any user exists, the open-token fallback is
disabled for that path — closing the "token-less project is world-writable" hole that adding
accounts would otherwise leave.

`authenticate(deps, req)` resolves a `Principal`:
1. `as_session` cookie → hash → SessionRepository.findByHash → not expired → `{kind:"user", userId, email, role}`
2. else `Authorization: Bearer` → hashToken → ApiTokenRepository.findByHash → `{kind:"token", projectId, tokenId}`
3. else `{kind:"anonymous"}`

`authorizeProjectWrite(deps, principal, projectId)` and `authorizeProjectOwner(deps, principal, projectId)`
return `"ok" | "unauthorized"`. The legacy `authorizeProjectWrite(deps, projectId, header)` signature is
replaced; all call sites move to authenticate-then-authorize.

## Data model (both dialects)

```
users(id pk, email unique, password_hash, role, created_at)
sessions(id pk, token_hash unique, user_id -> users.id cascade, created_at, expires_at)
memberships(id pk, project_id -> projects.id cascade, user_id -> users.id cascade,
            role, created_at, unique(project_id,user_id))
```
libsql has no FK cascade → `UserRepository.remove` deletes sessions+memberships;
`ProjectRepository.remove` additionally deletes memberships.

## Tasks

1. **Schema + migrations.** Add tables to `schema.sqlite.ts` + `schema.pg.ts`. Generate
   `db:generate:sqlite` (→ 0008) and `db:generate:pg` (→ 0007). Eyeball both SQL files.
2. **Shared contracts** (`contracts.ts`): `globalRole`, `projectRole` enums; `user`,
   `sessionUser`, `createUserRequest` (email/password/role), `loginRequest`,
   `membership`, `membershipWithUser`, `setMembershipRequest`.
3. **Repos:** `user-repo.ts` (create/findByEmail/findById/list/remove/count), `session-repo.ts`
   (create/findByHash/remove/removeByUser/deleteExpired), `membership-repo.ts`
   (upsert/find/listByProject(join user)/listByUser/remove). Cascades wired.
4. **password.ts:** `hashPassword(pw)` → `scrypt$<saltHex>$<hashHex>`; `verifyPassword(pw, stored)`
   with `timingSafeEqual`. **auth.ts:** Principal type, `authenticate`, `authorizeProjectWrite`,
   `authorizeProjectOwner`, `requireAdmin`; keep `generateToken/hashToken/tokenPrefix`; add
   `generateSessionToken` (reuse 24-byte base64url) + `hashSessionToken` (= sha256).
5. **Wiring:** add `@fastify/cookie`; `AppDeps` gains `users/sessions/memberships`,
   `sessionTtlMs`, `cookieSecure`; `config.ts` adds `ADMIN_EMAIL/ADMIN_PASSWORD/SESSION_TTL_MS/COOKIE_SECURE`;
   `deps.ts` + `test-helpers.ts` construct the new repos; `runtime.ts` seeds the admin (upsert)
   after migrate; register `@fastify/cookie` in `app.ts`.
6. **Routes:** `routes/auth.ts` (POST login, POST logout, GET me), `routes/users.ts` (admin CRUD),
   `routes/members.ts` (owner/admin CRUD). Migrate `results/projects/quality-gate/notifications/tokens`
   to the new authenticate+authorize flow. `projects` create → admin-gated with zero-config fallback.
7. **Web:** `api/client.ts` auth + members + users calls (fetch same-origin sends cookie);
   `auth` context (me/login/logout) in `main.tsx`; `pages/Login.tsx`; header shows user + logout;
   `Members` panel on `pages/Project.tsx` (owner/admin); `pages/Users.tsx` admin view.
8. **Verify:** server unit (login/logout/me, RBAC matrix, zero-config preserved, seed),
   repositories vs Postgres, web, typecheck; live smoke (seed admin → login → create user →
   grant membership → maintainer can write, viewer cannot, anonymous still reads).
9. **Code-review** (high effort) → fix → push → memory.

## Risks / notes
- Cookie `Secure` must be derivable (COOKIE_SECURE or PUBLIC_URL https) so prod cookies aren't
  sent over http; default off for local http dev.
- Session fixation: issue a fresh session id on login; clear cookie on logout + delete row.
- Don't leak whether an email exists: login returns generic 401 on bad email or password.
- Expired-session cleanup is lazy (rejected on read) + a `deleteExpired` helper; a periodic
  sweeper is a follow-up, not this slice.
