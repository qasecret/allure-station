import type { Run } from "@allure-station/shared";
import type { AppDeps } from "./app.js";
import type { AppConfig } from "./config.js";
import { recordAudit } from "./audit.js";

export async function sweepRetention(deps: AppDeps, config: AppConfig): Promise<number> {
  const projectIds = await deps.projects.listAllIds();
  let totalPruned = 0;

  for (const projectId of projectIds) {
    const override = await deps.projects.getRetention(projectId);
    const effectiveDays = override.retentionDays ?? config.retentionDays;
    const effectiveMaxRuns = override.retentionMaxRuns ?? config.retentionMaxRuns;

    if (effectiveDays === 0 && effectiveMaxRuns === 0) continue;

    const candidates = new Map<string, { run: Run; reason: string }>();

    if (effectiveDays > 0) {
      const cutoff = new Date(new Date(deps.now()).getTime() - effectiveDays * 24 * 60 * 60 * 1000).toISOString();
      const expired = await deps.runs.findExpiredByAge(projectId, cutoff);
      for (const run of expired) candidates.set(run.id, { run, reason: "retention_age" });
    }

    if (effectiveMaxRuns > 0) {
      const excess = await deps.runs.findExcessByCount(projectId, effectiveMaxRuns);
      for (const run of excess) {
        if (!candidates.has(run.id)) candidates.set(run.id, { run, reason: "retention_count" });
      }
    }

    for (const { run, reason } of candidates.values()) {
      try {
        const removed = await deps.runs.remove(run.id);
        if (!removed) continue;
        try { await deps.storage.remove(`${projectId}/runs/${run.id}`); } catch { /* best-effort */ }
        try { deps.bus.publish({ type: "run", projectId, run, deleted: true }); } catch { /* best-effort */ }
        await recordAudit(deps, {
          actorType: "system", actorId: null, actorLabel: "system",
          action: "run_pruned", targetType: "run", targetId: run.id, projectId,
          metadata: { reason, retentionDays: effectiveDays, retentionMaxRuns: effectiveMaxRuns },
        });
        totalPruned++;
      } catch (err) {
        console.warn(`retention: failed to prune run ${run.id} in ${projectId}`, err);
      }
    }
  }

  if (totalPruned > 0) {
    console.log(`retention: pruned ${totalPruned} run(s)`);
  }
  return totalPruned;
}

export function startRetentionSweeper(deps: AppDeps, config: AppConfig, intervalMs = 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await sweepRetention(deps, config); } catch (err) { console.error("retention sweep failed", err); }
    finally { running = false; }
  };
  void sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
