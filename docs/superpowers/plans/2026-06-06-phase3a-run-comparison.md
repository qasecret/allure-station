# Phase 3a — Run comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Diff two runs of a project — surface newly-failing, fixed, still-failing, added, removed, and flaky tests — by persisting per-test results during generation and comparing them in the DB.

**Architecture:** Generation already loads every `TestResult` from Allure's store to compute aggregate stats. We extend that single pass to also return per-test rows (`historyId, name, fullName, status, duration, flaky`) and persist them to a new `test_results` table. A `GET /compare?base=&target=` endpoint matches tests across the two runs by `historyId` (Allure's stable cross-run hash) and buckets the differences. A UI panel renders the diff.

**Tech Stack:** drizzle (sqlite + pg, all-TEXT columns to match existing schema), Fastify, zod contracts in `shared`, React + react-query.

---

## Spike findings (2026-06-06) — verified at runtime

`report.store.allTestResults()` (already called in `computeStats`) returns `TestResult[]` with: `name`, `fullName?`, **`historyId`** (Allure **recomputes** it as a deterministic hash of fullName+params — stable across runs for the same test → the cross-run match key), `status` (`"failed"|"broken"|"passed"|"skipped"|"unknown"`), `duration?` (ms), `flaky` (boolean). Confirmed against the fixtures: two tests came back with distinct stable `historyId`s, correct status/duration. We compute the diff from our OWN persisted rows (NOT Allure's `transition`, which needs the history path we deliberately don't set to avoid the `appendHistory` deadlock).

**Match key:** `historyId ?? fullName ?? name` (historyId effectively always present; fallback for safety).

---

## File Structure

- Modify `packages/shared/src/contracts.ts` — `testStatusSchema`, `TestSummary`, `TestDiff`, `CompareResult`.
- Modify `packages/server/src/db/schema.sqlite.ts` + `schema.pg.ts` — `test_results` table; generate migrations.
- Create `packages/server/src/db/test-results-repo.ts` — `TestResultRepository`.
- Create `packages/server/src/db/test-results-repo.test.ts` — conformance (sqlite + pg).
- Modify `packages/worker/src/generate.ts` — return `tests: TestSummary[]`.
- Modify `packages/worker/src/generate.test.ts` — assert tests returned.
- Modify `packages/server/src/generation.ts` — persist test rows on ready.
- Modify `packages/server/src/app.ts` + `deps.ts` + `runtime.ts`/`test-helpers.ts` — add `testResults` repo to deps; register compare route.
- Create `packages/server/src/compare.ts` — pure diff function.
- Create `packages/server/src/compare.test.ts` — diff unit tests.
- Create `packages/server/src/routes/compare.ts` — `GET /compare` route.
- Create `packages/server/src/routes/compare.test.ts` — route test (seeds rows directly).
- Modify `packages/web/src/api/client.ts` — `compareRuns`.
- Modify `packages/web/src/pages/Project.tsx` — compare panel.
- Modify `README.md`.

ESM throughout; commit per task; `pnpm --filter <pkg> test|typecheck`.

---

### Task 1: shared contracts

**Files:** Modify `packages/shared/src/contracts.ts`

- [ ] **Step 1:** Add after `runStatsSchema`:

```ts
export const testStatusSchema = z.enum(["passed", "failed", "broken", "skipped", "unknown"]);

// One test's outcome within a run (persisted per run, returned by generation).
export const testSummarySchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  status: testStatusSchema,
  duration: z.number().nullable(),
  flaky: z.boolean(),
});

// One test's cross-run difference.
export const testDiffSchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  baseStatus: testStatusSchema.nullable(),   // null = absent in base
  targetStatus: testStatusSchema.nullable(), // null = absent in target
  flaky: z.boolean(),                          // flaky in target (or base if absent in target)
});

export const compareResultSchema = z.object({
  base: z.object({ runId: z.string(), createdAt: z.string() }),
  target: z.object({ runId: z.string(), createdAt: z.string() }),
  newlyFailing: z.array(testDiffSchema), // base passed/skipped -> target failed/broken
  fixed: z.array(testDiffSchema),        // base failed/broken  -> target passed
  stillFailing: z.array(testDiffSchema), // failing in both
  added: z.array(testDiffSchema),        // absent in base
  removed: z.array(testDiffSchema),      // absent in target
  flaky: z.array(testDiffSchema),        // flagged flaky in target
});
```

