# Enterprise upgrade, sub-project 3: Polish & trust — design

**Date:** 2026-06-12 · **Status:** approved · **Owner:** Rabindra + Claude

Third of four sub-projects (1 Reach & access ✅ · 2 Triage surfaces ✅ · **3 Polish & trust** ·
4 Enterprise surface). Goal: the app behaves like a product you can trust under failure and at a
glance — human error messages with recovery paths, no blank-page crash mode, no layout jumps while
loading, one time convention, and a coherent motion system.

> Verified current state (survey of `packages/web`, 2026-06-12): API errors surface as raw
> `"409: <body>"` toasts via `(e as Error).message` at ~15 sites; there is **no ErrorBoundary**
> (a render crash blanks the app — observed twice during T2 development); skeletons exist only on
> the Projects page; time rendering uses three conventions (runs = relative + `title` attr,
> audit = absolute-only `toLocaleString()`, charts = inline absolutes); animation durations are
> ad hoc (200/300/500ms across shadcn components); a global `prefers-reduced-motion` guard
> **already exists** (`styles.css:148-155`) and covers all current and new animations.

## Decisions made

| Decision | Choice |
|---|---|
| Error depth | Full treatment: structured `ApiError` + human mapping, ErrorBoundary, inline query-error states with Retry, QueryClient defaults |
| Time convention | Relative + accessible tooltip everywhere; audit uses a dense inline dual form ("2h ago · Jun 12, 06:44") |
| Motion scope | Duration/easing tokens + migrate existing usages + targeted micro-polish; fix trend-chart x-label overlap (carried debt) |
| Structure | Primitives first (one owner-file each, tested), then a mechanical page sweep — consistency by construction |

## 1. Errors

- **`ApiError`** — `api/client.ts`'s `json()` throws `ApiError extends Error` carrying
  `{ status: number, serverMessage: string }` (parsed from the response body; the body may be a
  JSON `{error}` envelope or plain text — handle both). Network failures (fetch reject) throw
  `ApiError` with `status: 0`.
- **`lib/errors.ts`** — `humanizeError(e: unknown, context?: string): string`:
  - 0 → "Can't reach the server — check your connection and try again."
  - 401 → "Your session has expired — sign in again."
  - 403 → "You don't have permission to do that."
  - 404 → "That no longer exists — it may have been deleted."
  - 409 → context-specific when `context` is given (e.g. `humanizeError(e, "user")` →
    "That email is already in use."), else "That conflicts with something that already exists."
  - 413 → "That upload is too large."
  - 422/400 → prefer the serverMessage when it reads like a sentence (validation messages do),
    else "That request wasn't valid — check the form and try again."
  - 5xx → "Something went wrong on the server — try again in a moment."
  - Non-ApiError unknowns → generic fallback, never `undefined`/`[object Object]`.
  - Unit test is **status-table-complete** (every mapped status asserted) and asserts no output
    ever starts with a bare status code.
- **`components/ErrorBoundary.tsx`** — class component wrapping the router in `main.tsx`:
  branded card (logo, "Something went wrong", the error message in a muted `<details>`, a
  "Reload" button calling `location.reload()`). A render crash can never blank the app again.
