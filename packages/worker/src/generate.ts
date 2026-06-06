import { AllureReport, resolveConfig } from "@allurereport/core";
import type { RunStats } from "@allure-station/shared";

export interface GenerateParams {
  resultsDirs: string[];
  outputDir: string;
  reportName: string;
  /** Paths to dump archives from prior runs, for trend/history continuity. */
  dumps: string[];
}

export interface GenerateResult {
  stats: RunStats;
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

  return { stats: await computeStats(report) };
}

/**
 * Derive run stats from the report's store. `AllureReport` exposes a public
 * `store` getter (`get store(): DefaultAllureStore`), and `DefaultAllureStore`
 * exposes the public async `allTestResults()` which returns the finished test
 * results. We tally by `status` ("passed" | "failed" | "broken" | "skipped" |
 * "unknown"). Confirmed against the installed `@allurereport/core@3.9.0` and
 * `@allurereport/core-api@3.9.0` type definitions — no internal/private access
 * is required. Kept isolated so the store-access detail lives in one place.
 */
async function computeStats(report: AllureReport): Promise<RunStats> {
  const results = await report.store.allTestResults();

  const stats: RunStats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };
  for (const r of results) {
    stats.total += 1;
    switch (r.status) {
      case "passed": stats.passed += 1; break;
      case "failed": stats.failed += 1; break;
      case "broken": stats.broken += 1; break;
      default: stats.skipped += 1; break;
    }
  }
  return stats;
}
