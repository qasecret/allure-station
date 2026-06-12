# Project page — design overrides & conventions

> Overrides/extends [`../MASTER.md`](../MASTER.md) for the **Project workspace** screen
> (`/projects/:id`). Read MASTER.md first; this file documents only the deviations and new
> surface-specific patterns introduced by the Enterprise T2 triage slice.

## Page hierarchy (top to bottom)

```
Topbar (breadcrumb + branch filter + run selector + Upload + Settings link)
  │
  ├─ [error banner]           only when latest run failed but isn't shown
  │
  ├─ Run header bar           status badge · stats summary · gate badge · branch/env chips · Copy link
  │
  ├─ Stats row                four equal-width tiles (grid-cols-2 sm:grid-cols-4, gap-3)
  │     ├─ Pass rate tile     PassRateDonut (size=40) + percentage
  │     ├─ Failures tile      count + signed delta vs previous ready run
  │     ├─ Duration tile      formatted duration + signed delta in seconds
  │     └─ Flaky tile         count, colored text-status-broken-text when > 0
  │
  ├─ Trend + Compare card     full-width Card (w-full)
  │     ├─ TrendChart         (see chart conventions below)
  │     └─ <details> Compare  collapsible; default open when ≥2 ready runs + no stored pref
  │
  └─ Tabs (Report | Runs)
        ├─ Report tab         iframe (Allure 3 report) or FailedRunPanel or EmptyState
        └─ Runs tab           RunsTable (filter chips + sortable headers + paginated list)
```

The stats row and trend card are wrapped in `<div className="space-y-3">` and are hidden together
when focus-report mode is active (`focusReport && tab === "report"`).

## Stats row tile conventions

- Container: `rounded-xl border bg-card p-3 shadow-sm` — matches ProjectCard and OverviewStrip tiles.
- Pass rate tile has `flex items-center gap-3` with the donut on the left.
- Numeric value: `text-2xl font-semibold tabular-nums` (matches the OverviewStrip Tile pattern).
- Delta badge: `text-xs font-medium` — positive delta (regression) uses `text-status-fail-text`,
  negative delta (improvement) uses `text-status-pass-text`. Delta is omitted when null/zero
  (`formatDelta` returns `null` for zero).
- The tile renders `null` when `current?.stats` is absent — never show a skeleton here; the stats
  row simply doesn't appear for runs that haven't produced stats yet.

## Trend chart conventions

### Color tokens

| Visual element | Token / value |
|---|---|
| Pass bar (no failures) | `#1DB980` — the brand teal (hardcoded: design-system primary) |
| Fail bar (any failure) | `#EF4444` — Tailwind red-500 (hardcoded: universally understood fail color) |
| Flaky amber topper | `#F59E0B` — Tailwind amber-500 |
| Duration polyline | `hsl(var(--primary-text))` — adapts to light/dark |
| Grid lines | `hsl(var(--border))` |
| Y-axis labels | `fill-muted-foreground font-mono` |
| X-axis labels | `fill-muted-foreground font-mono` fontSize=10 |

### SVG `role="group"` pattern

The chart SVG carries `role="group"` (not `role="img"`) to allow its child `<g>` elements to be
individually focusable and interactable:

```tsx
<svg role="group" aria-label={summaryLabel} …>
  <title>{summaryLabel}</title>  {/* fallback for AT that read role=img */}
  {bars.map((_, i) => (
    <g
      key={runId}
      role="button"
      tabIndex={i === rovingIndex ? 0 : -1}
      aria-label={buildAriaLabel(point)}
      focusable="true"
      …
    />
  ))}
</svg>
```

`role="group"` is preferred over `role="img"` here because the child bars are interactive — they
respond to `Enter`/`Space` (select run) and `←`/`→` arrow keys (move focus). An `aria-label` on the
`<svg>` itself gives screen readers an overall summary when they encounter the group.

### Roving tabindex pattern

- Only one bar is a tab stop at a time (`tabIndex={i === rovingIndex ? 0 : -1}`).
- `rovingIndex` starts at 0 and updates on `ArrowLeft`/`ArrowRight` keydown; it is clamped so
  a dataset resize can never leave focus trapped (`Math.min(activeIndex, points.length - 1)`).
- `focusable="true"` on the `<g>` enables focus in some SVG rendering contexts where it would
  otherwise be ignored.
- On click or keyboard activation, the bar calls `onSelectRun(runId)` — the same callback as the
  run selector in the topbar, so keyboard and pointer users share one code path.

### Window selector

Three `aria-pressed` `<Button variant="outline" size="sm">` chips (10 / 30 / 100) sit above the
chart inside a `role="group" aria-label="Trend window"` wrapper. The active chip gets
`bg-accent text-accent-foreground`. Selection persists per project in `sessionStorage` with key
`trend-window:${projectId}`.

### Overflow / responsive behavior

The chart SVG is rendered at its natural width (proportional to the number of bars) and wrapped in
an `overflow-x-auto` scroll container. This ensures bars don't get squeezed on narrow viewports
while still allowing the trend to be read by scrolling.

## Compare disclosure conventions

- Implemented as a native `<details>` element to leverage the browser's built-in open/close without
  a managed `useState` per interaction.
- Default open state: `readyRuns.length >= 2` unless the user has a stored pref in
  `sessionStorage` (`compare-open:${projectId}`).
- The `<summary>` has `list-none [&::-webkit-details-marker]:hidden` to remove the default
  triangle; a `<GitCompareArrows>` icon is rendered inline instead.
- The disclosure state syncs to sessionStorage on every toggle so navigating away and back
  preserves the choice.

## Runs table sortable headers

`SortTh` renders a `<th scope="col">` with `aria-sort={active ? order : undefined}` and a child
`<button aria-label="Sort by {label}">`. The sort cycle is **desc → asc → reset** (third click
removes the sort). This keeps the `<th>` as the `aria-sort` host (correct per ARIA spec) while the
`<button>` receives keyboard focus and click events.

## A11y checklist for this page

- [ ] Stats row tiles: no interactive elements; purely presentational — no extra roles needed.
- [ ] Trend chart: `role="group"` on svg, `role="button"` + roving tabindex on bar `<g>` elements,
  `focusable="true"` set, tooltip `role="tooltip"` associated via `id`.
- [ ] Compare disclosure: native `<details>` / `<summary>` — keyboard and AT support is built in.
- [ ] RunsTable `<th>` elements carry `aria-sort`; `<button>` inside carries `aria-label`.
- [ ] All icon-only controls have `aria-label` (Settings link, Focus-report button, History buttons).
- [ ] `aria-live="polite" role="status"` region in Project for SSE run-ready/failed announcements.
