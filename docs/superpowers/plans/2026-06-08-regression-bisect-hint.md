# F4 — Regression bisect hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a currently-failing test, surface *when it started failing* ("failing since run X / commit, last passed at run Y") in the history drawer, computed server-side from the F1 timeline.

**Architecture:** A pure `computeRegression(entries)` in `@allure-station/shared` derives the most-recent passing→failing transition from the newest→oldest, one-per-run timeline `historyByKey` already returns. The history route calls it and adds a nullable `regression` field to the response; the drawer renders a one-line hint. No new query or endpoint.

**Tech Stack:** TypeScript ESM, Zod contracts (`@allure-station/shared`), Fastify, Vitest, React 18 + TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-08-regression-bisect-hint-design.md`

---

## File map

- Modify: `packages/shared/src/contracts.ts` — add `runRefSchema`, `regressionSchema`, `regression` on `testHistorySchema`, + type exports.
- Create: `packages/shared/src/regression.ts` — pure `computeRegression`.
- Modify: `packages/shared/src/index.ts` — re-export `./regression.js`.
- Test: `packages/shared/src/regression.test.ts`.
- Modify: `packages/server/src/routes/test-history.ts` — call `computeRegression`, add `regression` to the response.
- Test: `packages/server/src/routes/test-history.test.ts`.
- Modify: `packages/web/src/pages/Project.tsx` — `RegressionHint` component + render in the drawer.

---

## Task 1: `computeRegression` + contracts (shared)

**Files:**
- Modify: `packages/shared/src/contracts.ts` (after `testHistorySchema`, ~line 112; type exports ~line 276)
- Create: `packages/shared/src/regression.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/regression.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/shared/src/regression.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeRegression } from "./regression.js";
import type { TestHistoryEntry, TestStatus } from "./contracts.js";

// Build a newest→oldest entry list from a status string like "F F P". runId/createdAt encode position.
const entries = (spec: string): TestHistoryEntry[] => {
  const map: Record<string, TestStatus> = { F: "failed", B: "broken", P: "passed", S: "skipped", U: "unknown" };
  return spec.split(" ").map((c, i) => ({
    runId: `r${i}`, createdAt: `2026-06-${String(20 - i).padStart(2, "0")}T00:00:00.000Z`,
    branch: null, commit: `c${i}`, ciUrl: null,
    status: map[c], duration: null, flaky: false, message: null, hasTrace: false,
  }));
};

describe("computeRegression", () => {
  it("returns null when the test is currently passing", () => {
    expect(computeRegression(entries("P F F"))).toBeNull();
  });

  it("returns null for an empty timeline", () => {
    expect(computeRegression([])).toBeNull();
  });

  it("reports the most-recent regression (P F F → first failed r1, last passed r2)", () => {
    const reg = computeRegression(entries("F F P"))!; // newest F, then F, then P
    expect(reg.windowLimited).toBe(false);
    expect(reg.failingRunCount).toBe(2);
    expect(reg.firstFailed.runId).toBe("r1"); // oldest run of the current streak
    expect(reg.lastPassed?.runId).toBe("r2"); // the passing run before it
  });

  it("treats broken as failing", () => {
    const reg = computeRegression(entries("B P"))!;
    expect(reg.firstFailed.runId).toBe("r0");
    expect(reg.lastPassed?.runId).toBe("r1");
  });

  it("ignores skipped/unknown runs without breaking the streak (F S F P)", () => {
    const reg = computeRegression(entries("F S F P"))!;
    expect(reg.failingRunCount).toBe(2);          // the S is not counted
    expect(reg.firstFailed.runId).toBe("r2");     // oldest failing (the S at r1 skipped over)
    expect(reg.lastPassed?.runId).toBe("r3");
  });

  it("only reports the current streak, not an earlier one (F F P F)", () => {
    const reg = computeRegression(entries("F F P F"))!;
    expect(reg.failingRunCount).toBe(2);
    expect(reg.firstFailed.runId).toBe("r1");
    expect(reg.lastPassed?.runId).toBe("r2");
  });

  it("is window-limited when no passing run is in range (all failing)", () => {
    const reg = computeRegression(entries("F F F"))!;
    expect(reg.windowLimited).toBe(true);
    expect(reg.lastPassed).toBeNull();
    expect(reg.failingRunCount).toBe(3);
    expect(reg.firstFailed.runId).toBe("r2"); // oldest in window
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @allure-station/shared test src/regression.test.ts`
Expected: FAIL — cannot resolve `./regression.js` / `computeRegression` undefined.

- [ ] **Step 3: Add the contract schemas + types**

In `packages/shared/src/contracts.ts`, immediately after `testHistorySchema` closes (the `});` ending the schema with `entries: z.array(testHistoryEntrySchema)`), add:

```ts
// A minimal reference to a run, self-contained for the regression hint (date + short commit) so a
// consumer needs no entry lookup to render it.
export const runRefSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
});

