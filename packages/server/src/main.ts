import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { createStorage } from "./storage/factory.js";
import { InProcessQueue } from "@allure-station/worker";
import { buildApp } from "./app.js";

const config = loadConfig();
const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();

const runs = new RunRepository(db);
const staleReset = await runs.failStaleGenerating(new Date().toISOString());
if (staleReset > 0) console.log(`reconciled ${staleReset} stale 'generating' run(s) to 'failed'`);

const app = buildApp({
  projects: new ProjectRepository(db),
  runs,
  storage: createStorage(config.storage),
  queue: new InProcessQueue(config.concurrency),
  workDir: resolve(config.workDir),
  version: config.version,
  now: () => new Date().toISOString(),
  newId: () => nanoid(12),
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`allure-station listening on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
