# Per-test history timeline + error capture (F0 + F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each test's error message/trace on ingest, and expose a single test's cross-run pass/fail timeline + flake rate, reachable from ComparePanel rows.

**Architecture:** F0 (write path) adds `message`/`trace` to `test_results` and populates them in the worker's `summarize()`. F1 (read path) adds two indexes, a project-scoped `historyByKey` repo query joining `test_results`→`runs`, a `GET …/tests/history` route behind the existing `readGate`, and a Sheet drawer opened from ComparePanel rows. New error fields use `.nullable().optional()` so existing `TestSummary` literals keep compiling (the codebase's backward-compat convention, mirroring `runSchema.branch`).

**Tech Stack:** TypeScript ESM, Fastify, Drizzle (SQLite + Postgres, dual schema), Zod contracts (`@allure-station/shared`), Vitest, React 18 + TanStack Query, shadcn/ui (Sheet/Badge/Button).

**Spec:** `docs/superpowers/specs/2026-06-07-per-test-history-design.md`

---

## File map

**F0 — store error text**
- Modify: `packages/shared/src/contracts.ts` — add `message`/`trace` to `testSummarySchema`.
- Modify: `packages/server/src/db/schema.sqlite.ts` + `schema.pg.ts` — add `message`/`trace` columns.
- Modify: `packages/server/src/db/test-results-repo.ts` — persist/round-trip the two fields.
- Modify: `packages/worker/src/generate.ts` — extract + truncate `r.error.message`/`trace`.
- Generated: `packages/server/drizzle/{sqlite,pg}/*` migrations.
- Test: `packages/server/src/db/repositories.test.ts`, `packages/worker/src/generate.test.ts`.

**F1 — timeline**
- Modify: `packages/shared/src/contracts.ts` — add `testHistoryEntrySchema` + `testHistorySchema` + types.
- Modify: `schema.sqlite.ts` + `schema.pg.ts` — add `history_id` + `full_name` indexes.
- Modify: `packages/server/src/db/test-results-repo.ts` — add `historyByKey()`.
- Create: `packages/server/src/routes/test-history.ts` (+ register in `app.ts`).
- Test: `packages/server/src/routes/test-history.test.ts`, `repositories.test.ts`.
- Modify: `packages/web/src/api/client.ts` — `getTestHistory()`.
- Modify: `packages/web/src/pages/Project.tsx` — history link on Bucket rows + `TestHistorySheet`.
- Test: `packages/web/src/api/client.test.ts`.

---

## Task 1: F0 — store error message/trace (contract + schema + repo)

**Files:**
- Modify: `packages/shared/src/contracts.ts:54-61`
- Modify: `packages/server/src/db/schema.sqlite.ts:101-112`
- Modify: `packages/server/src/db/schema.pg.ts:102-113`
- Modify: `packages/server/src/db/test-results-repo.ts`
- Test: `packages/server/src/db/repositories.test.ts:352-371`

- [ ] **Step 1: Update the failing repo round-trip test**

In `packages/server/src/db/repositories.test.ts`, replace the `sample` array (lines 352-356) and the round-trip assertions (lines 363-371) with:

```ts
      const sample: TestSummary[] = [
        { historyId: "h-pass", name: "passing test", fullName: "suite#passing", status: "passed", duration: 1000, flaky: false, message: null, trace: null },
        { historyId: "h-fail", name: "failing test", fullName: "suite#failing", status: "failed", duration: 2000, flaky: true, message: "boom", trace: "at x:1" },
        { historyId: null, name: "no-history test", fullName: null, status: "skipped", duration: null, flaky: false },
      ];
```

```ts
      it("replaceForRun inserts and listByRun round-trips status/duration/flaky/message/trace/null", async () => {
        await tests.replaceForRun("r1", sample);
        const got = await tests.listByRun("r1");
        expect(got).toHaveLength(3);
        const byName = Object.fromEntries(got.map((t) => [t.name, t]));
        expect(byName["passing test"]).toMatchObject({ status: "passed", duration: 1000, flaky: false, historyId: "h-pass", message: null, trace: null });
        expect(byName["failing test"]).toMatchObject({ status: "failed", duration: 2000, flaky: true, message: "boom", trace: "at x:1" });
        expect(byName["no-history test"]).toMatchObject({ status: "skipped", duration: null, flaky: false, historyId: null, fullName: null, message: null, trace: null });
      });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/server test src/db/repositories.test.ts`