// The most-recent passing→failing transition for a currently-failing test (the "bisect hint").
export const regressionSchema = z.object({
  windowLimited: z.boolean(),          // true when no passing run was found within the window
  firstFailed: runRefSchema,           // oldest run of the current failing streak
  lastPassed: runRefSchema.nullable(), // the passing run just before the streak; null when windowLimited
  failingRunCount: z.number(),         // size of the current failing streak (within the window)
});
```

Then add `regression` to `testHistorySchema`. Change it from:

```ts
export const testHistorySchema = z.object({
  identity: z.object({
    historyId: z.string().nullable(),
    fullName: z.string().nullable(),
    name: z.string(),
  }),
  window: z.number(),     // number of runs in `entries`
  flakeRate: z.number(),  // flakyCount / window, 0 when empty
  entries: z.array(testHistoryEntrySchema),
});
```

to add the field (place `regression` right after `flakeRate`):

```ts
export const testHistorySchema = z.object({
  identity: z.object({
    historyId: z.string().nullable(),
    fullName: z.string().nullable(),
    name: z.string(),
  }),
  window: z.number(),     // number of runs in `entries`
  flakeRate: z.number(),  // flakyCount / window, 0 when empty
  regression: regressionSchema.nullable(), // most-recent regression; null unless currently failing
  entries: z.array(testHistoryEntrySchema),
});
```

Add the type exports next to the other history exports (after `export type TestTrace = ...`):

```ts
export type RunRef = z.infer<typeof runRefSchema>;
export type Regression = z.infer<typeof regressionSchema>;
```

- [ ] **Step 4: Create the pure function**

Create `packages/shared/src/regression.ts`:

```ts
import type { Regression, TestHistoryEntry } from "./contracts.js";

const FAILING = new Set(["failed", "broken"]);
const IGNORED = new Set(["skipped", "unknown"]);

/**
 * Most-recent regression for a test's timeline (entries newest→oldest, one per run). Returns null
 * unless the test is currently failing. failed/broken = failing, passed = passing, skipped/unknown =
 * ignored (skipped over). See docs/superpowers/specs/2026-06-08-regression-bisect-hint-design.md.
 */
