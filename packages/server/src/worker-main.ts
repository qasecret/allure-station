import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { RunRepository } from "./db/repositories.js";
import { BullMQQueue } from "@allure-station/worker";
import { wireQueue } from "./generation.js";
import { buildDeps } from "./deps.js";
import { RedisBus } from "./events/bus.js";
import { reconcileStale, startReconciler } from "./reconcile.js";

const config = loadConfig();

// worker-main is the bullmq consumer; the inprocess driver runs jobs in the API process instead.
if (config.queueDriver !== "bullmq") {
  console.error("worker-main requires QUEUE_DRIVER=bullmq");
  process.exit(1);
}

// loadConfig guarantees redisUrl is set when queueDriver === bullmq.
const queue = new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency });

// The worker only runs in bullmq mode, so it always publishes over Redis pub/sub.
const bus = new RedisBus(config.redisUrl!);

const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();

const runs = new RunRepository(db);
await reconcileStale(runs, config.generateStaleMs, Date.now());
const stopReconciler = startReconciler(runs, config.generateStaleMs);

const deps = buildDeps(config, queue, db, bus);

// Construct the BullMQ Worker — only the worker process calls start, never the API process.
// wireQueue is the single binding of processor → queue, shared with the in-process path.
wireQueue(deps);

const shutdown = async () => {
  stopReconciler();
  try {
    await queue.close();
  } catch {
    // best-effort drain
  }
  try {
    await bus.close();
  } catch {
    // best-effort
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("allure-station worker consuming 'generate' jobs");
