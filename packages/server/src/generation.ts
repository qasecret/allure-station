import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "@allure-station/worker";
import type { AppDeps } from "./app.js";

/**
 * Pull a run's raw results out of storage, generate the Awesome report,
 * push it back to storage, and update the run row. Returns when done.
 */
export async function runGeneration(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  await deps.runs.setStatus(runId, "generating");
  const jobDir = join(deps.workDir, runId);
  const resultsDir = join(jobDir, "results");
  const outDir = join(jobDir, "report");
  const historyFile = join(jobDir, "history.jsonl");

  try {
    await mkdir(resultsDir, { recursive: true });
    // hydrate raw results from storage to the local scratch dir
    await hydrateResults(deps, projectId, runId, resultsDir);

    const run = await deps.runs.get(runId);
    const { stats } = await generateReport({
      resultsDirs: [resultsDir],
      outputDir: outDir,
      historyPath: historyFile,
      reportName: run?.reportName ?? "Allure Report",
      dumps: [],
    });

    await deps.storage.putDir(`${projectId}/runs/${runId}/report`, outDir);
    await deps.runs.markReady(runId, stats, deps.now());
  } catch (err) {
    await deps.runs.markFailed(runId, deps.now());
    throw err;
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

async function hydrateResults(deps: AppDeps, projectId: string, runId: string, destDir: string): Promise<void> {
  const src = await deps.storage.resolveLocalPath(`${projectId}/runs/${runId}/results`);
  await cp(src, destDir, { recursive: true });
}
