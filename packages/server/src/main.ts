import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { createStorage } from "./storage/factory.js";
import { InProcessQueue } from "@allure-station/worker";
import { buildApp } from "./app.js";
import { wireQueue } from "./generation.js";

const config = loadConfig();

if (config.queueDriver === "bullmq") {
  // TODO(Task 4): wire BullMQQueue here; for now this path is not supported.
  throw new Error("QUEUE_DRIVER=bullmq is not yet wired — Task 4 not implemented");
}

const queue = new InProcessQueue(config.concurrency);

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

const app = buildApp(deps);

// Wire the in-process queue processor (NOT done inside buildApp — keeps buildApp
// free of worker construction so BullMQ mode never starts a Worker in the API process).
wireQueue(deps);

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
