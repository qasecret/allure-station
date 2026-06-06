import type { RunRepository } from "./db/repositories.js";

/**
 * Fail runs stuck in 'generating' longer than `staleMs`. Safe to run from any process (API or worker
 * replica) because it only abandons runs older than the staleness window — a run another process is
 * actively generating (started recently) is left untouched. Returns how many were reset.
 */
export async function reconcileStale(runs: RunRepository, staleMs: number, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - staleMs).toISOString();
  const finishedAt = new Date(nowMs).toISOString();
  const reset = await runs.failStaleGenerating(cutoff, finishedAt);
  if (reset > 0) {
    console.log(`reconciled ${reset} stale 'generating' run(s) (started >${staleMs}ms ago) to 'failed'`);
  }
  return reset;
}

/**
 * Periodically reconcile stale runs so a run is never stranded in 'generating' forever (e.g. the worker
 * that enqueued it died). The interval is unref'd so it never keeps the process alive. Returns a stop()
 * that clears the timer — call it on shutdown.
 */
export function startReconciler(runs: RunRepository, staleMs: number, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    reconcileStale(runs, staleMs, Date.now()).catch((err) => console.error("reconcile sweep failed", err));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