- **`components/QueryErrorState.tsx`** — inline error card (alert icon + humanized message +
  Retry button calling the query's `refetch`) used by page-level queries instead of rendering an
  empty table/section on failure: Projects grid, runs table, audit table, users table, settings
  cards, ComparePanel, TestHistorySheet. `role="alert"` so failures are announced.
- **QueryClient defaults** (`main.tsx`): `queries: { retry: 1 }`, `mutations: { retry: 0 }` —
  explicit, documented; per-query `retry: false` overrides stay.
- **Sweep**: every `toast.error((e as Error).message)` → `toast.error(humanizeError(e, …))`;
  ad-hoc parsing like Users.tsx's `e.message.includes("409")` is deleted in favor of the mapping.

## 2. Time

- **`components/TimeStamp.tsx`** — `<TimeStamp iso={string} dense?: boolean>`:
  - default: `relativeTime(iso)` text wrapped in the shadcn Tooltip with a keyboard-focusable
    trigger (`tabIndex={0}`, not the `title` attribute) whose content is the full local timestamp
    ("Jun 12, 2026, 06:44:11").
  - `dense`: inline "2h ago · Jun 12, 06:44" (no hover needed — audit/compliance surfaces).
- **`relativeTime` fallover** — beyond 7 days, return the local date ("Jun 5") instead of
  "34d ago"; beyond a year include the year. Unit-tested boundaries.
- **Sweep**: RunsTable `title` spans, ProjectCard, audit page + per-project audit card
  (`dense`), Users created-at if shown, chart tooltip/aria reuse the same formatter from
  `lib/format.ts` (one absolute-formatting function, no per-component `toLocaleString` recipes).

## 3. Motion

- **Tokens** — CSS vars in `styles.css` + tailwind mapping: `--motion-fast: 150ms`,
  `--motion-base: 200ms`, `--motion-slow: 300ms`; easings `--ease-out` (enter) / `--ease-in`
  (exit). The ~17 ad-hoc `duration-*` usages in `ui/{sheet,dialog,select,dropdown-menu,tooltip}`
  migrate to token-backed classes. MASTER.md documents the scale and the rule "no raw duration
  classes outside ui/".
- **Targeted polish** — one `animate-fade-in` utility (~`--motion-fast`, opacity-only, no
  stagger) applied when page/tab content settles from a query; press feedback (`active:scale`
  or state-layer) on cards/buttons that lack it. Nothing animates layout (transform/opacity
  only).
- **Trend-chart x-axis overlap (carried debt)** — `xAxisLabels` thins day-boundary labels to
  what fits: compute label width budget from plot width and drop intermediate labels (keep
  first/last) when they would collide; geometry helper change, unit-tested.
- **Reduced motion** — the existing global guard covers all of the above by construction; no
  per-component handling needed. Verified by the a11y suite remaining green.

## 4. Skeletons

- **`components/skeletons.tsx`** — `TableSkeleton({ rows, cols })` emitting layout-matched
  skeleton rows, plus a `CardSkeleton` matching the settings-card shell. Heights match the real
  rendered rows/cards so content settles with ~zero layout shift.
- **Sweep** (everything that currently pops in): runs table, audit table + per-project audit
  card, users table, project settings cards (one per card), ComparePanel, TestHistorySheet, and
  a subtle shimmer block behind the report iframe until its `load` event.
- Skeletons render only on initial load (`isLoading`), not on background refetches —
  `keepPreviousData` behavior on paged tables is preserved.

## 5. Testing & docs

- **Unit**: `humanizeError` status-table-complete; `TimeStamp`/`relativeTime` boundaries
  (just-now, 7d fallover, year fallover, dense form); `xAxisLabels` thinning under narrow
  widths; skeleton components render expected row/col counts.
- **e2e**: existing 10 specs stay green (skeleton/tooltip changes must not break locators —
  use `visible=true`-safe assertions). The authed spec adds one inline-error leg: point a query
  at a deleted resource (e.g. navigate to `/projects/does-not-exist`) and assert the humanized
  QueryErrorState renders with a Retry button (and axe-scan it). ErrorBoundary is covered by a
  unit test (throwing child renders the fallback), not e2e.
- **Docs**: MASTER.md gains "Motion" (tokens, reduced-motion note, no-raw-durations rule) and
  "Time" (convention + TimeStamp usage) sections; README/user-guide untouched unless visuals
  change (screenshots refresh post-merge only if visibly different).

## Out of scope (T4)

Account/profile + sessions UI, token expiry, density mode, white-label login, i18n scaffolding.
Also out: server-side error-shape changes (the API already returns `{error}` envelopes; T3 is
client-side presentation only).
