import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { createDb, ensureSchema } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { LocalDriver } from "./storage/local-driver.js";
import { InProcessQueue } from "@allure-station/worker";
import { buildApp } from "./app.js";

const config = loadConfig();
const db = createDb(resolve(config.dbFile));
ensureSchema(db);

const app = buildApp({
  projects: new ProjectRepository(db),
  runs: new RunRepository(db),
  storage: new LocalDriver(resolve(config.storageRoot)),
  queue: new InProcessQueue(config.concurrency),
  workDir: resolve(config.workDir),
  version: config.version,
  now: () => new Date().toISOString(),
  newId: () => nanoid(12),
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`allure-station listening on :${config.port}`))
  .catch((err) => { console.error(err); process.exit(1); });
