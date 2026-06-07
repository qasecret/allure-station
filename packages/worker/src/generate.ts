import { AllureReport, resolveConfig } from "@allurereport/core";
import type { RunStats, TestStatus, TestSummary } from "@allure-station/shared";

export interface GenerateParams {
  resultsDirs: string[];
  outputDir: string;
  reportName: string;
  /** Paths to dump archives from prior runs, for trend/history continuity. */
  dumps: string[];
}

export interface GenerateResult {
  stats: RunStats;
  /** Per-test outcomes, persisted for run comparison. */
  tests: TestSummary[];
}

/**
 * Embeds Allure 3 in-process. Mirrors the CLI's generate flow
 * (packages/cli/src/commands/commons/generate.ts) but driven programmatically.
 * Each call builds its own AllureReport (instance-scoped store/output),
 * so concurrent calls with distinct outputDir are safe.
 *
 * NOTE: `historyPath` and `historyLimit` are intentionally NOT configured.
 * Setting `historyPath` in `@allurereport/core@3.9.0` triggers `store.appendHistory()`
 * inside `report.done()`, which deadlocks when invoked programmatically outside the
 * CLI — `done()` never resolves. Dump-chaining (trend/history continuity across runs)
 * is deferred; once that feature is implemented, core must be verified to have fixed
 * the hang before re-introducing historyPath.
 */
export async function generateReport(params: GenerateParams): Promise<GenerateResult> {
  const fullConfig = await resolveConfig({
    name: params.reportName,
    output: params.outputDir,
    plugins: { awesome: { options: { reportName: params.reportName } } },
  });

  const report = new AllureReport(fullConfig);
  if (params.dumps.length) await report.restoreState(params.dumps);
  await report.start();
  for (const dir of params.resultsDirs) await report.readDirectory(dir);
  await report.done();

  return summarize(report);
}

const KNOWN_STATUSES: readonly string[] = ["passed", "failed", "broken", "skipped"];

const MESSAGE_CAP = 2 * 1024;   // bytes
const TRACE_CAP = 16 * 1024;    // bytes

/**
 * Truncate `text` to ~`capBytes` UTF-8 bytes, appending a marker when cut. Null/empty input returns
 * null (so absent error detail stores as NULL). A multibyte char split at the boundary is re-encoded
 * by `toString` as the U+FFFD replacement char, so the result stays valid UTF-8 but may run up to
 * `capBytes + 2` bytes — fine here since the storage columns are unbounded `text`, not byte-capped.
 */
export function truncate(text: string | undefined | null, capBytes: number): string | null {
  if (!text) return null;
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= capBytes) return text;
  return buf.subarray(0, capBytes).toString("utf8") + "\n…[truncated]";
}

/**
 * Derive run stats AND per-test summaries from the report's store in one pass.
 * `AllureReport` exposes a public `store` getter, and `DefaultAllureStore` exposes
 * the public async `allTestResults()`. Each result carries `historyId` (Allure's
 * stable cross-run hash), `fullName`, `status`, `duration`, and `flaky` — confirmed
 * against `@allurereport/core-api@3.9.0`. No internal/private access is required.
 */
async function summarize(report: AllureReport): Promise<GenerateResult> {
  const results = await report.store.allTestResults();

  const stats: RunStats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0, flaky: 0, durationMs: 0 };
  const tests: TestSummary[] = [];
  for (const r of results) {
    stats.total += 1;
    if (r.flaky) stats.flaky = (stats.flaky ?? 0) + 1;
    stats.durationMs = (stats.durationMs ?? 0) + (r.duration ?? 0);
    switch (r.status) {
      case "passed": stats.passed += 1; break;
      case "failed": stats.failed += 1; break;
      case "broken": stats.broken += 1; break;
      default: stats.skipped += 1; break; // skipped + unknown
    }
    const status = (KNOWN_STATUSES.includes(r.status) ? r.status : "unknown") as TestStatus;
    tests.push({
      historyId: r.historyId ?? null,
      name: r.name,
      fullName: r.fullName ?? null,
      status,
      duration: r.duration ?? null,
      flaky: r.flaky ?? false,
      message: truncate(r.error?.message, MESSAGE_CAP),
      trace: truncate(r.error?.trace, TRACE_CAP),
    });
  }
  return { stats, tests };
}