export function computeRegression(entries: TestHistoryEntry[]): Regression | null {
  const meaningful = entries.filter((e) => !IGNORED.has(e.status)); // drop ignored, keep order
  const newest = meaningful[0];
  if (!newest || !FAILING.has(newest.status)) return null; // not currently failing

  // Walk the leading failing streak; stop at the first passing run (or the end of the window).
  let i = 0;
  while (i < meaningful.length && FAILING.has(meaningful[i].status)) i++;
  const firstFailed = meaningful[i - 1]; // oldest run of the streak
  const before = meaningful[i];          // first non-ignored older than the streak — passing, if present

  const ref = (e: TestHistoryEntry) => ({ runId: e.runId, createdAt: e.createdAt, commit: e.commit });
  return {
    windowLimited: before === undefined,
    firstFailed: ref(firstFailed),
    lastPassed: before ? ref(before) : null,
    failingRunCount: i,
  };
}
```

- [ ] **Step 5: Re-export from the package index**

In `packages/shared/src/index.ts`, add below the existing `export * from "./contracts.js";`:

```ts
export * from "./regression.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @allure-station/shared test src/regression.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @allure-station/shared typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/contracts.ts packages/shared/src/regression.ts packages/shared/src/regression.test.ts packages/shared/src/index.ts
git commit -m "feat(F4): computeRegression + regression contract"
```

---

## Task 2: wire `regression` into the history route

**Files:**
- Modify: `packages/server/src/routes/test-history.ts:1-31`
- Test: `packages/server/src/routes/test-history.test.ts`

- [ ] **Step 1: Write the failing route tests**

In `packages/server/src/routes/test-history.test.ts`, add these tests inside the `describe("GET /tests/history", …)` block (the `readyRun` helper and `sum` factory already exist at the top of the file):

```ts
  it("computes the most-recent regression for a currently-failing test", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    await readyRun(deps, "p", "r2", [sum("failed")], "2026-06-02T00:00:00.000Z");
    await readyRun(deps, "p", "r3", [sum("failed")], "2026-06-03T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    const reg = res.json().regression;
    expect(reg).toMatchObject({ windowLimited: false, failingRunCount: 2 });
    expect(reg.firstFailed.runId).toBe("r2");
    expect(reg.lastPassed.runId).toBe("r1");
    await app.close();
  });

  it("regression is null when the test is currently passing", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("failed")], "2026-06-01T00:00:00.000Z");
    await readyRun(deps, "p", "r2", [sum("passed")], "2026-06-02T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.json().regression).toBeNull();
    await app.close();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @allure-station/server test src/routes/test-history.test.ts`
Expected: FAIL — `res.json().regression` is `undefined` (the route doesn't return it yet).

- [ ] **Step 3: Wire the function into the route**

In `packages/server/src/routes/test-history.ts`, change the import line:

```ts
import { readGate } from "./read-gate.js";
```

to add the shared import:

```ts
import { computeRegression } from "@allure-station/shared";
import { readGate } from "./read-gate.js";
```

Then in the `/tests/history` handler, change the response object from:

```ts
    return {
      identity: {
        historyId: latestHistoryId ?? historyId ?? null,
        fullName: latestFullName ?? fullName ?? null,
        name: latestName ?? name ?? "",
      },
      window: entries.length,
      flakeRate,
      entries,
    };
```

to compute and include `regression` (place it right after `flakeRate`, matching the contract order):

```ts
    return {
      identity: {
        historyId: latestHistoryId ?? historyId ?? null,
        fullName: latestFullName ?? fullName ?? null,
        name: latestName ?? name ?? "",
      },
      window: entries.length,
      flakeRate,
      regression: computeRegression(entries),
      entries,
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @allure-station/server test src/routes/test-history.test.ts`
Expected: PASS (all, including the two new tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @allure-station/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/test-history.ts packages/server/src/routes/test-history.test.ts
git commit -m "feat(F4): add regression to the history response"
```

---

## Task 3: render the bisect hint in the drawer

**Files:**
- Modify: `packages/web/src/pages/Project.tsx` (type import line 4; new `RegressionHint`; render in `TestHistorySheet` ~line 280)

- [ ] **Step 1: Add the type import + format helper**

In `packages/web/src/pages/Project.tsx`, extend the shared type import (line 4) to add `Regression` and `RunRef`:

```ts
import type { Run, RunStatus, TestDiff, TestHistoryEntry, Regression, RunRef, TrendPoint } from "@allure-station/shared";
```

Add a `relativeTime` import alongside the other `@/` imports (e.g. after the `@/components/ui/sheet` import):

```ts
import { relativeTime } from "@/lib/format";
```

- [ ] **Step 2: Render the hint in the drawer**

In `TestHistorySheet`, change the block that renders the flake badge:

```tsx
            <Badge variant="secondary">Flaky {Math.round(data.flakeRate * 100)}% over {data.window} run{data.window === 1 ? "" : "s"}</Badge>
```

to render the regression hint right after it:

```tsx
            <Badge variant="secondary">Flaky {Math.round(data.flakeRate * 100)}% over {data.window} run{data.window === 1 ? "" : "s"}</Badge>
            {data.regression ? <RegressionHint regression={data.regression} entries={data.entries} /> : null}
```

- [ ] **Step 3: Add the `RegressionHint` component**

In `packages/web/src/pages/Project.tsx`, add this component immediately after the `TestHistorySheet` function (before `TraceDetails`):

```tsx
function RegressionHint({ regression, entries }: { regression: Regression; entries: TestHistoryEntry[] }) {
  const link = (ref: RunRef) => {
    const ciUrl = entries.find((e) => e.runId === ref.runId)?.ciUrl ?? null;
    const label = relativeTime(ref.createdAt);
    return ciUrl
      ? <a href={ciUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{label}</a>
      : <span>{label}</span>;
  };
  if (regression.windowLimited) {
    return (
      <p className="text-sm text-status-fail">
        Failing for at least the last {regression.failingRunCount} run{regression.failingRunCount === 1 ? "" : "s"} — no passing run in view.
      </p>
    );
  }
  return (
    <p className="text-sm text-status-fail">
      Failing since {link(regression.firstFailed)}
      {regression.firstFailed.commit ? <span className="text-muted-foreground"> · {regression.firstFailed.commit.slice(0, 7)}</span> : null}
      {regression.lastPassed ? <> — last passed {link(regression.lastPassed)}</> : null}
    </p>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web build`
Expected: no type errors; dist build succeeds (confirms `Regression`/`RunRef` and `@/lib/format` resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/Project.tsx
git commit -m "feat(F4): bisect hint in the test history drawer"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the whole test + typecheck suite**

Run:
```bash
pnpm test
pnpm typecheck
```
Expected: all green across shared/server/worker/web.

- [ ] **Step 2: Commit if anything was adjusted**

```bash
git add -A && git commit -m "test(F4): full suite green" || echo "nothing to commit"
```

---

## Notes / decisions baked in

- `failed`/`broken` = failing, `passed` = passing, `skipped`/`unknown` = ignored (skipped over).
- `computeRegression` returns `null` unless the newest non-ignored entry is failing.
- The streak stops at the first passing run, so only the *current* regression is reported (`F F P F` → just the leading `F F`).
- Window-limited (`lastPassed: null`, `windowLimited: true`) when the streak reaches the oldest run in the fetched window — honest caveat, no extra query.
- Out of scope: recovered/now-green reporting, compare/PR-comment surfacing, widening beyond the window.
