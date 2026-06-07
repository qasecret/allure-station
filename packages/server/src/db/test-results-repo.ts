import { and, desc, eq } from "drizzle-orm";
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
    const rows = await this.db.select().from(testResults).where(eq(testResults.runId, runId));
    return rows.map((r) => ({
      historyId: r.historyId,
      name: r.name,
      fullName: r.fullName,
      status: r.status as TestStatus,
      duration: r.duration === null ? null : Number(r.duration),
      flaky: r.flaky === "true",
      message: r.message ?? null,
      trace: r.trace ?? null,
    }));
  }

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
}