Expected: FAIL — `message`/`trace` are `undefined` (column + repo mapping don't exist yet), or a typecheck error that `message` isn't on `TestSummary`.

- [ ] **Step 3: Add `message`/`trace` to the contract**

In `packages/shared/src/contracts.ts`, change `testSummarySchema` (lines 54-61) to:

```ts
export const testSummarySchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  status: testStatusSchema,
  duration: z.number().nullable(),
  flaky: z.boolean(),
  // Failure detail captured on ingest (F0). nullable().optional() so summaries created before this
  // field existed (and helpers that omit it) still parse — mirrors runSchema's CI-metadata fields.
  message: z.string().nullable().optional(),
  trace: z.string().nullable().optional(),
});
```

- [ ] **Step 4: Add the columns to both dialect schemas**

In `packages/server/src/db/schema.sqlite.ts`, inside the `testResults` table (after the `flaky` column, line 109), add:

```ts
  message: text("message"),          // failure message (truncated) | null
  trace: text("trace"),              // failure stack/trace (truncated) | null
```

Make the identical change in `packages/server/src/db/schema.pg.ts` (after line 110's `flaky`):

```ts
  message: text("message"),
  trace: text("trace"),
```

- [ ] **Step 5: Persist + round-trip the fields in the repo**

In `packages/server/src/db/test-results-repo.ts`, in `replaceForRun`'s value map (after `flaky:` on line 26) add:

```ts
        message: t.message ?? null,
        trace: t.trace ?? null,
```

In `listByRun`'s row map (after `flaky:` on line 39) add:

```ts
      message: r.message ?? null,
      trace: r.trace ?? null,
```

- [ ] **Step 6: Regenerate migrations for both dialects**

Run:
```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```
Expected: a new migration file appears under `packages/server/drizzle/sqlite/` and `packages/server/drizzle/pg/` adding the two columns. (In-memory test DBs apply migrations on startup.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/db/repositories.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @allure-station/shared typecheck && pnpm --filter @allure-station/server typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/contracts.ts packages/server/src/db packages/server/drizzle
git commit -m "feat(F0): store per-test error message/trace in test_results"
```

---

## Task 2: F0 — extract + truncate error text in the worker

**Files:**
- Modify: `packages/worker/src/generate.ts:47-82`
- Test: `packages/worker/src/generate.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/worker/src/generate.test.ts`, change the import (line 6) to:

```ts
import { generateReport, truncate } from "./generate.js";
```

Add these tests inside the top-level `describe` (the fixture's failing result has `statusDetails.message: "boom"` and no trace):

```ts
  it("captures the failing test's error message on ingest", async () => {
    const result = await generateReport({ resultsDirs: [fixtures], outputDir: out, reportName: "Test", dumps: [] });
    const byName = Object.fromEntries(result.tests.map((t) => [t.name, t]));
    expect(byName["failing test"].message).toBe("boom");
    expect(byName["failing test"].trace ?? null).toBeNull();
    expect(byName["passing test"].message ?? null).toBeNull();
  });

  describe("truncate", () => {
    it("returns null for empty/undefined", () => {
      expect(truncate(undefined, 10)).toBeNull();
      expect(truncate("", 10)).toBeNull();
    });
    it("passes short text through and caps long text with a marker", () => {
      expect(truncate("short", 100)).toBe("short");
      const long = "x".repeat(5000);
      const capped = truncate(long, 2048)!;
      expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(2048 + Buffer.byteLength("\n…[truncated]", "utf8"));
      expect(capped.endsWith("…[truncated]")).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @allure-station/worker test src/generate.test.ts`
Expected: FAIL — `truncate` is not exported; `message` is `undefined` on the summaries.

- [ ] **Step 3: Implement `truncate` and populate the fields**

In `packages/worker/src/generate.ts`, after the `KNOWN_STATUSES` line (line 47) add:

```ts
const MESSAGE_CAP = 2 * 1024;   // bytes
const TRACE_CAP = 16 * 1024;    // bytes

/**
 * Truncate `text` to at most `capBytes` UTF-8 bytes, appending a marker when cut. Null/empty input
 * returns null (so absent error detail stores as NULL). Re-encoding the byte slice via toString drops
 * any trailing partial multibyte char rather than emitting a broken sequence.
 */
export function truncate(text: string | undefined | null, capBytes: number): string | null {
  if (!text) return null;
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= capBytes) return text;
  return buf.subarray(0, capBytes).toString("utf8") + "\n…[truncated]";
}
```

In `summarize`, in the `tests.push({ … })` object (lines 72-79), after `flaky:` add:

```ts
      message: truncate(r.error?.message, MESSAGE_CAP),
      trace: truncate(r.error?.trace, TRACE_CAP),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @allure-station/worker test src/generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @allure-station/worker typecheck`
Expected: no errors. (`r.error` is typed on `@allurereport/core-api` `TestResult` as `{ message?, trace? }`.)

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/generate.ts packages/worker/src/generate.test.ts
git commit -m "feat(F0): capture+truncate test error message/trace in worker summarize"
```

---

## Task 3: F1 — history contracts

**Files:**
- Modify: `packages/shared/src/contracts.ts:82` (after `compareResultSchema`) and `:237-239` (type exports)

- [ ] **Step 1: Add the history schemas**

In `packages/shared/src/contracts.ts`, immediately after `compareResultSchema` closes (line 82), add:

```ts
// One run's outcome for a single test, plus that run's CI metadata — a row in the test's timeline.
export const testHistoryEntrySchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  ciUrl: z.string().nullable(),
  status: testStatusSchema,
  duration: z.number().nullable(),
  flaky: z.boolean(),
  message: z.string().nullable(),
  trace: z.string().nullable(),
});

// A single test's cross-run timeline + flake rate over the returned window (newest run first).
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

- [ ] **Step 2: Add the type exports**

In `packages/shared/src/contracts.ts`, after `export type CompareResult = …` (line 239) add:

```ts
export type TestHistoryEntry = z.infer<typeof testHistoryEntrySchema>;
export type TestHistory = z.infer<typeof testHistorySchema>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @allure-station/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/contracts.ts
git commit -m "feat(F1): add testHistory contracts"
```

---

## Task 4: F1 — `historyByKey` repo query + indexes

**Files:**
- Modify: `packages/server/src/db/test-results-repo.ts`
- Modify: `schema.sqlite.ts:110-112` + `schema.pg.ts:111-113`
- Test: `packages/server/src/db/repositories.test.ts` (new `describe` after the `TestResultRepository` block, ~line 392)

- [ ] **Step 1: Write the failing test**

In `packages/server/src/db/repositories.test.ts`, add this block right after the `TestResultRepository` describe closes (after line 392):

```ts
    describe("historyByKey (cross-run timeline)", () => {
      const mk = async (proj: string, runId: string, createdAt: string, status: TestSummary["status"], ready = true) => {
        await runs.create(proj, runId, "R", createdAt, { branch: "main", commit: "c1", ciUrl: "http://ci/" + runId });
        await runs.claimPending(runId, createdAt);
        await tests.replaceForRun(runId, [{
          historyId: "h1", name: "t", fullName: "s#t", status,
          duration: 5, flaky: status === "failed", message: status === "failed" ? "boom" : null, trace: null,
        }]);
        if (ready) await runs.markReady(runId, { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, createdAt);
      };

      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        await projects.create("other", "2026-06-06T00:00:00.000Z");
        await mk("p", "r1", "2026-06-01T00:00:00.000Z", "passed");
        await mk("p", "r2", "2026-06-02T00:00:00.000Z", "failed");
        await mk("p", "r3", "2026-06-03T00:00:00.000Z", "passed");
        await mk("other", "o1", "2026-06-02T12:00:00.000Z", "failed");           // different project
        await mk("p", "pending", "2026-06-04T00:00:00.000Z", "failed", false);   // not ready
      });

      it("returns the test's ready runs newest-first, scoped to the project, with flake rate", async () => {
        const res = await tests.historyByKey("p", { historyId: "h1" }, 50);
        expect(res.entries.map((e) => e.runId)).toEqual(["r3", "r2", "r1"]);
        expect(res.latestName).toBe("t");
        expect(res.entries[1]).toMatchObject({ runId: "r2", status: "failed", flaky: true, message: "boom", branch: "main", ciUrl: "http://ci/r2" });
        expect(res.flakeRate).toBeCloseTo(1 / 3);
      });

      it("clamps the limit to [1,200]", async () => {
        expect((await tests.historyByKey("p", { historyId: "h1" }, 1)).entries).toHaveLength(1);
        expect((await tests.historyByKey("p", { historyId: "h1" }, 9999)).entries.length).toBeLessThanOrEqual(200);
      });

      it("matches by fullName when historyId is not given", async () => {
        const res = await tests.historyByKey("p", { fullName: "s#t" }, 50);
        expect(res.entries.map((e) => e.runId)).toEqual(["r3", "r2", "r1"]);
      });
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/server test src/db/repositories.test.ts`
Expected: FAIL — `tests.historyByKey` is not a function.

- [ ] **Step 3: Add the indexes to both dialect schemas**

In `packages/server/src/db/schema.sqlite.ts`, change the `testResults` index block (lines 110-112) to:

```ts
}, (t) => ({
  byRun: index("idx_test_results_run").on(t.runId),
  byHistory: index("idx_test_results_history").on(t.historyId),
  byFullName: index("idx_test_results_fullname").on(t.fullName),
}));
```

Make the identical change in `packages/server/src/db/schema.pg.ts` (lines 111-113).

- [ ] **Step 4: Implement `historyByKey`**

In `packages/server/src/db/test-results-repo.ts`, replace the imports (lines 1-4) with:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { TestHistoryEntry, TestStatus, TestSummary } from "@allure-station/shared";
import type { Db } from "./client.js";
import { runs, testResults } from "./schema.sqlite.js";

const HISTORY_MAX = 200;
```

Add this method to the `TestResultRepository` class (after `listByRun`, before the closing brace):

```ts
  /** A single test's outcomes across the project's READY runs, newest first, capped at HISTORY_MAX.
   *  Matched by historyId (preferred) or fullName. flakeRate = flaky runs / runs in the window. */
  async historyByKey(
    projectId: string,
    key: { historyId: string } | { fullName: string },
    limit: number,
  ): Promise<{ entries: TestHistoryEntry[]; flakeRate: number; latestName: string | null }> {
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), HISTORY_MAX);
    const match = "historyId" in key
      ? eq(testResults.historyId, key.historyId)
      : eq(testResults.fullName, key.fullName);
    const rows = await this.db
      .select({
        runId: runs.id, createdAt: runs.createdAt, branch: runs.branch, commit: runs.commit, ciUrl: runs.ciUrl,
        name: testResults.name, status: testResults.status, duration: testResults.duration,
        flaky: testResults.flaky, message: testResults.message, trace: testResults.trace,
      })
      .from(testResults)
      .innerJoin(runs, eq(testResults.runId, runs.id))
      .where(and(eq(runs.projectId, projectId), eq(runs.status, "ready"), match))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(cap);

    const entries: TestHistoryEntry[] = rows.map((r) => ({
      runId: r.runId,
      createdAt: r.createdAt,
      branch: r.branch,
      commit: r.commit,
      ciUrl: r.ciUrl,
      status: r.status as TestStatus,
      duration: r.duration === null ? null : Number(r.duration),
      flaky: r.flaky === "true",
      message: r.message ?? null,
      trace: r.trace ?? null,
    }));
    const flakyCount = entries.filter((e) => e.flaky).length;
    return { entries, flakeRate: entries.length ? flakyCount / entries.length : 0, latestName: rows[0]?.name ?? null };
  }
```

- [ ] **Step 5: Regenerate migrations for both dialects**

Run:
```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```
Expected: new migration files adding the two indexes under both `drizzle/sqlite` and `drizzle/pg`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/db/repositories.test.ts`
Expected: PASS. (If `PG_TEST_URL` is set, the same block runs against Postgres too.)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @allure-station/server typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/db packages/server/drizzle
git commit -m "feat(F1): historyByKey cross-run timeline query + test_results indexes"
```

---

## Task 5: F1 — `GET /projects/:id/tests/history` route

**Files:**
- Create: `packages/server/src/routes/test-history.ts`
- Modify: `packages/server/src/app.ts:33` (import) + `:85` (register)
- Test: `packages/server/src/routes/test-history.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `packages/server/src/routes/test-history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";
import type { TestSummary } from "@allure-station/shared";

const stats = { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 };
async function readyRun(deps: AppDeps, projectId: string, runId: string, tests: TestSummary[], createdAt: string): Promise<void> {
  await deps.runs.create(projectId, runId, "R", createdAt, { branch: "main", ciUrl: "http://ci/" + runId });
  await deps.runs.claimPending(runId, createdAt);
  await deps.testResults.replaceForRun(runId, tests);
  await deps.runs.markReady(runId, stats, createdAt);
}
const sum = (status: TestSummary["status"], flaky = false, message: string | null = null): TestSummary => ({
  historyId: "h1", name: "t", fullName: "s#t", status, duration: 5, flaky, message, trace: null,
});

describe("GET /tests/history", () => {
  it("returns a test's timeline newest-first with flake rate", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    await readyRun(deps, "p", "r2", [sum("failed", true, "boom")], "2026-06-02T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries.map((e: { runId: string }) => e.runId)).toEqual(["r2", "r1"]);
    expect(body.identity).toMatchObject({ historyId: "h1", name: "t" });
    expect(body.window).toBe(2);
    expect(body.flakeRate).toBeCloseTo(0.5);
    expect(body.entries[0]).toMatchObject({ status: "failed", message: "boom", ciUrl: "http://ci/r2" });
    await app.close();
  });

  it("400 when no identity key is given", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 for a private project to an anonymous caller", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await deps.projects.setVisibility("p", "private");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("clamps limit and tolerates pre-F0 null error fields", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await deps.projects.create("p", deps.now());
    await readyRun(deps, "p", "r1", [sum("passed")], "2026-06-01T00:00:00.000Z");
    const res = await app.inject({ method: "GET", url: "/api/projects/p/tests/history?historyId=h1&limit=9999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.length).toBeLessThanOrEqual(200);
    expect(res.json().entries[0].message).toBeNull();
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/server test src/routes/test-history.test.ts`
Expected: FAIL — the route is unregistered, so the happy-path call 404s (and the 400 case 404s too).

- [ ] **Step 3: Create the route**

Create `packages/server/src/routes/test-history.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { readGate } from "./read-gate.js";

export function registerTestHistoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  // GET /projects/:projectId/tests/history?historyId=…|fullName=…&name=…&limit=50
  app.get("/projects/:projectId/tests/history", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { historyId, fullName, name, limit } = req.query as {
      historyId?: string; fullName?: string; name?: string; limit?: string;
    };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "project not found" });
    if (!historyId && !fullName) return reply.code(400).send({ error: "historyId or fullName is required" });

    const n = limit ? Number(limit) : 50;
    const cap = Number.isFinite(n) ? n : 50;
    const key = historyId ? { historyId } : { fullName: fullName! };
    const { entries, flakeRate, latestName } = await deps.testResults.historyByKey(projectId, key, cap);
    return {
      identity: { historyId: historyId ?? null, fullName: fullName ?? null, name: latestName ?? name ?? "" },
      window: entries.length,
      flakeRate,
      entries,
    };
  });
}
```

- [ ] **Step 4: Register the route**

In `packages/server/src/app.ts`, add the import after line 33 (`registerAuditRoutes`):

```ts
import { registerTestHistoryRoutes } from "./routes/test-history.js";
```

And inside the `/api` scope, after `registerAuditRoutes(api, deps);` (line 85):

```ts
      registerTestHistoryRoutes(api, deps);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/routes/test-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @allure-station/server typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/test-history.ts packages/server/src/routes/test-history.test.ts packages/server/src/app.ts
git commit -m "feat(F1): GET /tests/history route behind readGate"
```

---

## Task 6: F1 — web client + ComparePanel link + timeline drawer

**Files:**
- Modify: `packages/web/src/api/client.ts:1-4` (import), `:12-37` (interface), `:82-83` (impl)
- Modify: `packages/web/src/pages/Project.tsx` (Bucket rows + new `TestHistorySheet`)
- Test: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Write the failing client test**

In `packages/web/src/api/client.test.ts`, add after the `compareRuns` test (line 46):

```ts
  it("getTestHistory GETs /tests/history with identity + limit query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ identity: { historyId: "h1", fullName: null, name: "t" }, window: 0, flakeRate: 0, entries: [] }) });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await client.getTestHistory("p", { historyId: "h1", limit: 50 });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tests/history?historyId=h1&limit=50", expect.objectContaining({ method: "GET" }));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/web test src/api/client.test.ts`
Expected: FAIL — `client.getTestHistory` is not a function.

- [ ] **Step 3: Add `getTestHistory` to the client**

In `packages/web/src/api/client.ts`, add `TestHistory` to the type import (lines 1-4):

```ts
import type {
  Project, Run, TrendPoint, RunEvent, CompareResult, TestHistory,
  SessionUser, User, GlobalRole, MembershipWithUser, ProjectRole, AuditEntry, ProjectVisibility,
} from "@allure-station/shared";
```

Add to the `ApiClient` interface (after `compareRuns`, line 22):

```ts
  getTestHistory(projectId: string, params: { historyId?: string; fullName?: string; name?: string; limit?: number }): Promise<TestHistory>;
```

Add to the returned object (after the `compareRuns:` impl, line 83):

```ts
    getTestHistory: (projectId, params) =>
      json<TestHistory>(`/projects/${projectId}/tests/history${qs({ ...params })}`, { method: "GET" }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/web test src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the timeline drawer + history links in `Project.tsx`**

In `packages/web/src/pages/Project.tsx`, extend the type import (line 4) to include `TestDiff, TestHistoryEntry`:

```ts
import type { Run, RunStatus, TestDiff, TestHistoryEntry, TrendPoint } from "@allure-station/shared";
```

Add `History` to the existing lucide import (line 5):

```ts
import { Settings, FileBarChart, TrendingUp, GitCompareArrows, History } from "lucide-react";
```

Add the Sheet import alongside the other `@/components/ui/*` imports (line 16). `Badge` is **already imported** on line 14 — do not re-import it:

```ts
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
```

Replace the `Bucket` component (lines 233-248) with a version whose rows open the drawer. It takes an `onOpen` callback and renders a history button per row that has an identity key:

```tsx
function Bucket({ label, color, tests, onOpen }: { label: string; color: string; tests: TestDiff[]; onOpen: (t: TestDiff) => void }) {
  if (tests.length === 0) return null;
  return (
    <div className="min-w-[180px]">
      <div className={`text-sm font-semibold ${color}`}>{label} ({tests.length})</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {tests.map((t) => (
          <li key={(t.historyId ?? t.fullName ?? t.name) + label} className="flex items-center gap-1">
            <span>{t.name}{t.baseStatus && t.targetStatus ? <span className="text-muted-foreground"> ({t.baseStatus}→{t.targetStatus})</span> : null}</span>
            {(t.historyId ?? t.fullName) ? (
              <button type="button" onClick={() => onOpen(t)} aria-label={`History for ${t.name}`}
                className="text-muted-foreground hover:text-foreground">
                <History className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

In `ComparePanel`, add drawer state and pass `onOpen` to each `Bucket`. Add this near the top of `ComparePanel` (after the `diff` query, line 200):

```tsx
  const [selected, setSelected] = useState<TestDiff | null>(null);
```

Change each `<Bucket … />` (lines 220-225) to include `onOpen={setSelected}`, e.g.:

```tsx
              <Bucket label="Newly failing" color="text-status-fail" tests={diff.newlyFailing} onOpen={setSelected} />
              <Bucket label="Fixed" color="text-status-pass" tests={diff.fixed} onOpen={setSelected} />
              <Bucket label="Flaky" color="text-status-broken" tests={diff.flaky} onOpen={setSelected} />
              <Bucket label="Still failing" color="text-status-fail" tests={diff.stillFailing} onOpen={setSelected} />
              <Bucket label="Added" color="text-primary" tests={diff.added} onOpen={setSelected} />
              <Bucket label="Removed" color="text-muted-foreground" tests={diff.removed} onOpen={setSelected} />
```

Then render the drawer just before `ComparePanel`'s closing `</Card>` (after the diff `</div>`/ternary, line 228):

```tsx
        <TestHistorySheet projectId={projectId} test={selected} onClose={() => setSelected(null)} />
```

Add the new `TestHistorySheet` component after `Bucket`:

```tsx
function TestHistorySheet({ projectId, test, onClose }: { projectId: string; test: TestDiff | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["test-history", projectId, test?.historyId, test?.fullName],
    queryFn: () => api.getTestHistory(projectId, { historyId: test!.historyId ?? undefined, fullName: test!.fullName ?? undefined, name: test!.name, limit: 50 }),
    enabled: !!test && !!(test.historyId ?? test.fullName),
  });
  const statusColor: Record<string, string> = {
    passed: "text-status-pass", failed: "text-status-fail", broken: "text-status-broken",
    skipped: "text-muted-foreground", unknown: "text-muted-foreground",
  };
  return (
    <Sheet open={!!test} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">{test?.name ?? "Test history"}</SheetTitle>
        </SheetHeader>
        {!data ? <p className="mt-4 text-sm text-muted-foreground">Loading history…</p> : (
          <div className="mt-4 space-y-3">
            <Badge variant="secondary">Flaky {Math.round(data.flakeRate * 100)}% over {data.window} run{data.window === 1 ? "" : "s"}</Badge>
            <ul className="space-y-2">
              {data.entries.map((e: TestHistoryEntry) => (
                <li key={e.runId} className="rounded-lg border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${statusColor[e.status]}`}>{e.status}</span>
                    {e.flaky ? <span className="text-status-broken">flaky</span> : null}
                    <span className="text-muted-foreground">{e.createdAt}</span>
                    {e.commit ? <span className="text-muted-foreground">· {e.commit.slice(0, 7)}</span> : null}
                    {e.ciUrl ? <a href={e.ciUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">CI</a> : null}
                  </div>
                  {e.message ? <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{e.message}</pre> : null}
                </li>
              ))}
              {data.entries.length === 0 ? <li className="text-sm text-muted-foreground">No history for this test yet.</li> : null}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Typecheck + build the web package**

Run: `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web build`
Expected: no type errors; build emits `dist`. (Confirms the `@/components/ui/sheet` + `lucide-react` imports resolve.)

- [ ] **Step 7: Manual verification (the web package has no component-render test harness — only client/format unit tests)**

Run the stack and confirm the drawer:
```bash
pnpm --filter @allure-station/server dev   # API on :5050
pnpm --filter @allure-station/web dev       # Vite UI
```
Upload two result sets with at least one failing test, generate both, open the project, expand Compare, click the history icon on a row. Expected: the drawer opens, shows a flake-rate badge and a per-run timeline with the error message on failing entries and a working CI link.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api/client.ts packages/web/src/api/client.test.ts packages/web/src/pages/Project.tsx
git commit -m "feat(F1): test history drawer from ComparePanel rows"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the whole test + typecheck suite**

Run:
```bash
pnpm test
pnpm typecheck
```
Expected: all green across shared/server/worker/web.

- [ ] **Step 2: (If available) run the repo conformance suite on Postgres**

Run:
```bash
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure \
  pnpm --filter @allure-station/server test src/db/repositories.test.ts
```
Expected: `historyByKey` + round-trip tests pass on Postgres too (start the service via `docker/docker-compose.test.yml` if needed).

- [ ] **Step 3: Final commit if anything was adjusted**

```bash
git add -A && git commit -m "test(F0+F1): full suite green" || echo "nothing to commit"
```

---

## Notes / decisions baked in

- `message`/`trace` use `.nullable().optional()` so existing `TestSummary` literals (test helpers, `summarize`) keep compiling — the codebase's backward-compat convention.
- `historyByKey` filters to `runs.status = 'ready'`, scopes by `runs.project_id`, orders `created_at desc, id desc` (the run-ordering tiebreak used elsewhere), and clamps `limit` to `[1, 200]`.
- Truncation caps are bytes (message 2 KB / trace 16 KB) with a `\n…[truncated]` marker.
- The drawer is a shadcn `Sheet`; entry rows expose `historyId` (preferred) or `fullName` from `TestDiff` and omit the history button when both are null.
- Out of scope (do not add): cross-run instability metric, error full-text search, native per-run test list, clustering, attachments, pagination beyond the window.
