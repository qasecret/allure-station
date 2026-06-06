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
});
