import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, ensureSchema } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { LocalDriver } from "./storage/local-driver.js";
import { InProcessQueue } from "@allure-station/worker";
import type { AppDeps } from "./app.js";

export function makeTestDeps(): AppDeps {
  const db = createDb(":memory:");
  ensureSchema(db);
  const root = mkdtempSync(join(tmpdir(), "as-srv-"));
  return {
    projects: new ProjectRepository(db),
    runs: new RunRepository(db),
    storage: new LocalDriver(join(root, "storage")),
    queue: new InProcessQueue(2),
    workDir: join(root, "work"),
    version: "test",
    now: () => "2026-06-06T00:00:00.000Z",
    newId: (() => { let n = 0; return () => `id${++n}`; })(),
  };
}
