# Slice 5c — Audit Log

**Goal:** An append-only record of sensitive actions, attributed to the real identities
introduced in 5b, readable by admins (global) and project owners (per-project).

**Decision (locked w/ user):** audit log chosen as the next slice (over OIDC). Self-contained,
fully verifiable locally.

## Data model (both dialects)

```
audit_log(
  id pk, at,                       -- ISO timestamp
  actor_type,                      -- user | token | anonymous
  actor_id,                        -- userId / tokenId / null
  actor_label,                     -- email / token prefix / "anonymous" (denormalized for display)
  action,                          -- see enum below
  target_type,                     -- project | user | token | member | notification | quality_gate | session
  target_id,                       -- nullable
  project_id,                      -- nullable; set for project-scoped events so owners can filter
  metadata                         -- JSON string | null
)
indexes: (at) for global recent-first, (project_id, at) for per-project recent-first
```
Never cascade-deleted: an audit row outlives the project/user it references (that's the point).
So `ProjectRepository.remove` / `UserRepository.remove` do **not** touch audit_log; FK columns are
plain text (no FK constraint) so a delete event can reference an id that no longer exists.

## Actions recorded
`login`, `login_failed`, `logout`, `user_created`, `user_deleted`, `token_created`,
`token_deleted`, `member_set`, `member_removed`, `project_created`, `project_deleted`,
`quality_gate_set`, `notification_created`, `notification_deleted`.

Recording is **best-effort** (try/catch, never fails the primary action) and happens after the
mutation succeeds. `login_failed` carries the attempted email in metadata (admin-only view).

## Tasks
1. **Schema + migrations.** `audit_log` in schema.sqlite.ts + schema.pg.ts; generate (sqlite 0009,
   pg 0008). Eyeball SQL.
2. **Contract.** `auditActionSchema` enum, `auditEntrySchema` (+ types) in shared/contracts.ts.
3. **AuditRepository.** `record(entry)`, `list({projectId?, limit, offset})` recent-first,
   `count({projectId?})`. Wire into AppDeps/deps.ts/test-helpers.ts.
4. **audit.ts helper.** `actorFromPrincipal(principal) -> {type,id,label}`; `recordAudit(deps, {...})`
   best-effort. Instrument routes: auth (login/login_failed/logout), users, members, tokens,
   projects (create/delete), quality-gate, notifications.
5. **Read routes.** `GET /api/audit` (admin, global) + `GET /api/projects/:id/audit` (owner/admin),
   both paginated with `X-Total-Count` (reuse parsePage).
6. **Web.** Admin `Audit` page (table: time/actor/action/target) linked from TopBar; per-project
   audit panel deferred (admin page covers it via project_id filter — keep slice bounded).
7. **Tests.** Repo conformance (sqlite+pg, incl. NOT cascaded on project/user delete); audit route
   auth (admin global, owner per-project, others 401); recording assertions (login/login_failed,
   user_created, member_set, project_deleted survive the delete).
8. **Verify** (all pkgs + pg + live smoke) → code-review → fix → push → memory.

## Notes
- Best-effort recording means a dropped audit row is possible under DB failure — acceptable for v1;
  a write-ahead/transactional audit is a follow-up.
- `login_failed` recording is rate-unbounded (no login throttle yet) — could grow under brute force;
  the opportunistic nature + admin-only read make it acceptable; throttling is a separate follow-up.
