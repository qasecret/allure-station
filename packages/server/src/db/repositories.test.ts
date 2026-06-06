import { describe, it, expect, beforeEach } from "vitest";
import { createDb, ensureSchema, type Db } from "./client.js";
import { ProjectRepository, RunRepository } from "./repositories.js";

let db: Db;
let projects: ProjectRepository;
let runs: RunRepository;

beforeEach(() => {
  db = createDb(":memory:");
  ensureSchema(db);
  projects = new ProjectRepository(db);
  runs = new RunRepository(db);
});

describe("ProjectRepository", () => {
  it("creates, lists and gets projects", async () => {
    await projects.create("team-a", "2026-06-06T00:00:00.000Z");
    const all = await projects.list();
    expect(all.map((p) => p.id)).toEqual(["team-a"]);
    expect((await projects.get("team-a"))?.latestRunId).toBeNull();
  });

  it("create is idempotent-safe (throws on duplicate)", async () => {
    await projects.create("dup", "2026-06-06T00:00:00.000Z");
    await expect(projects.create("dup", "2026-06-06T00:00:00.000Z")).rejects.toThrow();
  });
});

describe("RunRepository", () => {
  it("creates a pending run and marks it ready with stats", async () => {
    await projects.create("p", "2026-06-06T00:00:00.000Z");
    const run = await runs.create("p", "r1", "My Report", "2026-06-06T00:00:00.000Z");
    expect(run.status).toBe("pending");

    await runs.markReady("r1", { total: 2, passed: 1, failed: 1, broken: 0, skipped: 0 },
      "2026-06-06T00:01:00.000Z");
    const ready = await runs.get("r1");
    expect(ready?.status).toBe("ready");
    expect(ready?.stats?.failed).toBe(1);

    expect((await projects.get("p"))?.latestRunId).toBe("r1");
  });

  it("claimPending returns true the first time and false the second time (simulates a race)", async () => {
    await projects.create("p2", "2026-06-06T00:00:00.000Z");
    await runs.create("p2", "r2", "Race Report", "2026-06-06T00:00:00.000Z");

    // First caller wins the claim
    const first = await runs.claimPending("r2");
    expect(first).toBe(true);

    // Run is now 'generating'
    const claimed = await runs.get("r2");
    expect(claimed?.status).toBe("generating");

    // Second caller loses (run is no longer 'pending')
    const second = await runs.claimPending("r2");
    expect(second).toBe(false);
  });

  it("listReadyByProject returns only ready runs, oldest-first", async () => {
    await projects.create("p", "2026-06-06T00:00:00.000Z");
    await runs.create("p", "r1", "R", "2026-06-06T00:00:01.000Z");
    await runs.markReady("r1", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:02.000Z");
    await runs.create("p", "r2", "R", "2026-06-06T00:00:03.000Z"); // pending, excluded
    const ready = await runs.listReadyByProject("p");
    expect(ready.map((r) => r.id)).toEqual(["r1"]);
  });

  it("failStaleGenerating marks 'generating' runs as failed and leaves other statuses untouched", async () => {
    await projects.create("stale-p", "2026-06-06T00:00:00.000Z");

    // Create a run in 'generating' state (simulate crash mid-generation)
    await runs.create("stale-p", "stale1", "Stale Run", "2026-06-06T00:00:00.000Z");
    await runs.claimPending("stale1"); // -> generating

    // Create a run already 'ready' — should be untouched
    await runs.create("stale-p", "ready1", "Ready Run", "2026-06-06T00:00:00.000Z");
    await runs.markReady("ready1", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:01:00.000Z");

    const now = "2026-06-06T01:00:00.000Z";
    const changed = await runs.failStaleGenerating(now);
    expect(changed).toBe(1);

    const stale = await runs.get("stale1");
    expect(stale?.status).toBe("failed");
    expect(stale?.finishedAt).toBe(now);

    // 'ready' run must be untouched
    const ready = await runs.get("ready1");
    expect(ready?.status).toBe("ready");
  });
});
