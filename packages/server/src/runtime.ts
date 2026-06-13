import { createDb } from "./db/client.js";
import { InProcessQueue, BullMQQueue } from "@allure-station/worker";
import type { JobQueue } from "@allure-station/worker";
import { InProcessBus, RedisBus } from "./events/bus.js";
import type { EventBus } from "./events/bus.js";
import { buildDeps } from "./deps.js";
import { reconcileStale, startReconciler } from "./reconcile.js";
import { sweepRetention, startRetentionSweeper } from "./retention.js";
import { hashPassword } from "./password.js";
import type { AppConfig } from "./config.js";
import type { AppDeps } from "./app.js";

export interface Runtime {
  deps: AppDeps;
  queue: JobQueue;
  bus: EventBus;
  stopReconciler: () => void;
  stopRetention: () => void;
}

/**
 * Construct the shared per-process runtime used by both entrypoints (API `main.ts` + `worker-main.ts`):
 * driver-selected queue + event bus, an open & migrated DB, startup + periodic stale reconciliation,
 * and the assembled AppDeps. The single place the queue/bus driver decision lives. Callers wire the
 * queue processor (`wireQueue`) and — for the API — build & listen the HTTP app.
 */
export async function buildRuntime(config: AppConfig): Promise<Runtime> {
  // bullmq ⇒ multi-process ⇒ Redis queue + Redis pub/sub bus; otherwise everything in-process.
  // loadConfig validates the bullmq/REDIS_URL invariant, so config.redisUrl is set when bullmq.
  const bullmq = config.queueDriver === "bullmq";
  const queue: JobQueue = bullmq
    ? new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency })
    : new InProcessQueue(config.concurrency);
  const bus: EventBus = bullmq ? new RedisBus(config.redisUrl!) : new InProcessBus();

  const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
  await migrate();

  const deps = buildDeps(config, queue, db, bus);
  await seedAdmin(deps, config);
  await reconcileStale(deps.runs, config.generateStaleMs, Date.now());
  const stopReconciler = startReconciler(deps.runs, config.generateStaleMs);

  await sweepRetention(deps, config);
  const stopRetention = startRetentionSweeper(deps, config);

  return { deps, queue, bus, stopReconciler, stopRetention };
}

/**
 * Idempotently seed/upsert the global admin from ADMIN_EMAIL/ADMIN_PASSWORD. This is how an operator
 * bootstraps the first account; rotating ADMIN_PASSWORD across restarts resets the admin's password.
 */
async function seedAdmin(deps: AppDeps, config: AppConfig): Promise<void> {
  if (!config.adminEmail || !config.adminPassword) return;
  const hash = await hashPassword(config.adminPassword);
  await deps.users.upsertByEmail(config.adminEmail, hash, "admin", deps.now());
}

/** Register a one-shot graceful shutdown on SIGTERM/SIGINT (idempotent across both signals). */
export function installShutdown(shutdown: () => Promise<void>): void {
  let started = false;
  const run = async () => {
    if (started) return;
    started = true;
    await shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", run);
  process.on("SIGINT", run);
}

/** Run a close fn, swallowing errors — graceful shutdown is best-effort. */
export async function safeClose(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // best-effort
  }
}
