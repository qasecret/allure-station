# Allure Station — Phase 2a (History & Trends) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give Allure Station cross-run **history & trends** — the headline differentiator deferred from Phase 1 — by chaining each run's Allure 3 **dump archive** through `restoreState`, so the embedded Awesome report shows native trend/retry/history widgets, plus a project-level trends API + UI panel. All without tripping the core 3.9.0 `appendHistory` deadlock.

**Architecture:** Each generation produces (1) the Awesome report rendered with prior runs' data restored via `restoreState(priorDumps)`, and (2) a compact **dump archive** of the run, stored via the `StorageDriver` at `${projectId}/runs/${runId}/dump.zip`. On each generate, orchestration restores the last N prior **ready** runs' dumps so the report's native trend widgets populate. A project-level trends endpoint serves the per-run stats series already persisted in SQLite (no schema change). Crucially, we **never set `historyPath`**, so `done()` never reaches the hanging `appendHistory` — dumps are the official, deadlock-free cross-run mechanism.

**Tech Stack:** unchanged from Phase 1 — Node 20 ESM, Fastify 4, Drizzle+better-sqlite3, `@allurereport/core`+`@allurereport/plugin-awesome` 3.9.0 (pinned), React 18+Vite, Vitest. No new runtime dependencies.

**Why this approach (validated against allure3 source, core v3.9.0):**
- In `report.done()`: `if (this.#history) await this.#store.appendHistory(...)` is the hang — and `this.#history` is only constructed when `historyPath` (or an Allure-Service token) is set. **Omit `historyPath` ⇒ no `appendHistory` ⇒ no deadlock.**
- `dumpState()` writes a zip to `${this.#dump}.zip`; `restoreState(dumps: string[])` reads prior zips into the store to compute trends/retries/history. This is the official cross-runner mechanism (CLI: `allure run --dump` / `allure generate --dump=*.zip`).
- `done()` early-returns after `dumpState()` when `dump` is set (generates no report) — so capturing a run's dump is a separate, cheap pass that renders nothing.
- 3.9.0 is the latest published core (no upgrade available), so a version bump is not an option; dump-chaining sidesteps the bug entirely rather than waiting on upstream.

**Carryover from code review folded in here (touched files):** #8 — drop the redundant full result-tree copy in `hydrateResults` for the local driver (generation.ts is heavily refactored in this slice). #9 (drizzle `migrate()` vs raw DDL) and #10 (409-vs-404) remain deferred — no schema change in 2a, so #9 isn't forced.

---

## File Structure (changes)
```
packages/worker/src/generate.ts        # MODIFY: drop historyPath/historyLimit workaround; add restoreState(dumps) + optional dump capture
packages/server/src/storage/driver.ts  # (no change — putDir/putBuffer/read/exists/resolveLocalPath suffice)
packages/server/src/generation.ts      # MODIFY: chain prior dumps in, capture this run's dump out; fold #8 (no redundant copy)
packages/server/src/db/repositories.ts # MODIFY: add RunRepository.listReadyByProject() (dump chain + trend series source)
packages/server/src/routes/runs.ts     # MODIFY: add GET /projects/:id/trends
packages/server/src/routes/trends.test.ts  # NEW (or extend runs.test.ts)
packages/web/src/api/client.ts         # MODIFY: add listTrends()
packages/web/src/pages/Project.tsx     # MODIFY: add a Trends panel (pass-rate/counts over runs)
packages/worker/src/generate.test.ts   # MODIFY: add a two-run dump→restore trend test
packages/server/src/e2e.test.ts        # MODIFY (or new): two-run end-to-end trend assertion
```

---

## Task 1: Spike — confirm deadlock-free dump-chaining (DE-RISK FIRST)

**Files:** none committed (throwaway script under `/tmp`); record findings in this plan's "Spike findings" section at the end.

