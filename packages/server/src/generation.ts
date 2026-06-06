import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "@allure-station/worker";
import type { AppDeps } from "./app.js";

/**
 * Pull a run's raw results out of storage, generate the Awesome report,
 * push it back to storage, and update the run row. Returns when done.
 */
export async function runGeneration(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  const jobDir = join(deps.workDir, runId);
  const outDir = join(jobDir, "report");

  try {
    const resultsKey = `${projectId}/runs/${runId}/results`;
    if (!(await deps.storage.exists(resultsKey))) {
      throw new Error(`no results staged for run ${runId}`);
    }
    const resultsDir = await deps.storage.resolveLocalPath(resultsKey);
    await mkdir(jobDir, { recursive: true });

    const run = await deps.runs.get(runId);
    const { stats } = await generateReport({
      resultsDirs: [resultsDir],
      outputDir: outDir,
      reportName: run?.reportName ?? "Allure Report",
      dumps: [],
    });

    const tmpKey = `${projectId}/runs/${runId}/.report.tmp`;
    await deps.storage.putDir(tmpKey, outDir);
    await deps.storage.move(tmpKey, `${projectId}/runs/${runId}/report`);
    await deps.runs.markReady(runId, stats, deps.now());
  } catch (err) {
    await deps.runs.markFailed(runId, deps.now());
    throw err;
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}
