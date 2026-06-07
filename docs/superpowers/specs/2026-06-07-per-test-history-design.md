# Per-test history timeline + error capture (F0 + F1) — Design

> Slice F0+F1 from `docs/IMPROVEMENTS-ROADMAP.md`. Verified against code on 2026-06-07.
> Status: approved design, ready for implementation planning.

## Goal

Capture each test's error text on ingest (F0), and let an engineer open any changed test from
the ComparePanel to see its **cross-run pass/fail timeline + flake rate** (F1). This answers the
daily triage question — "is this newly failing or always flaky, and when did it start?" — and lays
the data foundation for later failure clustering (F3), error search, and LLM summaries (X1).

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test identity | `historyId`, fallback `fullName` | Matches how Allure tracks history; both columns already exist (nullable). |
| Flake metric | Stored `flaky`-flag rate over the window | Uses data already recorded; cheap and accurate to what's stored. Cross-run instability deferred to F5. |
| History window | Last **50** runs; `limit` query param capped at **200** | Bounded query cost; 50 is ample for triage. Flake rate computed over the same window. |
| Error capture | `message` + `trace`, truncated (**message 2 KB**, **trace 16 KB**) | Full enough for triage now and clustering (F3) later, while bounding row growth. |
| Entry point | "History" link on **ComparePanel** rows → timeline drawer | Smallest build; our UI has no native per-run test list (the report is an embedded Allure iframe), and ComparePanel rows already carry `historyId`/`name`. |

## Verified facts (spike, 2026-06-07)

- `test_results` already stores `historyId`, `fullName`, `duration`, `status`, `flaky`, indexed on
  `run_id` only. `replaceForRun` deletes only the *current* run's rows, so history accumulates
  across runs naturally.
- Error text is **not** stored today — neither `test_results` nor `TestSummary` has `message`/`trace`.
  Hence F0 is a prerequisite.
- `@allurereport/core-api@3.9.0` `TestResult.error?: { message?, trace?, actual?, expected? }` — the
  worker's `summarize()` already reads each `TestResult`, so extraction is a local change.
- The web app renders reports via an `iframe` of Allure's generated HTML (`Project.tsx`); the only
  native test surface is `ComparePanel` (`TestDiff` rows). So the timeline entry point is ComparePanel.
- `compareRuns`/`routes/compare.ts` use `testResults.listByRun`; `readGate` is the existing
  per-project read authorization (returns 404 to hide existence).

## Architecture

Two parts. F0 (write path) must land first because F1's error display reads what F0 stores
(though F1's timeline itself works on status-only and degrades gracefully for pre-F0 rows).

### Part F0 — capture error text (ingest → store)

1. **Contract** — `shared/contracts.ts`: add `message: z.string().nullable()` and
   `trace: z.string().nullable()` to `testSummarySchema`.
2. **Worker** — `worker/src/generate.ts` `summarize()`: read `r.error?.message` / `r.error?.trace`,
   pass through a `truncate(text, capBytes)` helper (message 2 KB, trace 16 KB; append
   `\n…[truncated]` when cut). Caps measured in UTF-8 bytes; cut on a safe boundary.
3. **Schema (both dialects)** — add nullable `message` + `trace` text columns to `test_results` in
   `schema.sqlite.ts` **and** `schema.pg.ts` (kept structurally identical).
4. **Repo** — `db/test-results-repo.ts`: persist both fields in `replaceForRun`; return them in
   `listByRun`.
5. **Migrations** — regenerate for both dialects (`db:generate:sqlite`, `db:generate:pg`); they
   apply on startup.

### Part F1 — timeline (index → query → endpoint → UI)

6. **Indexes (both dialects)** — `idx_test_results_history` on `history_id`,
   `idx_test_results_fullname` on `full_name`. Supports the cross-run lookup.
7. **Repo method** — `historyByKey(projectId, key, limit)` where `key` is `{historyId}` or
   `{fullName}`:
   - Join `test_results` → `runs` where `runs.project_id = projectId` AND `runs.status = 'ready'`
     AND (`history_id = key.historyId` when given, else `full_name = key.fullName`).
   - Order by `runs.created_at` DESC; clamp `limit` to `[1, 200]`.
   - Return entries `{ runId, createdAt, branch, commit, ciUrl, status, duration, flaky, message,
     trace }` and a computed `flakeRate = flakyCount / entries.length` (0 when empty).
8. **Endpoint** — `GET /projects/:projectId/tests/history?historyId=…|fullName=…&name=…&limit=50`:
   - Behind `readGate(deps, req, projectId)` → 404 when denied/unknown (existence hidden).
   - 400 if neither `historyId` nor `fullName` is provided.
   - Returns new `testHistorySchema`:
     `{ identity: { historyId|null, fullName|null, name }, window: number, flakeRate: number,
        entries: TestHistoryEntry[] }`. `identity.name` is taken from the most recent matching row;
     the optional `name` query param is only a display fallback when there are zero matching rows.
   - Lives in `routes/test-history.ts` as `registerTestHistoryRoutes(app, deps)`, registered in
     `app.ts`, with a co-located `routes/test-history.test.ts`.
9. **Web** —
   - API client `getTestHistory(projectId, { historyId?, fullName?, name? })`.
   - `ComparePanel` diff rows gain a small "history" affordance (icon button). Rows expose
     `historyId` (preferred) or `fullName` from `TestDiff`; rows with neither omit the link.
   - A **drawer/dialog** (existing shadcn/ui) renders: the test name, a flake-rate badge, and one
     row per run — status chip + date + branch/commit chip linking to `ciUrl` — with expandable
     `message`/`trace` on failed/broken entries.

## Data flow

```
CI send-results (Allure error already in result files)
  → generation → summarize() extracts + truncates message/trace
  → replaceForRun stores per-test rows (now incl. message/trace)
ComparePanel "history" click (has historyId/fullName)
  → GET /projects/:id/tests/history?historyId=…
  → readGate → historyByKey() project-scoped join over test_results+runs
  → { identity, window, flakeRate, entries[] }
  → drawer renders timeline + flake badge + expandable errors
```

## Error handling

- No identity key → **400**.
- Private/unknown project → **404** via `readGate` (consistent existence-hiding).
- `limit` out of range → clamped to `[1, 200]` (not an error).
- Tests with neither `historyId` nor `fullName` → no history link rendered (acceptable).
- Pre-F0 rows have null `message`/`trace` → render with no error section; never throw.

## Testing

- **Repo conformance** (`db/repositories.test.ts`, runs on sqlite **and** pg via `PG_TEST_URL`):
  `historyByKey` returns the window newest-first, scoped to the project, with correct flake count,
  respects the 200 cap, prefers `historyId`, and ignores non-`ready` runs.
- **Worker**: `summarize` extracts `message`/`trace` and truncates at the caps with the marker.
- **Route** (`routes/test-history.test.ts`): happy path; 400 (no key); 404 (private via readGate);
  limit clamp; pre-F0 null fields.
- **Web**: a light component check of the drawer rendering an entry with/without error.
- **Migrations** regenerated for both dialects; startup auto-apply covers application.

## Out of scope (YAGNI)

Cross-run instability metric (F5) · full-text error search (later F1 stretch) · native per-run test
list · failure clustering (F3) · attachments rendering · pagination beyond the window · LLM
summaries (X1).
