# Slice 6b — Private / read-gated reports

**Goal:** Per-project visibility so confidential reports can be hidden from anonymous readers — the
likely enterprise adoption blocker (FUTURE-WORK gap #2).

**Decisions (locked w/ user):**
- **Public by default** — new projects stay public (back-compat + zero-config preserved); an
  owner/admin flips a project to `private`.
- **Badge stays public** even when private (leaks only aggregate pass/fail counts, so external README
  badges keep working). Everything else (project/runs/report/trends/compare/events/summary) is gated.

## Read-authorization model
A **private** project's reads require: global `admin`, a member with `viewer+`, or a **project API
token** scoped to it. Anonymous → denied. Unauthorized private reads return **404** (hide existence),
not 401. Public projects read by anyone (unchanged).

## Tasks
1. **Schema:** `projects.visibility` text NOT NULL default `'public'` (both dialects) + migration
   (sqlite 0011, pg 0010).
2. **Contracts:** `projectVisibilitySchema` (`public|private`); `projectSchema.visibility`;
   `setVisibilityRequest`; add `project_visibility_set` to `auditActionSchema`.
3. **ProjectRepository:** `create` defaults `visibility:'public'`; `get`/`#withLatest` return it;
   `setVisibility(id, v)`; `list`/`count` accept a **visibility filter** (admin=all, user=public ∪
   member, anon/token=public-only) so private projects don't leak via the list.
   **MembershipRepository:** `listProjectIdsForUser(userId)`.
4. **auth.ts:** `authorizeProjectRead(deps, principal, project)` (public→ok; private→admin/viewer+/own
   token). **routes/read-gate.ts:** `readGate(deps, req, projectId) → {ok, project} | {ok:false}`
   (loads project, 404 if missing, 404 if private+unauthorized) — one helper for every read route.
5. **Gate reads:** projects GET/:id, runs (trends, list, get, report), quality-gate GET summary + GET
   gate, compare, events (gate before `reply.hijack()`). **Badge stays public.** Filter GET /projects
   by the caller's visibility.
6. **Visibility route:** `PUT /projects/:id/visibility` (owner/admin) → setVisibility + audit
   `project_visibility_set`. Expose current visibility on the project object.
7. **Web:** show a visibility indicator + owner/admin toggle on the Project page; the project list
   naturally hides what the API filters; private + anonymous degrades gracefully.
8. **Tests:** repo (visibility persist + list filter both dialects); read-gate matrix (public open;
   private → admin/member/token ok, anon/non-member 404; badge public); visibility route auth.
   Verify all + live smoke.
9. **Code-review → fix → push → memory + FUTURE-WORK gap #2 done.**

## Notes
- 404 (not 401) for unauthorized private reads avoids existence disclosure; the list filter does the
  same for enumeration.
- Project tokens (write creds) also grant read of their own project (reading ≤ writing).
- Trend/compare/summary/report run-routes do one extra `projects.get` via readGate — acceptable.
