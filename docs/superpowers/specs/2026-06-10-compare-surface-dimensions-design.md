# Surface slice-able dimensions on the run-comparison view

**Date:** 2026-06-10
**Status:** Approved (design)
**Depends on:** the extraction slice (PR #10) — `test_results` already stores
`severity`, `owner`, `suite`, `tags`, `muted`, `known` per test.

## Goal

Make the dimensions captured by the extraction slice **visible to automation
engineers** on the run-comparison view. When comparing two runs, each test row
shows a **severity chip** and a **`suite · owner`** label, and every bucket is
**ordered by severity** (blocker → trivial, unknown/absent last) so the most
important regressions sit at the top.

This is the first *consumer* of the extracted data. Compare is the natural fit:
it already reads the per-test rows where the dimensions live (trends reads only
run-level aggregates and would need new per-run aggregation — out of scope).

## Non-goals

- Grouping by suite, or filter controls (severity ≥, suite, owner, tag). Those
  are a later slice; this one only makes the dimensions *visible and ordered*.
- Rendering `tags`. It is carried through the API for a stable contract but not
  shown this slice (avoids row clutter); it lands visually with the filter slice.
- Surfacing dimensions in trends, test-history timeline, or notifications.
- Any new DB columns or migration — the data already exists.

## Architecture — four thin layers

### 1. Read path (`packages/server/src/db/test-results-repo.ts`)

Widen `listByRun` to also select `severity, owner, suite, tags` and map them
onto the returned `TestSummary`. It stays "lean" in the sense that matters — it
still excludes the heavy `message`/`trace` blobs (the original rationale for the
lean projection). `tags` is parsed from its JSON column to `string[]` (null → `[]`).

`muted`/`known` remain **write-only** — no consumer yet, so they are not selected.

> **Note on the earlier revert.** A prior review reverted `listByRun` to a bare
> projection because *no consumer* read the dimensions. That is no longer true:
> compare is a real consumer, and both of `listByRun`'s callers (`compare.ts`,
> `notify.ts`) flow through `compareRuns`. `notify` pays a trivial once-per-run
> cost for four small columns. Re-widening is therefore justified; the lean
> intent (exclude 16 KB blobs) is preserved. A comment records this.

### 2. Contract (`packages/shared/src/contracts.ts`)

Extend `testDiffSchema` with four optional fields, mirroring the existing
`flaky` field on the diff:

```
severity: z.string().nullable().optional(),
suite:    z.string().nullable().optional(),
owner:    z.string().nullable().optional(),
tags:     z.array(z.string()).optional(),
```

Also add a pure severity-ordering unit, co-located with the diff contract:

```
export const SEVERITY_RANK: Record<string, number> =
  { blocker: 0, critical: 1, normal: 2, minor: 3, trivial: 4 };
// rank(severity): known level → its rank; null/unknown/absent → Number.MAX_SAFE_INTEGER (sorts last)
// bySeverity(a, b): stable comparator over TestDiff by rank(severity)
```

`severity` is stored as a free string (adapters may emit arbitrary values), so
any value outside the known set ranks last alongside null.

### 3. Compare logic (`packages/server/src/compare.ts`)

- `toDiff` copies `severity`, `suite`, `owner`, `tags` from the chosen test
  (`target ?? base`), exactly as it already copies `flaky`.
- After bucketing, sort each of the six buckets in place with `bySeverity`.
  Sort is **stable**, so within a severity rank the existing insertion order
  (target-map iteration order) is preserved.

### 4. Web (`packages/web/src/pages/Project.tsx` + a new `SeverityChip`)

- New `SeverityChip` component: maps a severity level to a small color-coded
  chip (blocker/critical → red-ish, normal → neutral, minor/trivial → muted).
  Renders nothing when severity is null/absent.
- `Bucket`'s row gains, before the test name: the `SeverityChip`, then a muted
  `suite · owner` label (each part omitted when absent; the separator only shows
  when both are present). Rows arrive pre-sorted from the API — the UI does not
  re-sort.

## Data flow

```
listByRun(runId)  ── now returns severity/suite/owner/tags on each TestSummary
      │
      ▼
compareRuns(base, target)
      │   toDiff copies the 4 dims onto each TestDiff
      │   each bucket sorted by bySeverity (stable)
      ▼
GET /projects/:id/compare  ── TestDiff[] per bucket, severity-ordered
      │
      ▼
ComparePanel → Bucket row: [SeverityChip] suite · owner  name (base→target) [History]
```

## Error handling / back-compat

- **Pre-extraction runs** (before PR #10) have null dimensions → no chip, no
  label, sort last. No migration, no breakage.
- **Unknown severity value** → ranks last, no chip (chip only renders known levels).
- **Absent suite/owner** → label part omitted; no empty separators.
- `notify.ts` behavior is unchanged (it reads only `newlyFailing.length`).

## Testing

- **shared** (`contracts` or a co-located test): `bySeverity` ordering —
  blocker-first, nulls/unknowns last, stable within a rank.
- **server** (`compare.test.ts`): a diff carries `severity`/`suite`/`owner`/`tags`
  from the target (and from base when target is absent, e.g. `removed`); each
  bucket is severity-ordered. (`repositories.test.ts`): update the lean-reader
  assertion now that `listByRun` returns the four dimensions.
- **web**: `Bucket` renders the chip + `suite · owner`; `SeverityChip` colors per
  level and renders nothing for null.

## Files touched

- `packages/server/src/db/test-results-repo.ts` — widen `listByRun`.
- `packages/shared/src/contracts.ts` — `testDiffSchema` fields + `SEVERITY_RANK`/`bySeverity`.
- `packages/server/src/compare.ts` — `toDiff` enrichment + bucket sort.
- `packages/web/src/pages/Project.tsx` — `Bucket` row; new `SeverityChip` (co-located or in `components/`).
- Tests: `compare.test.ts`, `repositories.test.ts`, a shared comparator test, a web `Bucket`/`SeverityChip` test.

No schema/migration changes.
