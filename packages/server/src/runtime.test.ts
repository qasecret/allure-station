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
    publicUrl: undefined,
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    cookieSecure: false,
    trustProxy: false,
    branding: { name: "Allure Station", tagline: "Your test reports, beautifully hosted.", logoUrl: null },
    adminEmail: undefined,
    adminPassword: undefined,
    oidc: undefined,
    storage: { backend: "local", localRoot: join(root, "storage") },
    retentionDays: 30,
    retentionMaxRuns: 50,
  };
}

describe("buildRuntime", () => {
  it("selects in-process drivers, migrates the DB, and returns working deps", async () => {
    const { deps, queue, bus, stopReconciler, stopRetention } = await buildRuntime(testConfig());
    try {
      expect(queue).toBeInstanceOf(InProcessQueue);
      expect(bus).toBeInstanceOf(InProcessBus);
      // migrate() ran → repositories work against a real schema.
      const p = await deps.projects.create("p", deps.now());
      expect(p.id).toBe("p");
      expect(await deps.projects.get("p")).toBeTruthy();
      // No admin seeded when ADMIN_EMAIL/PASSWORD unset.
      expect(await deps.users.count()).toBe(0);
    } finally {
      stopReconciler();
      stopRetention();
      await bus.close();
      await queue.close();
    }
  });

  it("seeds (and re-upserts) the global admin from ADMIN_EMAIL/ADMIN_PASSWORD", async () => {
    const cfg = { ...testConfig(), adminEmail: "boss@x.com", adminPassword: "supersecret1" };
    const { deps, queue, bus, stopReconciler, stopRetention } = await buildRuntime(cfg);
    try {
      const admin = await deps.users.findByEmail("boss@x.com");
      expect(admin?.role).toBe("admin");
      expect(admin?.passwordHash.startsWith("scrypt$")).toBe(true);
      expect(await deps.users.count()).toBe(1);
    } finally {
      stopReconciler();
      stopRetention();
      await bus.close();
      await queue.close();
    }
  });
});