- [ ] **Step 2:** Add type exports next to the others:

```ts
export type TestStatus = z.infer<typeof testStatusSchema>;
export type TestSummary = z.infer<typeof testSummarySchema>;
export type TestDiff = z.infer<typeof testDiffSchema>;
export type CompareResult = z.infer<typeof compareResultSchema>;
```

- [ ] **Step 3:** `pnpm --filter @allure-station/shared typecheck && pnpm --filter @allure-station/shared test`; commit `feat(shared): test-result + run-comparison contracts`.

---

### Task 2: `test_results` schema + migrations

**Files:** Modify `schema.sqlite.ts`, `schema.pg.ts`

- [ ] **Step 1 (sqlite):** Add to `packages/server/src/db/schema.sqlite.ts`:

```ts
export const testResults = sqliteTable("test_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  historyId: text("history_id"),
  name: text("name").notNull(),
  fullName: text("full_name"),
  status: text("status").notNull(),       // passed|failed|broken|skipped|unknown
  duration: text("duration"),               // ms, stringified | null
  flaky: text("flaky").notNull(),           // "true" | "false"
}, (t) => ({
  byRun: index("idx_test_results_run").on(t.runId),
}));
```

- [ ] **Step 2 (pg):** Add the analogous `pgTable("test_results", {...})` to `schema.pg.ts` (same columns/index; use `pgTable`/`text`/`index` already imported).

- [ ] **Step 3:** Generate migrations:

```bash
cd packages/server && pnpm run db:generate:sqlite && pnpm run db:generate:pg
```

Confirm each emits a `CREATE TABLE ... test_results` migration; commit the SQL + meta. `feat(db): test_results table (both dialects)`.

---

### Task 3: `TestResultRepository`

**Files:** Create `packages/server/src/db/test-results-repo.ts`, `test-results-repo.test.ts`

- [ ] **Step 1:** Write the repo. `replaceForRun` deletes existing rows then inserts (idempotent re-generation). Note: `id` is generated here via a passed-in `newId` to avoid coupling to nanoid.

```ts
import { eq } from "drizzle-orm";
import type { TestStatus, TestSummary } from "@allure-station/shared";
import type { Db } from "./client.js";
import { testResults } from "./schema.sqlite.js";

export class TestResultRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  /** Replace all stored test rows for a run (idempotent across re-generation). */
  async replaceForRun(runId: string, tests: TestSummary[]): Promise<void> {
    await this.db.delete(testResults).where(eq(testResults.runId, runId));
    if (tests.length === 0) return;
    await this.db.insert(testResults).values(
      tests.map((t) => ({
        id: this.newId(),
        runId,
        historyId: t.historyId,
        name: t.name,
        fullName: t.fullName,
        status: t.status,
        duration: t.duration === null ? null : String(t.duration),
        flaky: t.flaky ? "true" : "false",
      })),
    );
  }

  async listByRun(runId: string): Promise<TestSummary[]> {
    const rows = await this.db.select().from(testResults).where(eq(testResults.runId, runId));
    return rows.map((r) => ({
      historyId: r.historyId,
      name: r.name,
      fullName: r.fullName,
      status: r.status as TestStatus,
      duration: r.duration === null ? null : Number(r.duration),
      flaky: r.flaky === "true",
    }));
  }
}
```

