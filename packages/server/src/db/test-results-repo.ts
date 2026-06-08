import { and, desc, eq, sql } from "drizzle-orm";
import type { TestHistoryEntry, TestStatus, TestSummary } from "@allure-station/shared";
import type { Db } from "./client.js";
import { runs, testResults } from "./schema.sqlite.js";

const HISTORY_MAX = 200;

export class TestResultRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  /** Replace all stored test rows for a run (idempotent across re-generation). Runs as sequential
   *  statements rather than a transaction: the libsql `:memory:` driver opens a fresh (empty)
   *  connection per transaction, and a failed insert is self-correcting — generation re-runs
   *  replace the rows, and a run that fails mid-persist is markFailed'd, so it's excluded from
   *  comparison until a successful regeneration. */
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
        message: t.message ?? null,
        trace: t.trace ?? null,
      })),
    );
  }

  async listByRun(runId: string): Promise<TestSummary[]> {
    // Lean projection: message/trace are intentionally excluded — the only caller (run comparison)
    // never reads them, so we avoid pulling the (potentially 16 KB) trace blobs per test. Per-test
    // error detail is served by historyByKey for the timeline view.
    const rows = await this.db
      .select({
        historyId: testResults.historyId, name: testResults.name, fullName: testResults.fullName,
        status: testResults.status, duration: testResults.duration, flaky: testResults.flaky,
      })
      .from(testResults).where(eq(testResults.runId, runId));
    return rows.map((r) => ({
      historyId: r.historyId,
      name: r.name,
      fullName: r.fullName,
      status: r.status as TestStatus,
      duration: r.duration === null ? null : Number(r.duration),
      flaky: r.flaky === "true",
    }));
  }

  /** A single test's outcome per READY run in the project, newest run first, capped at HISTORY_MAX.
   *  Matched by historyId (preferred) or fullName. flakeRate = flaky runs / runs in the window.
   *  Identity fields are read from the newest matching row, so the caller gets the test's real
   *  historyId/fullName/name regardless of which key it queried by. */
  async historyByKey(
    projectId: string,
    key: { historyId: string } | { fullName: string },
    limit: number,
  ): Promise<{ entries: TestHistoryEntry[]; flakeRate: number; latestName: string | null; latestFullName: string | null; latestHistoryId: string | null }> {
    const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), HISTORY_MAX);
    const match = "historyId" in key
      ? eq(testResults.historyId, key.historyId)
      : eq(testResults.fullName, key.fullName);
    const rows = await this.db
      .select({
        runId: runs.id, createdAt: runs.createdAt, branch: runs.branch, commit: runs.commit, ciUrl: runs.ciUrl,
        historyId: testResults.historyId, fullName: testResults.fullName, name: testResults.name,
        status: testResults.status, duration: testResults.duration,
        flaky: testResults.flaky, message: testResults.message,
        // Compute presence in SQL so the ≤16 KB trace blob is never pulled into the timeline payload;
        // the actual trace is fetched lazily via traceForRun when the user expands an entry.
        hasTrace: sql<number>`case when ${testResults.trace} is not null then 1 else 0 end`,
      })
      .from(testResults)
      .innerJoin(runs, eq(testResults.runId, runs.id))
      .where(and(eq(runs.projectId, projectId), eq(runs.status, "ready"), match))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(cap);

    // Collapse to one entry per run: a test retried within a single run yields multiple rows sharing
    // a runId. Counting rows instead of runs would skew window/flakeRate and collide the drawer's
    // per-run React keys. Keep the first (newest-ordered) row for each run.
    const seen = new Set<string>();
    const entries: TestHistoryEntry[] = [];
    for (const r of rows) {
      if (seen.has(r.runId)) continue;
      seen.add(r.runId);
      entries.push({
        runId: r.runId,
        createdAt: r.createdAt,
        branch: r.branch,
        commit: r.commit,
        ciUrl: r.ciUrl,
        status: r.status as TestStatus,
        duration: r.duration === null ? null : Number(r.duration),
        flaky: r.flaky === "true",
        message: r.message ?? null,
        hasTrace: Number(r.hasTrace) === 1,
      });
    }
    const flakyCount = entries.filter((e) => e.flaky).length;
    const top = rows[0];
    return {
      entries,
      flakeRate: entries.length ? flakyCount / entries.length : 0,
      latestName: top?.name ?? null,
      latestFullName: top?.fullName ?? null,
      latestHistoryId: top?.historyId ?? null,
    };
  }

  /** The stack trace for a single (run, test) cell — fetched lazily when a timeline entry is
   *  expanded, so the heavy blob is only transferred on demand. Project-scoped via the runs join. */
  async traceForRun(
    projectId: string,
    runId: string,
    key: { historyId: string } | { fullName: string },
  ): Promise<string | null> {
    const match = "historyId" in key
      ? eq(testResults.historyId, key.historyId)
      : eq(testResults.fullName, key.fullName);
    const [row] = await this.db
      .select({ trace: testResults.trace })
      .from(testResults)
      .innerJoin(runs, eq(testResults.runId, runs.id))
      .where(and(eq(runs.projectId, projectId), eq(runs.id, runId), match))
      .limit(1);
    return row?.trace ?? null;
  }
}
