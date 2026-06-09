# Compare: Surface Slice-able Dimensions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a severity chip + `suite · owner` label on each run-comparison row, with every bucket ordered by severity (blocker → trivial, unknown last).

**Architecture:** Four thin layers — widen `listByRun` to read the four small dimensions; carry them on `testDiffSchema`; have `compareRuns` copy them onto each diff and sort each bucket by a pure shared comparator; render a chip + label in the web `Bucket`. No DB/migration changes — the data already exists (PR #10).

**Tech Stack:** TypeScript, zod (`@allure-station/shared`), Fastify + drizzle (server), React + TanStack Query + Tailwind (web), vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-compare-surface-dimensions-design.md`

**Conventions:** ESM imports use `.js` suffixes in shared/server; web uses the `@/…` alias. Each task is TDD: write the failing test, watch it fail, minimal implementation, watch it pass, commit.

---

### Task 1: Carry the dimensions on `testDiffSchema`

**Files:**
- Modify: `packages/shared/src/contracts.ts` (`testDiffSchema`, ~line 71)
- Test: `packages/shared/src/contracts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/contracts.test.ts`. Ensure the top import includes `testDiffSchema`:

```ts
import { createProjectSchema, projectIdSchema, testDiffSchema } from "./contracts.js";
```

Then add this test:

```ts
describe("testDiffSchema", () => {
  it("carries the slice-able dimensions", () => {
    const parsed = testDiffSchema.parse({
      historyId: "h", name: "t", fullName: "s#t",
      baseStatus: "passed", targetStatus: "failed", flaky: false,
      severity: "blocker", suite: "checkout", owner: "alice", tags: ["smoke"],
    });
    expect(parsed).toMatchObject({ severity: "blocker", suite: "checkout", owner: "alice", tags: ["smoke"] });
  });

  it("still parses a diff without the dimensions (back-compat)", () => {
    const parsed = testDiffSchema.parse({
      historyId: "h", name: "t", fullName: "s#t",
      baseStatus: "passed", targetStatus: "failed", flaky: false,
    });
    expect(parsed.severity).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @allure-station/shared exec vitest run src/contracts.test.ts -t "carries the slice-able"`
Expected: FAIL — `severity` is stripped by the schema, so `parsed.severity` is `undefined` and `toMatchObject` fails.

- [ ] **Step 3: Add the fields to `testDiffSchema`**

In `packages/shared/src/contracts.ts`, the diff currently ends at `flaky`:

```ts
export const testDiffSchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  baseStatus: testStatusSchema.nullable(),   // null = absent in base
  targetStatus: testStatusSchema.nullable(), // null = absent in target
  flaky: z.boolean(),                          // flaky in target (or base if absent in target)
});
```

Add the four fields before the closing `})`:

```ts
  flaky: z.boolean(),                          // flaky in target (or base if absent in target)
  // Slice-able dimensions copied from the diffed test (target, falling back to base) so the compare
  // UI can show severity/suite/owner without a second read. Optional/back-compat like testSummarySchema.
  // `tags` is carried for a stable contract but not rendered yet (see the filter slice).
  severity: z.string().nullable().optional(),
  suite: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @allure-station/shared exec vitest run src/contracts.test.ts -t "testDiffSchema"`
Expected: PASS (both new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/contracts.ts packages/shared/src/contracts.test.ts
git commit -m "feat(shared): carry severity/suite/owner/tags on testDiffSchema"
```

---

### Task 2: Pure severity-ordering unit

**Files:**
- Create: `packages/shared/src/severity.ts`
- Create: `packages/shared/src/severity.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/severity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { severityRank, bySeverity } from "./severity.js";

describe("severity ordering", () => {
  it("ranks known levels blocker→trivial and unknown/null last", () => {
    expect(severityRank("blocker")).toBeLessThan(severityRank("critical"));
    expect(severityRank("critical")).toBeLessThan(severityRank("trivial"));
    expect(severityRank("trivial")).toBeLessThan(severityRank("nope"));
    expect(severityRank(null)).toBe(severityRank("nope"));
    expect(severityRank(undefined)).toBe(severityRank(null));
    // Prototype keys must not leak through the lookup (e.g. "constructor" → Object).
    expect(severityRank("constructor")).toBe(severityRank(null));
  });

  it("bySeverity sorts blocker first, unknown/null last, stable within a rank", () => {
    const items = [
      { severity: null, name: "a" },
      { severity: "critical", name: "b" },
      { severity: "blocker", name: "c" },
      { severity: "critical", name: "d" }, // same rank as b → stable: b stays before d
      { severity: "trivial", name: "e" },
    ];
    const sorted = [...items].sort(bySeverity).map((x) => x.name);
    expect(sorted).toEqual(["c", "b", "d", "e", "a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @allure-station/shared exec vitest run src/severity.test.ts`
Expected: FAIL — `./severity.js` does not exist (module resolution / import error).

- [ ] **Step 3: Create the unit**

Create `packages/shared/src/severity.ts`:

```ts
// Allure's severity levels, most → least severe. A test's `severity` is a free string (adapters may
// emit arbitrary values), so anything outside this set — and absent severity — sorts after all known
// levels.
export const SEVERITY_RANK: Record<string, number> = {
  blocker: 0, critical: 1, normal: 2, minor: 3, trivial: 4,
};

/** Sort rank for a severity value; unknown/absent ranks after every known level. Guards on the value
 *  type (not `in`) so inherited prototype keys like "constructor" don't leak a non-number rank. */
export function severityRank(severity: string | null | undefined): number {
  if (severity == null) return Number.MAX_SAFE_INTEGER;
  const r = SEVERITY_RANK[severity as keyof typeof SEVERITY_RANK];
  return typeof r === "number" ? r : Number.MAX_SAFE_INTEGER;
}

/** Stable comparator: ascending by severity rank (blocker first, unknown/null last). */
export function bySeverity<T extends { severity?: string | null }>(a: T, b: T): number {
  return severityRank(a.severity) - severityRank(b.severity);
}
```

Add the export to `packages/shared/src/index.ts` (after the existing `export * from "./regression.js";`):

```ts
export * from "./severity.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @allure-station/shared exec vitest run src/severity.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/severity.ts packages/shared/src/severity.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add severity rank + stable comparator"
```

---

### Task 3: Enrich diffs and severity-sort the buckets

**Files:**
- Modify: `packages/server/src/compare.ts`
- Test: `packages/server/src/compare.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/compare.test.ts` (the existing `t()` helper already spreads `...over`, so passing `severity`/`suite`/`owner`/`tags` works because `TestSummary` carries them):

```ts
describe("dimensions on diffs", () => {
  it("copies severity/suite/owner/tags onto a diff (from base when absent in target)", () => {
    const base = { runId: "b", createdAt: "2026-06-06T00:00:00.000Z", tests: [
      t({ name: "gone", status: "failed", severity: "critical", suite: "checkout", owner: "alice", tags: ["smoke"] }),
    ]};
    const target = { runId: "t", createdAt: "2026-06-06T01:00:00.000Z", tests: [] };
    const res = compareRuns(base, target);
    expect(res.removed[0]).toMatchObject({ severity: "critical", suite: "checkout", owner: "alice", tags: ["smoke"] });
  });

  it("orders newlyFailing by severity (blocker first, unknown last)", () => {
    const base = { runId: "b", createdAt: "2026-06-06T00:00:00.000Z", tests: [
      t({ name: "n1", status: "passed" }), t({ name: "n2", status: "passed" }),
      t({ name: "n3", status: "passed" }), t({ name: "n4", status: "passed" }),
    ]};
    const target = { runId: "t", createdAt: "2026-06-06T01:00:00.000Z", tests: [
      t({ name: "n1", status: "failed", severity: "minor" }),
      t({ name: "n2", status: "failed", severity: "blocker" }),
      t({ name: "n3", status: "failed" }),                       // no severity → last
      t({ name: "n4", status: "failed", severity: "critical" }),
    ]};
    const res = compareRuns(base, target);
    expect(res.newlyFailing.map((d) => d.name)).toEqual(["n2", "n4", "n1", "n3"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @allure-station/server exec vitest run src/compare.test.ts -t "dimensions on diffs"`
Expected: FAIL — `res.removed[0]` lacks `severity` (undefined), and `newlyFailing` is in insertion order `["n1","n2","n3","n4"]`, not severity order.

- [ ] **Step 3: Enrich `toDiff` and sort the buckets**

In `packages/server/src/compare.ts`:

Add `bySeverity` to the shared import (first line):

```ts
import { bySeverity, isFailingStatus, type CompareResult, type TestDiff, type TestSummary } from "@allure-station/shared";
```

Extend `toDiff` to copy the four dimensions (it already copies `flaky` from `t`):

```ts
const toDiff = (base: TestSummary | undefined, target: TestSummary | undefined): TestDiff => {
  const t = (target ?? base)!;
  return {
    historyId: t.historyId,
    name: t.name,
    fullName: t.fullName,
    baseStatus: base?.status ?? null,
    targetStatus: target?.status ?? null,
    flaky: t.flaky,
    severity: t.severity ?? null,
    suite: t.suite ?? null,
    owner: t.owner ?? null,
    tags: t.tags ?? [],
  };
};
```

Sort every bucket by severity just before the `return res;` at the end of `compareRuns`:

```ts
  for (const [key, bt] of baseMap) {
    if (!targetMap.has(key)) res.removed.push(toDiff(bt, undefined));
  }
  // Surface the worst regressions first: order each bucket by severity (blocker→trivial, unknown last).
  // Array.sort is stable, so within a rank the original insertion order is preserved.
  for (const bucket of [res.newlyFailing, res.fixed, res.stillFailing, res.added, res.removed, res.flaky]) {
    bucket.sort(bySeverity);
  }
  return res;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @allure-station/server exec vitest run src/compare.test.ts`
Expected: PASS (new tests + the existing `compareRuns` tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/compare.ts packages/server/src/compare.test.ts
git commit -m "feat(compare): carry dimensions on diffs and severity-sort buckets"
```

---

### Task 4: Re-widen `listByRun` to read the four dimensions

**Files:**
- Modify: `packages/server/src/db/test-results-repo.ts` (`listByRun`)
- Test: `packages/server/src/db/repositories.test.ts` (existing "listByRun round-trips" test)

- [ ] **Step 1: Extend the failing test**

In `packages/server/src/db/repositories.test.ts`, the `sample` fixture already carries the dimensions on the first two entries. Extend the existing round-trip assertions (the `it("replaceForRun inserts and listByRun round-trips status/duration/flaky/null", …)` test) to also check the dimensions:

```ts
        expect(byName["passing test"]).toMatchObject({ status: "passed", duration: 1000, flaky: false, historyId: "h-pass", severity: "critical", owner: "alice", suite: "checkout", tags: ["smoke", "regression"] });
        expect(byName["failing test"]).toMatchObject({ status: "failed", duration: 2000, flaky: true, severity: "blocker", owner: null, suite: "checkout", tags: [] });
        expect(byName["no-history test"]).toMatchObject({ status: "skipped", duration: null, flaky: false, historyId: null, fullName: null, severity: null, owner: null, suite: null, tags: [] });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @allure-station/server exec vitest run src/db/repositories.test.ts -t "listByRun round-trips"`
Expected: FAIL — `listByRun` does not return `severity`/`owner`/`suite`/`tags`, so those keys are `undefined` and `toMatchObject` fails (e.g. expected `"critical"`, got `undefined`).

- [ ] **Step 3: Widen the `listByRun` projection**

In `packages/server/src/db/test-results-repo.ts`, `listByRun` currently selects and maps only the lean comparison fields. Add the four small dimensions (still excluding the heavy `message`/`trace` blobs, and excluding write-only `muted`/`known`).

Change the `.select({...})`:

```ts
    const rows = await this.db
      .select({
        historyId: testResults.historyId, name: testResults.name, fullName: testResults.fullName,
        status: testResults.status, duration: testResults.duration, flaky: testResults.flaky,
        severity: testResults.severity, owner: testResults.owner, suite: testResults.suite, tags: testResults.tags,
      })
      .from(testResults).where(eq(testResults.runId, runId));
```

Change the `.map(...)` return to add the four fields (parse `tags` JSON; null → `[]`):

```ts
    return rows.map((r) => ({
      historyId: r.historyId,
      name: r.name,
      fullName: r.fullName,
      status: r.status as TestStatus,
      duration: r.duration === null ? null : Number(r.duration),
      flaky: r.flaky === "true",
      severity: r.severity,
      owner: r.owner,
      suite: r.suite,
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    }));
```

Update the method's lead comment so the "lean" intent stays accurate — the heavy blobs are still excluded, the small dimensions are now included because compare consumes them:

```ts
    // Comparison reader: returns the small per-test fields compare needs, including the slice-able
    // dimensions (severity/owner/suite/tags). Still excludes the heavy message/trace blobs (fetched
    // lazily via the timeline) and the write-only muted/known flags (no consumer yet).
```

(Replace the existing "Lean projection: message/trace are intentionally excluded …" comment block above the `.select`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @allure-station/server exec vitest run src/db/repositories.test.ts -t "TestResultRepository"`
Expected: PASS (the round-trip test plus the existing raw-read persistence test and the others).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/test-results-repo.ts packages/server/src/db/repositories.test.ts
git commit -m "feat(repo): listByRun returns severity/owner/suite/tags for compare"
```

---

### Task 5: Web — severity chip + suite·owner label on each compare row

**Files:**
- Create: `packages/web/src/lib/severity.ts`
- Create: `packages/web/src/lib/severity.test.ts`
- Modify: `packages/web/src/pages/Project.tsx` (`Bucket`, ~lines 310-331; add `SeverityChip`)

- [ ] **Step 1: Write the failing test for the chip-class helper**

Create `packages/web/src/lib/severity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { severityChipClass } from "./severity.js";

describe("severityChipClass", () => {
  it("returns classes for known levels", () => {
    expect(severityChipClass("blocker")).toContain("text-status-fail");
    expect(severityChipClass("critical")).toContain("text-status-fail");
    expect(severityChipClass("normal")).toContain("text-status-broken");
    expect(severityChipClass("minor")).toContain("text-muted-foreground");
    expect(severityChipClass("trivial")).toContain("text-muted-foreground");
  });
  it("returns null for unknown/absent levels (render nothing)", () => {
    expect(severityChipClass("nope")).toBeNull();
    expect(severityChipClass("constructor")).toBeNull(); // prototype key must not leak
    expect(severityChipClass(null)).toBeNull();
    expect(severityChipClass(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/severity.test.ts`
Expected: FAIL — `./severity.js` does not exist (import error).

- [ ] **Step 3: Create the chip-class helper**

Create `packages/web/src/lib/severity.ts`:

```ts
// Severity → Tailwind chip classes, tiered onto the existing status color tokens: blocker/critical
// red (status-fail), normal amber (status-broken), minor/trivial muted. Unknown/absent → null so the
// chip renders nothing.
const SEVERITY_CHIP: Record<string, string> = {
  blocker: "bg-status-fail/15 text-status-fail",
  critical: "bg-status-fail/15 text-status-fail",
  normal: "bg-status-broken/15 text-status-broken",
  minor: "bg-muted text-muted-foreground",
  trivial: "bg-muted text-muted-foreground",
};

/** Tailwind classes for a severity chip, or null when the level is unknown/absent. Guards on the
 *  value type (not `in`) so inherited prototype keys like "constructor" don't leak a bogus class. */
export function severityChipClass(severity?: string | null): string | null {
  if (!severity) return null;
  const cls = SEVERITY_CHIP[severity as keyof typeof SEVERITY_CHIP];
  return typeof cls === "string" ? cls : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/severity.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the chip + label in `Bucket`**

In `packages/web/src/pages/Project.tsx`:

Add the import alongside the other `@/lib` imports (near line 19):

```ts
import { severityChipClass } from "@/lib/severity";
```

Add a `SeverityChip` component just above the `Bucket` function:

```tsx
function SeverityChip({ severity }: { severity?: string | null }) {
  const cls = severityChipClass(severity);
  if (!cls) return null;
  return <span className={`shrink-0 rounded px-1 text-[10px] font-medium uppercase ${cls}`}>{severity}</span>;
}
```

In `Bucket`, change the row `<li>` so the chip and a muted `suite · owner` label precede the name. Replace the existing `<li>`'s first child (the `<span>{t.name}…</span>`) so the row reads:

```tsx
          <li key={(t.historyId ?? t.fullName ?? t.name) + label} className="flex items-center gap-1">
            <SeverityChip severity={t.severity} />
            {(t.suite || t.owner) ? (
              <span className="shrink-0 text-xs text-muted-foreground">{[t.suite, t.owner].filter(Boolean).join(" · ")}</span>
            ) : null}
            <span>{t.name}{t.baseStatus && t.targetStatus ? <span className="text-muted-foreground"> ({t.baseStatus}→{t.targetStatus})</span> : null}</span>
            {(t.historyId ?? t.fullName) ? (
              <button type="button" onClick={() => onOpen(t)} aria-label={`History for ${t.name}`}
                className="ml-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <History className="size-3.5" />
                <span>History</span>
              </button>
            ) : null}
          </li>
```

- [ ] **Step 6: Verify the web build + typecheck**

Run: `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web build`
Expected: typecheck clean; build emits `dist` with no errors. (`TestDiff` already imported in Project.tsx now carries `severity`/`suite`/`owner`, so the new field accesses typecheck.)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/severity.ts packages/web/src/lib/severity.test.ts packages/web/src/pages/Project.tsx
git commit -m "feat(web): severity chip + suite·owner label on compare rows"
```

---

### Task 6: Full verification

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: 4/4 packages clean.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all packages green (shared gains the severity + testDiff tests; server gains the compare-dimension tests; web gains the severity-chip test).

- [ ] **Step 3: Run the Postgres conformance suite** (verifies `listByRun`'s widened projection on pg)

```bash
docker compose -f docker/docker-compose.test.yml up -d postgres
# wait for healthy:
until [ "$(docker inspect --format '{{.State.Health.Status}}' docker-postgres-1)" = "healthy" ]; do sleep 2; done
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
docker compose -f docker/docker-compose.test.yml down
```

Expected: the repositories suite passes against both sqlite and pg backends.

- [ ] **Step 4: No commit** (verification only). If anything fails, fix under TDD before proceeding.

---

## Notes for the implementer

- **No DB/migration changes.** The `test_results` columns already exist (PR #10). This plan only reads four of them and renders them.
- **`muted`/`known` stay write-only** — do not add them to `listByRun`. They feed a later known-issues feature.
- **`tags` is carried but not rendered** — it flows through the contract and `listByRun`/`compareRuns`, but the `Bucket` row intentionally does not display it (avoids clutter; lands with the filter slice).
- **`notify.ts` is unchanged** — it reads only `compareRuns(...).newlyFailing.length`; the extra fields cost a trivial once-per-run read.