- [ ] **Step 2:** Test, mirroring the existing parameterized repo conformance (sqlite always; pg when `PG_TEST_URL`). Cover: replaceForRun inserts; listByRun round-trips status/duration/flaky/null-duration; replaceForRun called twice replaces (no dupes); cascade delete when the run/project is removed. Use `createDb`, create a project + run first (FK), then test. Follow the structure of `repositories.test.ts` (read it for the harness).

- [ ] **Step 3:** `pnpm --filter @allure-station/server typecheck && pnpm --filter @allure-station/server test test-results`; commit `feat(db): TestResultRepository (replaceForRun/listByRun)`.

---

### Task 4: generation returns + persists per-test rows

**Files:** Modify `packages/worker/src/generate.ts`, `generate.test.ts`, `packages/server/src/generation.ts`, `deps.ts`, `app.ts`, `runtime.ts`, `test-helpers.ts`

- [ ] **Step 1 (worker):** Change `GenerateResult` to `{ stats: RunStats; tests: TestSummary[] }` and compute both in one pass over `allTestResults()`. Replace `computeStats` with a `summarize` that returns both:

```ts
import type { RunStats, TestSummary, TestStatus } from "@allure-station/shared";
// in GenerateResult:
export interface GenerateResult { stats: RunStats; tests: TestSummary[]; }

// replace computeStats body:
async function summarize(report: AllureReport): Promise<GenerateResult> {
  const results = await report.store.allTestResults();
  const stats: RunStats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };
  const tests: TestSummary[] = [];
  for (const r of results) {
    stats.total += 1;
    switch (r.status) {
      case "passed": stats.passed += 1; break;
      case "failed": stats.failed += 1; break;
      case "broken": stats.broken += 1; break;
      default: stats.skipped += 1; break; // skipped + unknown
    }
    const status: TestStatus = (["passed", "failed", "broken", "skipped"].includes(r.status) ? r.status : "unknown") as TestStatus;
    tests.push({
      historyId: r.historyId ?? null,
      name: r.name,
      fullName: r.fullName ?? null,
      status,
      duration: r.duration ?? null,
      flaky: r.flaky ?? false,
    });
  }
  return { stats, tests };
}
```

In `generateReport`, change the final line to `return summarize(report);`.

- [ ] **Step 2 (worker test):** In `generate.test.ts`, assert the result now includes `tests` with the expected length and a known test's status/historyId (the fixtures have `historyId` "case-fail"/"case-pass" → recomputed hashes, so assert on `name`/`status` and that `historyId` is a non-empty string). Keep the existing stats assertions.

- [ ] **Step 3 (deps):** Add `testResults: TestResultRepository` to `AppDeps` (`app.ts`), construct it in `buildDeps` (`deps.ts`) as `new TestResultRepository(db, () => nanoid(12))` — match the existing `newId` length, and in `test-helpers.ts` it comes through `buildDeps`/the deps literal (add `testResults: new TestResultRepository(db, deps.newId)` if the literal is hand-built — check the file). NOTE: `buildDeps` already receives `db`; `runtime.ts` calls `buildDeps`, so no runtime.ts change needed beyond what buildDeps does. Verify `test-helpers.ts` (it hand-builds deps) gets the new field.

- [ ] **Step 4 (generation):** In `runGeneration`, capture tests and persist on the ready path:

```ts
const { stats, tests } = await generateReport({ ... });
await deps.storage.putDir(`${projectId}/runs/${runId}/report`, outDir);
await deps.testResults.replaceForRun(runId, tests);
await deps.runs.markReady(runId, stats, deps.now());
await publishRun(deps, projectId, runId);
```

- [ ] **Step 5:** Extend the e2e/results test: after generation, assert `deps.testResults.listByRun(runId)` returns 2 rows with the right statuses. `pnpm --filter @allure-station/worker test && pnpm --filter @allure-station/server test`; commit `feat(generation): persist per-test results for run comparison`.

---

### Task 5: comparison logic + route