- [ ] **Step 1: Reproduce trend chaining without the hang.** Using the two checked-in fixtures (`packages/worker/test/fixtures/allure-results/*-result.json`), write a throwaway ESM script that, with the installed `@allurereport/core@3.9.0`:
  1. **Run A (dump only):** `const r = new AllureReport(await resolveConfig({ name:"R", output: outA, dump: dumpBaseA, plugins:{awesome:{options:{}}} }));` → `await r.start(); await r.readDirectory(fixtures); await r.done();` → confirm `done()` resolves and a file `${dumpBaseA}.zip` exists. (With `dump` set, `done()` dumps and early-returns; no report rendered — that's expected.)
  2. **Run B (report with trend, restoring A):** `const r2 = new AllureReport(await resolveConfig({ name:"R", output: outB, plugins:{awesome:{options:{}}} /* NO historyPath, NO dump */ }));` → `await r2.restoreState([dumpBaseA + ".zip"]); await r2.start(); await r2.readDirectory(fixtures); await r2.done();` → confirm `done()` resolves cleanly (NO hang, process exits 0) and `outB/index.html` exists.
  3. Inspect `outB` for trend evidence: check `outB/widgets/*.json` and the report data for a history/trend series with **2** data points (run A + run B). Identify the exact file(s)/shape that prove trends populated (e.g. a `history`/`trend`/`retries` widget json). Record the filename and structure.
- [ ] **Step 2: Confirm the report pass can ALSO emit a dump in one shot, or that two passes are required.** Try calling `r2.dumpState()` after `r2.done()` (does it work post-`done()` when `dump` was not set? it builds `${this.#dump}.zip` so it needs `dump` in config). Conclusion expected: a normal report pass cannot also dump (dump-set ⇒ early return), so **capturing a run's dump is a separate cheap pass** (Run A style). Record the definitive answer.
- [ ] **Step 3: Time it.** Record wall-clock for: report pass (restore + render) and dump-only pass. Confirm the dump-only pass is cheap (no plugin render).
- [ ] **Step 4: Record findings** in the "Spike findings" section below (exact config keys, the dump filename pattern `${dump}.zip`, the trend-evidence file, one-pass-vs-two-pass verdict). These pin down Tasks 2–4. Commit nothing from this task.

> If, contrary to expectation, `restoreState` + no-`historyPath` still hangs or trends don't populate, FALL BACK to DB-sourced trends only (Tasks 5–6 still deliver a project trends API+UI from `runs.statsJson`) and record the embedded-report-trends limitation; do not block the slice.

---

## Task 2: Worker — restore prior dumps, capture this run's dump

**Files:** Modify `packages/worker/src/generate.ts`; Modify `packages/worker/src/generate.test.ts`.

- [ ] **Step 1: Write the failing test (two-run trend via dumps).**

Add to `packages/worker/src/generate.test.ts`:
```ts
import { existsSync } from "node:fs";

describe("generateReport dump chaining", () => {
  it("captures a dump and restores it so a later run sees prior history", async () => {
    const outA = await mkdtemp(join(tmpdir(), "as-a-"));
    const dumpA = join(await mkdtemp(join(tmpdir(), "as-da-")), "runA");
    const outB = await mkdtemp(join(tmpdir(), "as-b-"));

    // Run A: produce a dump archive of the run.
    const a = await generateReport({
      resultsDirs: [fixtures], outputDir: outA, reportName: "R",
      dumps: [], dumpOutputBase: dumpA,
    });
    expect(existsSync(`${dumpA}.zip`)).toBe(true);
    expect(a.dumpPath).toBe(`${dumpA}.zip`);

    // Run B: render a report restoring run A's dump; must not hang.
    const b = await generateReport({
      resultsDirs: [fixtures], outputDir: outB, reportName: "R",
      dumps: [`${dumpA}.zip`],
    });
    await access(join(outB, "index.html"));
    expect(b.stats.total).toBe(2);
  }, 90_000);
});
```

- [ ] **Step 2: Run it — confirm failure** (`dumpOutputBase`/`dumpPath` not supported yet).
Run: `pnpm --filter @allure-station/worker test src/generate.test.ts -t "dump chaining"`

- [ ] **Step 3: Refactor `generateReport`.** Replace the historyPath/historyLimit workaround with dump-based history. Use the exact config keys the spike confirmed.
```ts
import { AllureReport, resolveConfig } from "@allurereport/core";
import type { RunStats } from "@allure-station/shared";

export interface GenerateParams {
  resultsDirs: string[];
  outputDir: string;
  reportName: string;
  /** Prior runs' dump archive paths (.zip) restored for trend/history widgets. */
  dumps: string[];
  /** When set, ALSO capture this run's dump; the archive is written to `${dumpOutputBase}.zip`. */
  dumpOutputBase?: string;
}

export interface GenerateResult {
  stats: RunStats;
  /** Path to this run's dump archive when dumpOutputBase was provided, else undefined. */
  dumpPath?: string;
}

/**
 * Render the Awesome report with prior runs' history restored, and optionally
 * capture this run's dump for future chaining. We deliberately DO NOT set
 * `historyPath`: core 3.9.0's done() hangs in appendHistory when history is
 * enabled (no upstream fix; 3.9.0 is latest). Dumps + restoreState are the
 * official, deadlock-free cross-run mechanism.
 */
export async function generateReport(params: GenerateParams): Promise<GenerateResult> {
  const reportConfig = await resolveConfig({
    name: params.reportName,
    output: params.outputDir,
    plugins: { awesome: { options: { reportName: params.reportName } } },
  });
  const report = new AllureReport(reportConfig);
  if (params.dumps.length) await report.restoreState(params.dumps);
  await report.start();
  for (const dir of params.resultsDirs) await report.readDirectory(dir);
  await report.done();
  const stats = await computeStats(report);

  let dumpPath: string | undefined;
  if (params.dumpOutputBase) {
    // Separate cheap pass: with `dump` set, done() writes `${dump}.zip` and renders nothing.
    const dumpConfig = await resolveConfig({
      name: params.reportName,
      output: `${params.dumpOutputBase}.out`, // unused scratch; dump mode renders nothing
      dump: params.dumpOutputBase,
      plugins: { awesome: { options: {} } },
    });
    const dumpReport = new AllureReport(dumpConfig);
    await dumpReport.start();
    for (const dir of params.resultsDirs) await dumpReport.readDirectory(dir);
    await dumpReport.done(); // dump set ⇒ writes `${dumpOutputBase}.zip`, early-returns
    dumpPath = `${params.dumpOutputBase}.zip`;
  }

  return { stats, dumpPath };
}
```
Keep the existing `computeStats(report)` (public `report.store.allTestResults()`) unchanged. Adjust exact `dump` config key/output handling to match the spike findings (the spike confirms whether `output` must be set in dump mode and the precise produced path).

- [ ] **Step 4: Run worker suite — green.** `pnpm --filter @allure-station/worker test`. The existing single-run test still passes; the new chaining test passes (dump created, run B renders, no hang).
- [ ] **Step 5: Commit.** `git add packages/worker && git commit -m "feat(worker): dump-based history chaining (restoreState + dump capture), drop historyPath deadlock workaround"`

---

## Task 3: Repository — list ready runs (dump chain + trend series source)

**Files:** Modify `packages/server/src/db/repositories.ts`; Modify `packages/server/src/db/repositories.test.ts`.

- [ ] **Step 1: Write the failing test.**
```ts
it("listReadyByProject returns only ready runs, oldest-first", async () => {
  await projects.create("p", "2026-06-06T00:00:00.000Z");
  await runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z");
  await runs.markReady("r1", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:02.000Z");
  await runs.create("p", "r2", "R", "2026-06-06T00:00:03.000Z"); // still pending
  const ready = await runs.listReadyByProject("p");
  expect(ready.map((r) => r.id)).toEqual(["r1"]);
});
```

- [ ] **Step 2: Run it — confirm failure** (method missing).
- [ ] **Step 3: Implement.** Add to `RunRepository`:
```ts
  /** Ready runs for a project, OLDEST first (chronological) — used for dump chaining and trend series. */
  async listReadyByProject(projectId: string): Promise<Run[]> {
    return this.db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.status, "ready")))
      .orderBy(asc(runs.createdAt))
      .all()
      .map(this.#toRun);
  }
```
Add `asc` to the drizzle import (`import { and, asc, desc, eq } from "drizzle-orm";`).

- [ ] **Step 4: Run db tests — green.** `pnpm --filter @allure-station/server test src/db`
- [ ] **Step 5: Commit.** `git add packages/server && git commit -m "feat(server): RunRepository.listReadyByProject for dump chaining + trends"`

---

## Task 4: Orchestration — chain dumps through generation

**Files:** Modify `packages/server/src/generation.ts`; Modify `packages/server/src/routes/results.test.ts` (extend e2e to two runs).

- [ ] **Step 1: Implement chaining + dump capture + fold #8.** Rewrite `runGeneration`:
```ts
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "@allure-station/worker";
import type { AppDeps } from "./app.js";

export async function runGeneration(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  const jobDir = join(deps.workDir, runId);
  const outDir = join(jobDir, "report");
  const dumpsDir = join(jobDir, "dumps");
  const dumpBase = join(jobDir, "this-run"); // produces `${dumpBase}.zip`

  try {
    await mkdir(dumpsDir, { recursive: true });

    // #8: for the local driver, read results straight from storage (no redundant copy).
    const resultsDir = await deps.storage.resolveLocalPath(`${projectId}/runs/${runId}/results`);

    // Restore prior ready runs' dumps (newest few) so the report shows trends.
    const priorReady = await deps.runs.listReadyByProject(projectId);
    const priorDumps: string[] = [];
    for (const prior of priorReady) {
      const key = `${projectId}/runs/${prior.id}/dump.zip`;
      if (await deps.storage.exists(key)) {
        const local = join(dumpsDir, `${prior.id}.zip`);
        await cp(await deps.storage.resolveLocalPath(key), local);
        priorDumps.push(local);
      }
    }

    const run = await deps.runs.get(runId);
    const { stats, dumpPath } = await generateReport({
      resultsDirs: [resultsDir],
      outputDir: outDir,
      reportName: run?.reportName ?? "Allure Report",
      dumps: priorDumps,
      dumpOutputBase: dumpBase,
    });

    // Publish report atomically (Phase 1 pattern) and persist this run's dump.
    const tmpKey = `${projectId}/runs/${runId}/.report.tmp`;
    await deps.storage.putDir(tmpKey, outDir);
    await deps.storage.move(tmpKey, `${projectId}/runs/${runId}/report`);
    if (dumpPath) {
      const { readFile } = await import("node:fs/promises");
      await deps.storage.putBuffer(`${projectId}/runs/${runId}/dump.zip`, await readFile(dumpPath));
    }

    await deps.runs.markReady(runId, stats, deps.now());
  } catch (err) {
    await deps.runs.markFailed(runId, deps.now());
    throw err;
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}
```
(Status is claimed `pending→generating` by the `/generate` route before this runs — do not re-set it here. The redundant `hydrateResults` helper is removed: #8.)

Add `move` and `putBuffer`/`exists`/`resolveLocalPath` already exist on the driver. The dynamic `readFile` import is fine; or hoist it to the top static import.

- [ ] **Step 2: Extend the e2e to two runs (trend persists).** In `results.test.ts`, after the first run is ready, upload the fixtures again (a second run) under the same project, generate, and assert: the second run is `ready` with stats, AND `storage.exists("${projectId}/runs/<run1>/dump.zip")` is true (dump captured) — proving the chain input exists. (Detailed embedded-trend assertion lives in the e2e test, Task 7.)

- [ ] **Step 3: Run full server suite — green.** `pnpm --filter @allure-station/server test`
- [ ] **Step 4: Commit.** `git add packages/server && git commit -m "feat(server): chain prior run dumps through generation for trends; capture per-run dump; drop redundant results copy (#8)"`

---

## Task 5: API — project trends endpoint

**Files:** Modify `packages/shared/src/contracts.ts` (a `trendPointSchema`); Modify `packages/server/src/routes/runs.ts`; New `packages/server/src/routes/trends.test.ts`.

- [ ] **Step 1: Add the contract.** In `contracts.ts`:
```ts
export const trendPointSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  stats: runStatsSchema,
});
export type TrendPoint = z.infer<typeof trendPointSchema>;
```

- [ ] **Step 2: Write the failing test** `packages/server/src/routes/trends.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("trends route", () => {
  it("returns ready runs as an oldest-first stats series", async () => {
    const deps = makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z");
    await deps.runs.markReady("r1", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:02.000Z");

    const res = await app.inject({ method: "GET", url: "/api/projects/p/trends" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { runId: "r1", createdAt: "2026-06-06T00:00:01.000Z", stats: { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 } },
    ]);
    await app.close();
  });
});
```

- [ ] **Step 3: Implement the route.** In `runs.ts` `registerRunRoutes`, add:
```ts
  app.get("/projects/:projectId/trends", async (req) => {
    const { projectId } = req.params as { projectId: string };
    const ready = await deps.runs.listReadyByProject(projectId);
    return ready.map((r) => ({ runId: r.id, createdAt: r.createdAt, stats: r.stats }));
  });
```
(`r.stats` is non-null for ready runs.)

- [ ] **Step 4: Run server suite — green.** `pnpm --filter @allure-station/server test`
- [ ] **Step 5: Commit.** `git add packages/server packages/shared && git commit -m "feat(server): GET /projects/:id/trends + shared TrendPoint contract"`

---

## Task 6: UI — trends panel + typed client

**Files:** Modify `packages/web/src/api/client.ts`; Modify `packages/web/src/pages/Project.tsx`.

- [ ] **Step 1: Client method.** Add to `ApiClient` + `createClient`:
```ts
  listTrends(projectId: string): Promise<TrendPoint[]>;
  // ...
  listTrends: (projectId) => json<TrendPoint[]>(`/projects/${projectId}/trends`, { method: "GET" }),
```
Import `TrendPoint` from `@allure-station/shared`.

- [ ] **Step 2: Trends panel in `Project.tsx`.** Add a `useQuery({ queryKey: ["trends", id], queryFn: () => api.listTrends(id) })` and render a compact inline SVG bar/sparkline of pass-rate per run (passed/total) with failed counts, above or beside the report iframe. Keep it dependency-free (inline SVG, no chart lib in 2a). Example renderer:
```tsx
function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <span style={{ color: "#888" }}>Trends appear after 2+ runs.</span>;
  return (
    <svg width={Math.min(points.length * 14, 420)} height={40} role="img" aria-label="pass-rate trend">
      {points.map((p, i) => {
        const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
        const h = Math.round(rate * 36) + 2;
        return <rect key={p.runId} x={i * 14} y={40 - h} width={10} height={h}
          fill={p.stats.failed ? "#d9534f" : "#5cb85c"}><title>{`${p.stats.passed}/${p.stats.total}`}</title></rect>;
      })}
    </svg>
  );
}
```
Wire it into the project header area.

- [ ] **Step 3: Typecheck + build.** `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web build`
- [ ] **Step 4: Commit.** `git add packages/web && git commit -m "feat(web): project trends panel + listTrends client"`

---

## Task 7: End-to-end — two runs show a trend

**Files:** Modify `packages/server/src/e2e.test.ts`.

- [ ] **Step 1: Two-run e2e.** Extend the e2e: create project → upload+generate run 1 (ready) → upload+generate run 2 (ready). Assert:
  - both runs are `ready` with stats `{total:2,passed:1,failed:1}`;
  - `GET /api/projects/:id/trends` returns **2** points, oldest-first;
  - run 1's dump exists in storage (`deps.storage.exists("${proj}/runs/<run1>/dump.zip")`), confirming the chain input;
  - run 2's served report (`/report/index.html`) is 200 (rendered with run 1 restored). Optionally assert a trend-widget json the spike identified contains 2 data points.
- [ ] **Step 2: Whole suite + typecheck — green.** `pnpm test` and `pnpm typecheck` at root (all 4 packages).
- [ ] **Step 3: Commit.** `git add packages/server && git commit -m "test: two-run end-to-end history/trend chain"`

---

## Self-Review (spec coverage)
- **Deadlock fix:** Tasks 1–2 — omit `historyPath`, use dumps; `done()` no longer reaches `appendHistory`.
- **Persistent history:** Tasks 2,4 — per-run dump captured + stored; restored on later runs.
- **Embedded report trends:** Tasks 1,4,7 — Awesome native trend/retry widgets via `restoreState`.
- **Project trends API+UI:** Tasks 5,6 — DB-sourced series (no schema change) + UI panel.
- **Carryover #8:** Task 4 — redundant local copy removed.

## Out of scope for 2a (later slices)
- S3 driver, content-addressed dedupe, Postgres, BullMQ/Redis queue, live `watch` (Slices 2b/2c).
- Per-test flaky detection across runs (needs per-test persistence) — Phase 3.
- Duration/flakiness trend metrics — needs extending `RunStats`; Phase 3.
- Carryover #9 (drizzle `migrate()`), #10 (409-vs-404) — no schema change here, deferred.

## Risks
1. **Spike could disprove no-hang dump-chaining** (low likelihood given source analysis). Fallback: DB-sourced trends only (Tasks 5–6 still ship), embedded-report trends deferred — recorded, slice still delivers value.
2. **Dump size / chain length:** restoring all prior dumps grows with run count. 2a restores all ready runs; add a cap (e.g. last 20) if the spike shows large dumps or slow restore — make the cap a constant in `generation.ts`.
3. **Two-pass generation cost:** the dump-only pass renders nothing (cheap), but parses results twice. Acceptable for 2a; revisit if profiling shows it matters.

## Spike findings (fill in during Task 1)
- Dump config keys used: _TBD_
- Produced dump path pattern: _TBD (expected `${dump}.zip`)_
- Trend-evidence file in report output: _TBD_
- One-pass vs two-pass verdict: _TBD (expected two-pass)_
- done() resolves without hang when historyPath omitted: _TBD (expected yes)_
