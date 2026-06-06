import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { TestResultRepository } from "./db/test-results-repo.js";
import { LocalDriver } from "./storage/local-driver.js";
import { InProcessQueue } from "@allure-station/worker";
import type { AppDeps } from "./app.js";
import { InProcessBus } from "./events/bus.js";
import { wireQueue } from "./generation.js";

export async function makeTestDeps(): Promise<AppDeps> {
  const { db, migrate } = createDb("sqlite", { url: ":memory:" });
  await migrate();
  const root = mkdtempSync(join(tmpdir(), "as-srv-"));
  const deps: AppDeps = {
    projects: new ProjectRepository(db),
    runs: new RunRepository(db),
    testResults: new TestResultRepository(db, (() => { let n = 0; return () => `tr${++n}`; })()),
    storage: new LocalDriver(join(root, "storage")),
    queue: new InProcessQueue(2),
    bus: new InProcessBus(),
    workDir: join(root, "work"),
    version: "test",
    now: () => "2026-06-06T00:00:00.000Z",
    newId: (() => { let n = 0; return () => `id${++n}`; })(),
  };
  wireQueue(deps);
  return deps;
}
