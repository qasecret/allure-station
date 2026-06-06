import { AllureReport, resolveConfig } from "@allurereport/core";
import type { RunStats } from "@allure-station/shared";

export interface GenerateParams {
  resultsDirs: string[];
  outputDir: string;
  historyPath: string;
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
 * Each call builds its own AllureReport (instance-scoped store/output/history),
 * so concurrent calls with distinct outputDir/historyPath are safe.
 *
 * NOTE on `historyLimit: 0`: `@allurereport/core@3.9.0`'s `store.appendHistory()`
 * (the on-disk history write inside `report.done()`) deadlocks when invoked
 * programmatically outside the CLI — `done()` never resolves even though the
 * report (index.html + store) is fully produced. This was confirmed empirically:
 * with a `historyPath` set, `done()` hangs indefinitely on `appendHistory`;
 * setting `historyLimit: 0` short-circuits the history file write
 * (`appendHistory` returns early when `limit === 0`) and `done()` resolves in
 * ~150ms with a complete report. `historyPath`/`dumps` remain on the public API
 * so callers can supply trend continuity once core ships a fix.
 */
export async function generateReport(params: GenerateParams): Promise<GenerateResult> {
  const fullConfig = await resolveConfig({
    name: params.reportName,
    output: params.outputDir,
    historyPath: params.historyPath,
    historyLimit: 0,
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
