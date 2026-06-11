# End-user UX fix pack — design

**Date:** 2026-06-10 · **Status:** approved · **Owner:** Rabindra + Claude

Six end-user issues found by dogfooding the app end-to-end (deploy → push kotest demo runs →
triage in the UI). Scoped as one project, delivered as six sequenced slices, one PR each
(Approach A). The larger roadmap features (known-issue muting, retention, CLI, launches) are
explicitly **out of scope** and queue behind this pack as separate projects.

## Decisions made

| Decision | Choice |
|---|---|
| Scope | The 6 UX fixes only; roadmap features deferred |
| Run delete | `maintainer+` (or project token / open mode), **hard** delete, audited |
| Deep links | Run **and** test-detail position restored from the URL |
| Runs table | A tab on the project page (not a separate route) |
| Delivery | 6 slices in dependency order, one PR each |

## Slice order & dependencies

```
① display name (only migration)  →  independent
② run delete (API)               →  blocks ③
③ runs tab (UI)                  →  consumes ② + existing retry
④ upload metadata (UI)           →  independent
⑤ trend empty state (UI)         →  independent
⑥ deep links (UI + hook)         →  independent
```

---

## ① Project display name

**Problem:** `POST /projects` silently drops `name`; the UI shows only the id everywhere.

- **Schema:** `display_name TEXT` nullable on `projects` — added to **both**
  `db/schema.sqlite.ts` and `db/schema.pg.ts`; migrations regenerated for both dialects
  (`db:generate:sqlite` + `db:generate:pg`).
- **Contract (`@allure-station/shared`):** `projectSchema.displayName: z.string().min(1).max(120).nullable()`.
  `createProjectRequestSchema` accepts optional `displayName`. Values are trimmed; empty → null.
- **API:** create accepts it; a `PATCH /projects/:id { displayName }` route (write-guarded,
  `authorizeProjectWrite`) edits it. Audited as `project_renamed` with old/new in metadata.
  OpenAPI entries added.
- **Semantics:** `id` remains the immutable handle (URLs, API, CI). `displayName` is
  presentation-only; every surface falls back to `id` when null.
- **UI:** optional "Display name" field in `NewProjectDialog`; `ProjectCard` shows display name
  with id beneath in muted small type; project-page breadcrumb uses display name; a "Project
  name" card on Settings (maintainer+) edits it.

## ② Run delete

**Problem:** a botched upload lives forever; only whole-project delete exists.

- **Route:** `DELETE /api/projects/:id/runs/:runId` in `routes/runs.ts`, guarded by the existing
  `authorizeProjectWrite` (maintainer+ / project token / open mode).
- **Order of operations:**
  1. Verify the run exists and belongs to `:id` (404 otherwise).
  2. **409** if status is `generating` (don't race the worker; fail it via reconciler/wait first).
  3. Delete the DB row — `test_results` rows go via the existing `onDelete: cascade`.
  4. Best-effort `storage.remove()` of the run's results prefix and report prefix. A storage
     failure logs a warning and does **not** un-delete the row (orphaned storage is acceptable;
     a future retention sweeper reaps orphans). Mirrors the existing best-effort convention.
  5. If the run was the project's `latestRunId`, repoint to the next-newest **ready** run (or null).
  6. Audit `run_deleted` (run id, stats, branch/commit in metadata).
  7. Publish a `RunEvent` so subscribed UIs drop the run live.
- **OpenAPI** entry added (drift-guard test enforces).

## ③ Runs tab on the project page

**Problem:** runs are only reachable through a dropdown; no scannable list, no filters.

- Two tabs above the project-page content via the existing `components/ui/tabs.tsx`:
  **Report** (current view, default) and **Runs**.
- Table backed by the existing `GET /projects/:id/runs` pagination API (20/page,
  `X-Total-Count` pager). Status filter chips: `all / ready / failed / generating`.
- Columns: status badge · pass/fail (`7/8 · 1 failed`) · gate verdict (✓/✗/—) ·
  `branch@commit` (7-char) · env · duration · age (relative; exact on hover) · actions.
- Row actions: **Open** (switches to Report tab with that run selected), **Retry**
  (`failed` runs only; existing endpoint), **Delete** (uses ②; confirm dialog names the run;
  hidden when the caller lacks write access, mirroring existing settings-access gating).
- Consumes the page's existing SSE subscription: `generating` rows flip in place; deleted
  runs vanish.

## ④ Upload-dialog CI metadata

**Problem:** UI uploads lose branch/commit/env/ciUrl; the API already accepts them.

- `UploadDialog.tsx` gains four optional inputs — Branch, Commit, Environment, CI build URL —
  sent as the existing multipart text fields. Collapsed behind an "Add CI context (optional)"
  disclosure; the two-click quick path is unchanged.
- Last-used values per project are remembered in `localStorage` and pre-filled.

## ⑤ Trend card empty state

**Problem:** with <2 runs the card is unlabeled whitespace and reads as broken.

- `<2` ready runs → replace the sparkline area with the existing `EmptyState` component:
  chart icon + *"Trends appear after 2 runs — 1 more to go."* (0 runs: *"Trends appear after
  2 runs."*). Card height unchanged (no layout shift).

## ⑥ Shareable deep links (run + test)

**Problem:** the URL never changes; you can't link a teammate to a run, let alone a failing test.

- **Run → URL:** selected run becomes `?run=<runId>` (react-router `useSearchParams`,
  `replace` mode). Absent param = latest run (today's behavior). Compare base/target stay
  local state (not shareable — YAGNI).
- **Report position → URL:** the embedded Allure 3 report routes via its internal hash.
  A `useReportDeepLink` hook on the (same-origin) iframe:
  - mirrors `iframe.contentWindow.location.hash` → parent `#report=<hash>` via
    `history.replaceState`, checked on iframe `load` and a ~500 ms poll (cross-frame
    hashchange events are unreliable);
  - on mount with `#report=` present, appends that hash to the iframe `src` so Allure
    restores the view itself. No postMessage, no Allure changes.
- **Accepted caveat:** Allure's internal ids are stable per generated report, not across
  regenerations — a deep link targets that run's report (which is what sharing means).
  An unresolvable hash falls back to Allure's overview gracefully.
- **Copy link** button next to the run status header copies the canonical
  `…/projects/<id>?run=<runId>#report=<hash>` URL.

## Testing

- **Unit (vitest, co-located):** display-name normalization/validation; delete-route RBAC
  matrix, `latestRunId` repoint, 409-on-generating; runs-table row model (gate verdict +
  formatting); deep-link mirror/restore logic extracted as pure functions.
- **e2e (Playwright):** one new spec — create project with display name → card shows it →
  upload with metadata → runs tab lists the row → copy deep link → fresh navigation restores
  run + test view → delete run → row gone → audit entry exists.
- **Unchanged:** storage/db driver interfaces (only `remove()` reuse) — conformance suites
  untouched.

## Rollout

Six PRs in slice order (① carries the only migration; ② lands before ③). Each PR ships its
tests; `pnpm test && pnpm typecheck` green. After ③/④ land, refresh the affected user-guide
screenshots and sections (same capture method as the 2026-06-10 refresh) and note the new
features in README highlights.
