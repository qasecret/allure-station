import { describe, it, expect } from "vitest";
import { createDb } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { reconcileStale } from "./reconcile.js";

describe("reconcileStale", () => {
  it("fails generating runs older than staleMs and spares recently-started ones", async () => {
    const { db, migrate } = createDb("sqlite", { url: ":memory:" });
    await migrate();
    const projects = new ProjectRepository(db);
    const runs = new RunRepository(db);

    const nowMs = Date.parse("2026-06-06T01:00:00.000Z");
    const staleMs = 30 * 60 * 1000; // 30 min — cutoff is 00:30

    await projects.create("p", "2026-06-06T00:00:00.000Z");

    // Started 00:00 — 60 min ago, older than the 30-min window → abandoned
    await runs.create("p", "old", "R", "2026-06-06T00:00:00.000Z");
    await runs.claimPending("old", "2026-06-06T00:00:00.000Z");

    // Started 00:59 — 1 min ago, within the window → another process may be working it
    await runs.create("p", "fresh", "R", "2026-06-06T00:59:00.000Z");
    await runs.claimPending("fresh", "2026-06-06T00:59:00.000Z");

    const reset = await reconcileStale(runs, staleMs, nowMs);
    expect(reset).toBe(1);
    expect((await runs.get("old"))?.status).toBe("failed");
    expect((await runs.get("fresh"))?.status).toBe("generating");
  });
});
