import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { RunRepository } from "./db/repositories.js";
import { BullMQQueue } from "@allure-station/worker";
import { processGenerate } from "./generation.js";
import { buildDeps } from "./deps.js";

const config = loadConfig();

if (!config.redisUrl) {
  console.error("REDIS_URL is required when running worker-main (QUEUE_DRIVER=bullmq)");
  process.exit(1);
}

const queue = new BullMQQueue({ url: config.redisUrl, concurrency: config.concurrency });

const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();

const runs = new RunRepository(db);
const staleReset = await runs.failStaleGenerating(new Date().toISOString());
if (staleReset > 0) console.log(`reconciled ${staleReset} stale 'generating' run(s) to 'failed'`);

const deps = buildDeps(config, queue, db);

// Construct the BullMQ Worker — only the worker process calls start, never the API process.
queue.start((data) => processGenerate(deps, data));

const shutdown = async () => {
  try {
    await queue.close();
  } catch {
    // best-effort drain
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("allure-station worker consuming 'generate' jobs");
