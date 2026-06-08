# F4 — Most-recent-regression "bisect hint" — Design

> Slice F4 from `docs/IMPROVEMENTS-ROADMAP.md`. Builds directly on the F1 per-test history
> (`historyByKey`) merged in PR #3. Status: approved design, ready for implementation planning.

## Goal

For a **currently-failing** test, tell the engineer *when it started failing* — "failing since run
X (commit, date), last passed at run Y" — computed from the cross-run timeline F1 already returns.
This answers the second half of the daily triage question ("…and when did it start?") that the
timeline drawer sets up but does not yet compute.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| What to report | The **most-recent regression** (latest passing→failing transition), only when the test is **currently failing**. |
| Status semantics | `failed` + `broken` = failing; `passed` = passing; `skipped` + `unknown` = **ignored** (skipped over, do not break a streak). |
| Window-limited case | When the failing streak reaches the oldest run in the fetched window (no passing run found), report an **honest caveat** (`windowLimited: true`, `lastPassed: null`) — no extra query. |
| Where computed | **Server-side**, as a field on the history response, via a pure function in `@allure-station/shared`. |
| Surfacing | The history **drawer** only (the server field enables compare/PR-comment reuse later — deferred). |

## Verified context

- `historyByKey` (`packages/server/src/db/test-results-repo.ts`) returns `entries: TestHistoryEntry[]`
  ordered **newest→oldest, one per run**, each with `runId`, `createdAt`, `commit`, `ciUrl`, `status`,
  `flaky`. This is the exact input the bisect needs — no new query.
- The history route (`packages/server/src/routes/test-history.ts`) already assembles the response
  object from `entries`; adding a `regression` field is a few lines.
- `TestHistoryEntry` / `testHistorySchema` live in `packages/shared/src/contracts.ts`.
- The drawer (`TestHistorySheet` in `packages/web/src/pages/Project.tsx`) already renders the flake
  badge + per-run list and has `relativeTime` available from `packages/web/src/lib/format.ts`.

## Component 1 — `computeRegression` (pure function, `@allure-station/shared`)

`computeRegression(entries: TestHistoryEntry[]): Regression | null`. Pure, dialect-free, co-located
with the contract so it is independently unit-testable and reusable later (compare view, PR comment).

Algorithm (entries are newest→oldest, one per run):
1. A status is *failing* if `failed`|`broken`, *passing* if `passed`, *ignored* if `skipped`|`unknown`.
2. Find the newest **non-ignored** entry. If there is none, or it is passing → return `null`
   (the test is not currently failing).
3. Otherwise walk forward (toward older) over non-ignored entries collecting the **leading failing
   streak**. `firstFailed` = the oldest entry in that streak; `failingRunCount` = number of failing
   entries in it (ignored runs not counted).
4. The next non-ignored entry after the streak:
   - passing → `lastPassed` = that entry, `windowLimited: false`.
   - none (ran off the oldest end of the window) → `lastPassed: null`, `windowLimited: true`.

The streak stops at the first passing run, so `F F P F` reports only the current `F F` streak — that
*is* the most recent regression. `F S F P` ignores the `S`: streak = the two `F`s, `lastPassed` = `P`.

## Component 2 — contract (`packages/shared/src/contracts.ts`)

```ts
export const runRefSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
});

export const regressionSchema = z.object({
  windowLimited: z.boolean(),          // true when no passing run was found within the window
  firstFailed: runRefSchema,           // oldest run of the current failing streak
  lastPassed: runRefSchema.nullable(), // the passing run just before the streak; null when windowLimited
  failingRunCount: z.number(),         // size of the current failing streak (within the window)
});
```
Add `regression: regressionSchema.nullable()` to `testHistorySchema` (null unless currently failing).
Export `RunRef` and `Regression` types. `runRef` is self-contained (date + short commit) so a future
PR-comment consumer needs no entry lookup; the drawer resolves `ciUrl` from the matching entry by `runId`.

## Component 3 — route (`packages/server/src/routes/test-history.ts`)

After building the history response, import and call `computeRegression(entries)` and add the result
as `regression` on the returned object. No new query, no new endpoint.

## Component 4 — drawer (`packages/web/src/pages/Project.tsx`)

A one-line hint above the timeline list (beside the flake badge), shown only when `data.regression`
is non-null:
- regressed (`windowLimited: false`): "Failing since {relativeTime(firstFailed.createdAt)} · {commit
  short} — last passed {relativeTime(lastPassed.createdAt)}", each date linking to its run's `ciUrl`
  (resolved from `entries` by `runId`) when present.
- window-limited (`windowLimited: true`): "Failing for at least the last {failingRunCount} runs — no
  passing run in view."

Use existing tokens (`text-status-fail`, muted text) and `relativeTime`. Commit shown as `slice(0,7)`,
matching the per-row commit rendering.

## Data flow

```
historyByKey → entries[]  (route already has these)
  → computeRegression(entries) → Regression | null
  → response.regression
  → drawer renders the bisect hint above the timeline
```

## Error handling

- Not currently failing / no entries / all-skipped → `regression: null` → drawer shows no hint.
- `commit`/`ciUrl` null (runs without CI metadata) → hint shows date only, no commit chip / no link.
- Window-limited → caveat copy, no false start point.

## Testing

- **shared** (`computeRegression` unit tests): currently-passing→null; `P F F`→regressed (firstFailed
  = first F, lastPassed = P, count 2); all-fail→windowLimited (lastPassed null); `F S F P`→skip
  ignored (count 2, lastPassed P); broken-counts-as-failing; `F F P F`→only the current streak; empty
  →null; single failing entry with nothing older→windowLimited.
- **route** (`test-history.test.ts`): response carries `regression` for a failing test (firstFailed/
  lastPassed runIds correct) and `null` for a passing one.
- **web**: light — drawer renders the hint for a failing test; typecheck + build.

## Out of scope (YAGNI)

"Recovered / now-green" reporting; surfacing in the compare view or PR comments (the server field
enables it, deferred); widening the bisect beyond the display window; multi-transition history.
