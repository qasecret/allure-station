import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { createStorage } from "./storage/factory.js";
import { BullMQQueue } from "@allure-station/worker";
import { processGenerate } from "./generation.js";

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

const deps = {
  projects: new ProjectRepository(db),
  runs,
  storage: createStorage(config.storage),
  queue,
  workDir: resolve(config.workDir),
  version: config.version,
  now: () => new Date().toISOString(),
  newId: () => nanoid(12),
};

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