**Files:** Create `packages/server/src/compare.ts`, `compare.test.ts`, `routes/compare.ts`, `routes/compare.test.ts`; modify `app.ts` (register).

- [ ] **Step 1:** Pure diff function:

```ts
import type { CompareResult, TestDiff, TestSummary } from "@allure-station/shared";

const keyOf = (t: TestSummary): string => t.historyId ?? t.fullName ?? t.name;
const isFailing = (s: TestSummary["status"]): boolean => s === "failed" || s === "broken";
const isPassing = (s: TestSummary["status"]): boolean => s === "passed" || s === "skipped";

const toDiff = (base: TestSummary | undefined, target: TestSummary | undefined): TestDiff => {
  const t = target ?? base!;
  return {
    historyId: t.historyId,
    name: t.name,
    fullName: t.fullName,
    baseStatus: base?.status ?? null,
    targetStatus: target?.status ?? null,
    flaky: (target ?? base)!.flaky,
  };
};

export function compareRuns(
  base: { runId: string; createdAt: string; tests: TestSummary[] },
  target: { runId: string; createdAt: string; tests: TestSummary[] },
): CompareResult {
  const baseMap = new Map(base.tests.map((t) => [keyOf(t), t]));
  const targetMap = new Map(target.tests.map((t) => [keyOf(t), t]));

  const res: CompareResult = {
    base: { runId: base.runId, createdAt: base.createdAt },
    target: { runId: target.runId, createdAt: target.createdAt },
    newlyFailing: [], fixed: [], stillFailing: [], added: [], removed: [], flaky: [],
  };

  for (const [key, tt] of targetMap) {
    const bt = baseMap.get(key);
    if (!bt) { res.added.push(toDiff(undefined, tt)); }
    else if (isFailing(tt.status) && isPassing(bt.status)) { res.newlyFailing.push(toDiff(bt, tt)); }
    else if (isPassing(tt.status) && isFailing(bt.status)) { res.fixed.push(toDiff(bt, tt)); }
    else if (isFailing(tt.status) && isFailing(bt.status)) { res.stillFailing.push(toDiff(bt, tt)); }
    if (tt.flaky) res.flaky.push(toDiff(bt, tt));
  }
  for (const [key, bt] of baseMap) {
    if (!targetMap.has(key)) res.removed.push(toDiff(bt, undefined));
  }
  return res;
}
```

- [ ] **Step 2:** Unit-test `compare.ts` with hand-built `TestSummary[]`: a test that goes passed→failed (newlyFailing), failed→passed (fixed), failed→failed (stillFailing), present-only-in-target (added), present-only-in-base (removed), and one with `flaky:true` (flaky bucket). Assert each bucket's members.

- [ ] **Step 3:** Route `packages/server/src/routes/compare.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { compareRuns } from "../compare.js";

export function registerCompareRoutes(app: FastifyInstance, deps: AppDeps): void {
  // GET /projects/:projectId/compare?base=<runId>&target=<runId>
  app.get("/projects/:projectId/compare", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { base, target } = req.query as { base?: string; target?: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (!base || !target) return reply.code(400).send({ error: "base and target query params are required" });

    const [baseRun, targetRun] = await Promise.all([deps.runs.get(base), deps.runs.get(target)]);
    for (const [r, id] of [[baseRun, base], [targetRun, target]] as const) {
      if (!r || r.projectId !== projectId) return reply.code(404).send({ error: `run ${id} not found in project` });
      if (r.status !== "ready") return reply.code(409).send({ error: `run ${id} is not ready` });
    }

    const [baseTests, targetTests] = await Promise.all([
      deps.testResults.listByRun(base),
      deps.testResults.listByRun(target),
    ]);
    return compareRuns(
      { runId: base, createdAt: baseRun!.createdAt, tests: baseTests },
      { runId: target, createdAt: targetRun!.createdAt, tests: targetTests },
    );
  });
}
```

