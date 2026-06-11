# Enterprise upgrade, sub-project 2: Triage surfaces — design

**Date:** 2026-06-11 · **Status:** approved · **Owner:** Rabindra + Claude

Second of four sub-projects (1 Reach & access ✅ merged · **2 Triage surfaces** · 3 Polish & trust ·
4 Enterprise surface). Goal: the daily-use surfaces answer triage questions directly — "is anything
broken?", "when did it break?", "who changed what?" — instead of requiring scanning.

## Decisions made

| Decision | Choice |
|---|---|
| Home page | Status strip (instance counts) + sortable grid on the existing page; no new route |
| Home data | Enrich `GET /projects` items with `latestRun` (kills the per-card N+1) + tiny `GET /overview` aggregate; server-side `?sort=` |
| Trend chart | Hand-rolled SVG upgrade (axes, accessible tooltips, window selector, click-to-select) — zero new deps |
| Audit | Server-side filters (`action`, `actor`, `from`, `to`) + humanized rendering + client-side CSV export |
| Sortable tables | Runs = server-side `?sort/order`; Users = client-side; Audit stays time-desc (filters are its navigation) |

## 1. Server

- **Enriched project list** — `GET /api/projects` items become `projectListItemSchema` =
  `projectSchema` + `latestRun: { id, status, finishedAt, stats, gatePassed: boolean | null } | null`.
  Computed in ONE query pass (latest-run join, dialect-agnostic Drizzle — no per-project loop);
  `gatePassed` uses the shared `evaluateGate` (null when no gate configured or no stats).
- **Sorting** — `GET /api/projects?sort=name|worst|active` (default `name` = current behavior).
  `worst`: gate-breached first, then lowest latest pass-rate ascending, projects with no runs last,
  name as tie-break. `active`: latest run `createdAt` desc, no-runs last. Composes with `q`,
  `limit/offset`, and the visibility scope.
- **Overview** — new `GET /api/overview`:
  `{ projects, failing, gateBreached, runsLast24h, generating }` — counts only, scoped to the
  caller's visibility (anonymous excludes private projects, mirroring the list). `failing` = projects
  whose latest run is `failed` OR has failed tests; `gateBreached` = projects whose latest ready run
  fails its configured gate; `runsLast24h` = runs created in the trailing 24h; `generating` = runs
  currently in `generating`.
- **Audit filters** — `GET /api/audit` and `GET /api/projects/:id/audit` accept optional `action`
  (enum-validated), `actor` (substring match on actorLabel), `from`/`to` (ISO timestamps, inclusive).
  `X-Total-Count` reflects the filtered set. Verify a time index exists on the audit table; add one
  in BOTH dialect schemas + regenerated migrations if missing.
- **Runs sorting** — `GET /api/projects/:id/runs?sort=createdAt|duration|status&order=asc|desc`
  (default `createdAt desc`). Duration sorts by `stats.durationMs` (nulls last).
- **Trends window** — `GET /api/projects/:id/trends?limit=` (10–100, default 30; today's constant
  becomes the default).
- All contracts in `@allure-station/shared`, all routes declared in the OpenAPI registry (drift test),
  route tests per endpoint.

## 2. Web — home page

- **Status strip** (`Projects.tsx`): four stat tiles above search — Failing (destructive accent when
  >0), Gate breaches (amber when >0), Runs (24h), Generating (subtle pulse when >0) — from
  `useQuery(["overview"], …, { refetchInterval: 30_000 })`. Skeletons while loading; 2×2 grid below
  `sm`. Clicking Failing or Gate breaches applies `sort=worst`.
- **Sort control**: Select beside search (Name / Worst first / Recently active) → server `?sort=`,
  mirrored in the URL search params (shareable, reload-safe).
- **Cards** (`ProjectCard.tsx`): consume the embedded `latestRun` — DELETE the per-card
  `useQuery(["runs", p.id])`. Donut, "passed · ago" line, and a small gate ✓/✗ chip come from the
  payload. The sparkline fetches on hover/focus only (`enabled` flag); omitted below `sm`.

## 3. Web — project page hierarchy & trend chart

- **Stats row** replaces the Trend/Compare card pair: four compact tiles — Pass rate (small donut),
  Failures (delta vs previous ready run, ↑red/↓green), Duration (delta), Flaky — pure presentation
  over already-loaded data.
- **Trend** moves to a full-width card below the stats row. **Compare** collapses into a disclosure
  ("Compare runs…") in the trend card's header row; expanded state per project in sessionStorage;
  unchanged behavior when open. Net effect: the report rises above the fold at 1440×900.
- **`components/TrendChart.tsx`** (new; replaces inline TrendBar):
  - y-axis 0–100% with 3 gridlines; sparse x time labels (first/last + day boundaries); bars colored
    by status (existing semantics); duration overlay line with legend entry.
  - Window selector 10/30/100 → trends `?limit=`.
  - Accessible tooltips: bars are focusable (`role="button"`, `tabIndex=0`, full-datum `aria-label`);
    hover AND keyboard focus show an HTML tooltip; ArrowLeft/Right move between bars. SVG keeps a
    summary `role="img"` label. Clicking/Enter on a bar selects that run (`setSelectedRun`).
  - Empty state (<2 successful runs) keeps current copy. Tokens only; conventions per
    `design-system/allure-station/pages/app-shell.md`.

## 4. Web — audit & sortable tables

- **`lib/audit-format.ts`** — pure `describeAuditEntry(entry): string` mapping EVERY
  `auditActionSchema` value to a human sentence (actor + verb + target + salient metadata).
  Unknown actions fall back to raw action + key:value chips, never JSON blobs. Unit test iterates
  the enum so adding an action without a description fails the suite.
- **Audit page**: desktop table → Time · Event (sentence) · Project, with a per-row disclosure
  showing raw metadata; mobile cards reuse the sentence. Filter bar: action Select (from the shared
  enum), actor text input (debounced 300ms), from/to date inputs — mapped to server params, mirrored
  in the URL; pager respects filters. The per-project audit card gets the same bar minus project.
- **CSV export**: client-side; pages through the filtered API at the server cap (limit 200) up to
  10k rows (toast when truncated), downloads `audit-YYYY-MM-DD.csv` with raw columns + sentence.
- **Runs table**: sortable headers (Age, Duration, Status) → server `?sort/order`; `aria-sort`,
  chevron indicator, third click resets. **Users**: client-side sort on email/role.

## 5. Testing

- **Server**: sort correctness incl. tie-breaks and no-runs-last; overview counts incl. visibility
  scoping; audit filters individually + combined + X-Total-Count; runs sort; trends limit bounds.
  The latest-run join is dialect-sensitive → run the Postgres conformance suite locally via
  `docker/docker-compose.test.yml` as a plan verification step.
- **Web**: `describeAuditEntry` (enum-complete), sort-param mapping, CSV serialization, TrendChart
  geometry/label helpers as pure functions.
- **e2e**: extend the a11y fixture project with an uploaded run (proves the teal-text token under
  the gate on a populated page) + one new journey: strip shows failing → sort worst-first → stat
  tiles with delta → keyboard-focus a trend bar → runs table duration sort → audit filtered by
  action shows the sentence → CSV downloads.
- **Docs**: README highlights; user-guide §2/§5/§8/§14; screenshots refreshed post-merge;
  `design-system/allure-station/pages/project.md` documenting the new hierarchy.

## Out of scope (later sub-projects)

Motion tokens / reduced-motion, error-message mapping, skeletons beyond existing, absolute-time
handling (T3) · account/profile + sessions, token expiry, density mode, white-label login, i18n (T4).
