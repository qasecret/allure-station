import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "@allure-station/worker";
import type { GenerateJobData } from "@allure-station/worker";
import type { AppDeps } from "./app.js";

/** Job processor: run a generation job from its serialized data. */
export async function processGenerate(deps: AppDeps, data: GenerateJobData): Promise<void> {
  await runGeneration(deps, data.projectId, data.runId);
}

/** Publish the current state of a run to the event bus (best-effort; never throws into the caller —
 *  in the failure path it must not mask the original generation error being re-thrown). */
async function publishRun(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  try {
    const run = await deps.runs.get(runId);
    if (run) deps.bus.publish({ type: "run", projectId, run });
  } catch (err) {
    console.error("[events] failed to publish run update:", err);
  }
}

/**
 * Wire the queue processor to deps. Call from makeTestDeps (tests) and main.ts (production),
 * NOT from buildApp — keeps buildApp free of worker construction for future BullMQ mode.
 */
export function wireQueue(deps: AppDeps): void {
  deps.queue.start((d) => processGenerate(deps, d));
}

/**
 * Pull a run's raw results out of storage, generate the Awesome report,
 * push it back to storage, and update the run row. Returns when done.
 */
export async function runGeneration(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  const resultsKey = `${projectId}/runs/${runId}/results`;
  const jobDir = join(deps.workDir, runId);
  const outDir = join(jobDir, "report");
  let materialized: { dir: string; dispose(): Promise<void> } | undefined;
  try {
    if (!(await deps.storage.exists(resultsKey))) throw new Error(`no results staged for run ${runId}`);
    materialized = await deps.storage.materializeDir(resultsKey);
    await mkdir(jobDir, { recursive: true });
    const run = await deps.runs.get(runId);
    const { stats } = await generateReport({
      resultsDirs: [materialized.dir],
      outputDir: outDir,
      reportName: run?.reportName ?? "Allure Report",
      dumps: [],
    });
    await deps.storage.putDir(`${projectId}/runs/${runId}/report`, outDir); // direct to final prefix
    await deps.runs.markReady(runId, stats, deps.now());
    await publishRun(deps, projectId, runId);
  } catch (err) {
    await deps.runs.markFailed(runId, deps.now());
    await publishRun(deps, projectId, runId);
    throw err;
  } finally {
    await materialized?.dispose();
    await rm(jobDir, { recursive: true, force: true });
  }
}