- [ ] **Step 4:** Register in `app.ts` (`registerCompareRoutes(api, deps)` alongside the others; add the import).

- [ ] **Step 5:** Route test `routes/compare.test.ts`: create a project, two runs (use `deps.runs.create` + `claimPending` + `markReady` to make them 'ready'), seed `deps.testResults.replaceForRun` for each with differing outcomes, then GET `/api/projects/:id/compare?base=&target=` and assert the buckets. Also assert 400 (missing params), 404 (unknown run), 409 (run not ready). Build the app with `buildApp(deps)` and use `app.inject`.

- [ ] **Step 6:** `pnpm --filter @allure-station/server typecheck && pnpm --filter @allure-station/server test compare`; commit `feat(api): GET /compare run-comparison endpoint`.

---

### Task 6: UI compare panel

**Files:** Modify `packages/web/src/api/client.ts`, `pages/Project.tsx`, `api/client.test.ts`

- [ ] **Step 1 (client):** Add to `ApiClient` + impl:

```ts
// type import: add CompareResult
compareRuns(projectId: string, base: string, target: string): Promise<CompareResult>;
// impl:
compareRuns: (projectId, base, target) =>
  json<CompareResult>(`/projects/${projectId}/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`, { method: "GET" }),
```

- [ ] **Step 2 (Project.tsx):** Add a compare panel below the trend bar. Two `<select>`s (base, target) seeded from `runs` filtered to `status === "ready"` (default: base = 2nd-newest ready, target = newest ready). A `useQuery(["compare", id, base, target], () => api.compareRuns(id, base, target), { enabled: !!base && !!target && base !== target })`. Render each non-empty bucket as a labeled list with a count badge (Newly failing, Fixed, Flaky, Still failing, Added, Removed), showing each test's `name` and `baseStatus`→`targetStatus`. Keep styling consistent with the existing inline-style approach. Guard against `base === target`.

- [ ] **Step 3 (client test):** Add a `compareRuns` test mirroring the existing `listProjects` GET test — assert it calls the right URL with `base`/`target` query params and returns the parsed body.

- [ ] **Step 4:** `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web test`; commit `feat(web): run comparison panel`.

---

### Task 7: README

**Files:** Modify `README.md`

- [ ] **Step 1:** Add a "Run comparison" subsection under the features/usage area:

```markdown
### Run comparison

`GET /api/projects/:projectId/compare?base=<runId>&target=<runId>` diffs two ready runs and returns
tests bucketed as `newlyFailing`, `fixed`, `stillFailing`, `added`, `removed`, and `flaky`. Per-test
results (`historyId`, `status`, `duration`, `flaky`) are persisted at generation time; tests are
matched across runs by Allure's stable `historyId`. The UI exposes this as a compare panel on the
project page.
```

- [ ] **Step 2:** commit `docs: run comparison`.

---

## Final verification

- [ ] `pnpm -r typecheck` clean; `pnpm -r test` green.
- [ ] Live: repository + new test_results conformance vs `postgres:16` (`PG_TEST_URL`) — confirms the migration applies and the repo works on pg.
- [ ] Final code-review of the slice; fix; push.

## Self-review notes
- All-TEXT columns: `duration` and `flaky` are stored as text and parsed in `listByRun` — keep the (de)serialization symmetric.
- `keyOf` falls back historyId→fullName→name; the spike showed historyId is always present, but the fallback prevents a crash if a future producer omits it.
- `compareRuns` is a pure function (no I/O) → unit-testable without a DB; the route just loads rows and calls it.
- `AppDeps` gains `testResults`; update every deps builder (`deps.ts`, `test-helpers.ts`) — grep `buildDeps`/`AppDeps = {` to confirm none missed (typecheck will catch it).
- Flaky bucket can overlap other buckets (it's an annotation, not exclusive) — intentional; the UI shows it as its own list.
