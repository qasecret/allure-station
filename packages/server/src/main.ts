import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { RunRepository } from "./db/repositories.js";
import { InProcessQueue, BullMQQueue } from "@allure-station/worker";
import { buildApp } from "./app.js";
import { wireQueue } from "./generation.js";
import { buildDeps } from "./deps.js";
import { reconcileStale, startReconciler } from "./reconcile.js";

// loadConfig validates the bullmq/REDIS_URL invariant, so config.redisUrl is set when driver === bullmq.
const config = loadConfig();

const queue =
  config.queueDriver === "bullmq"
    ? new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency })
    : new InProcessQueue(config.concurrency);

const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();

const runs = new RunRepository(db);
await reconcileStale(runs, config.generateStaleMs, Date.now());
const stopReconciler = startReconciler(runs, config.generateStaleMs);

const deps = buildDeps(config, queue, db);

const app = buildApp(deps);

// Wire the processor only for the in-process driver.
// In bullmq mode the API process must NOT construct a Worker — only worker-main does.
if (config.queueDriver === "inprocess") {
  wireQueue(deps);
}

const shutdown = async () => {
  stopReconciler();
  // Stop accepting new requests FIRST, then drain background jobs — otherwise a /generate arriving
  // mid-shutdown would hit an already-closed queue, get markFailed'd, and return 503.
  try {
    await app.close();
  } catch {
    // best-effort
  }
  try {
    await deps.queue.close();
  } catch {
    // best-effort drain
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`allure-station listening on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
