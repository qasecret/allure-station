import { resolve } from "node:path";
import { nanoid } from "nanoid";
import type { Db } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { createStorage } from "./storage/factory.js";
import type { AppDeps } from "./app.js";
import type { AppConfig } from "./config.js";
import type { JobQueue } from "@allure-station/worker";

/**
 * Construct the shared AppDeps from config, a pre-built queue, and an open db connection.
 * The caller is responsible for running migrations before calling this function.
 */
export function buildDeps(config: AppConfig, queue: JobQueue, db: Db): AppDeps {
  return {
    projects: new ProjectRepository(db),
    runs: new RunRepository(db),
    storage: createStorage(config.storage),
    queue,
    workDir: resolve(config.workDir),
    version: config.version,
    now: () => new Date().toISOString(),
    newId: () => nanoid(12),
  };
}
