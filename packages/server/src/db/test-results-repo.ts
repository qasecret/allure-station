import { eq } from "drizzle-orm";
import type { TestStatus, TestSummary } from "@allure-station/shared";
import type { Db } from "./client.js";
import { testResults } from "./schema.sqlite.js";

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
}
