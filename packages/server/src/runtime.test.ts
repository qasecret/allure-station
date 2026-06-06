import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntime } from "./runtime.js";
import { InProcessQueue } from "@allure-station/worker";
import { InProcessBus } from "./events/bus.js";
import type { AppConfig } from "./config.js";

function testConfig(): AppConfig {
  const root = mkdtempSync(join(tmpdir(), "as-rt-"));
  return {
    port: 0,
    db: { driver: "sqlite", url: ":memory:" },
    workDir: join(root, "work"),
    concurrency: 2,
    generateStaleMs: 30 * 60 * 1000,
    queueDriver: "inprocess",
    redisUrl: undefined,
    version: "test",
    storage: { backend: "local", localRoot: join(root, "storage") },
  };
}

describe("buildRuntime", () => {
  it("selects in-process drivers, migrates the DB, and returns working deps", async () => {
    const { deps, queue, bus, stopReconciler } = await buildRuntime(testConfig());
    try {
      expect(queue).toBeInstanceOf(InProcessQueue);
      expect(bus).toBeInstanceOf(InProcessBus);
      // migrate() ran → repositories work against a real schema.
      const p = await deps.projects.create("p", deps.now());
      expect(p.id).toBe("p");
      expect(await deps.projects.get("p")).toBeTruthy();
    } finally {
      stopReconciler();
      await bus.close();
      await queue.close();
    }
  });
});
