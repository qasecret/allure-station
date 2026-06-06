import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { RunRepository } from "./db/repositories.js";
import { InProcessQueue, BullMQQueue } from "@allure-station/worker";
import { buildApp } from "./app.js";
import { wireQueue } from "./generation.js";
import { buildDeps } from "./deps.js";

const config = loadConfig();

if (config.queueDriver === "bullmq" && !config.redisUrl) {
  throw new Error("REDIS_URL is required when QUEUE_DRIVER=bullmq");
}

const queue =
  config.queueDriver === "bullmq"
    ? new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency })
    : new InProcessQueue(config.concurrency);

const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();

const runs = new RunRepository(db);
const staleReset = await runs.failStaleGenerating(new Date().toISOString());
if (staleReset > 0) console.log(`reconciled ${staleReset} stale 'generating' run(s) to 'failed'`);

const deps = buildDeps(config, queue, db);

const app = buildApp(deps);

// Wire the processor only for the in-process driver.
// In bullmq mode the API process must NOT construct a Worker — only worker-main does.
if (config.queueDriver === "inprocess") {
  wireQueue(deps);
}

const shutdown = async () => {
  try {
    await deps.queue.close();
  } catch {
    // best-effort drain
  }
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`allure-station listening on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
