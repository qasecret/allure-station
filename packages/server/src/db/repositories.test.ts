import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";
import { ProjectRepository, RunRepository } from "./repositories.js";

type BackendHandle = {
  projects: ProjectRepository;
  runs: RunRepository;
  cleanup: () => Promise<void>;
};

type Backend = {
  name: string;
  make: () => Promise<BackendHandle>;
};

const backends: Backend[] = [
  {
    name: "sqlite",
    make: async () => {
      const { db, migrate } = createDb("sqlite", { url: ":memory:" });
      await migrate();
      return {
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        cleanup: async () => {},
      };
    },
  },
];

if (process.env.PG_TEST_URL) {
  const pgUrl = process.env.PG_TEST_URL;
  // Create a single shared handle for pg (migrate once; TRUNCATE between tests)
  let sharedPgHandle: Awaited<ReturnType<typeof createDb>> | null = null;

  backends.push({
    name: "postgres",
    make: async () => {
      if (!sharedPgHandle) {
        sharedPgHandle = createDb("postgres", { url: pgUrl });
        await sharedPgHandle.migrate();
      }
      const { db } = sharedPgHandle;
      // Reset state before each test — postgres DB persists across make() calls.
      // Cast to any: Db is typed as LibSQLDatabase which lacks execute(); the pg
      // handle cast as Db at the factory retains execute() at runtime (node-postgres).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).execute(sql`TRUNCATE runs, projects CASCADE`);
      return {
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        cleanup: async () => {},
      };
    },
  });
}

for (const backend of backends) {
  describe(`repositories: ${backend.name}`, () => {
    let projects: ProjectRepository;
    let runs: RunRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ projects, runs, cleanup } = await backend.make());
    });

    // -------------------------------------------------------------------------
    // ProjectRepository tests
    // -------------------------------------------------------------------------

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

      it("remove deletes the project and cascades to its runs", async () => {
        await projects.create("del-p", "2026-06-06T00:00:00.000Z");
        await runs.create("del-p", "del-r1", "Del Report", "2026-06-06T00:00:00.000Z");

        await projects.remove("del-p");

        expect(await projects.get("del-p")).toBeNull();
        expect(await runs.get("del-r1")).toBeNull();
        expect(await runs.listByProject("del-p")).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // RunRepository tests
    // -------------------------------------------------------------------------

    describe("RunRepository", () => {
      it("creates a pending run and marks it ready with stats", async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        const run = await runs.create("p", "r1", "My Report", "2026-06-06T00:00:00.000Z");
        expect(run.status).toBe("pending");

        await runs.markReady(
          "r1",
          { total: 2, passed: 1, failed: 1, broken: 0, skipped: 0 },
          "2026-06-06T00:01:00.000Z",
        );
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
        await runs.markReady(
          "r1",
          { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:00:02.000Z",
        );
        await runs.create("p", "r2", "R", "2026-06-06T00:00:03.000Z"); // pending, excluded
        const ready = await runs.listReadyByProject("p");
        expect(ready.map((r) => r.id)).toEqual(["r1"]);
      });

      it("listReadyByProject with limit returns the most recent N, oldest-first", async () => {
        await projects.create("lim-p", "2026-06-06T00:00:00.000Z");
        await runs.create("lim-p", "lr1", "R", "2026-06-06T00:00:01.000Z");
        await runs.markReady(
          "lr1",
          { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:00:02.000Z",
        );
        await runs.create("lim-p", "lr2", "R", "2026-06-06T00:00:03.000Z");
        await runs.markReady(
          "lr2",
          { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:00:04.000Z",
        );
        await runs.create("lim-p", "lr3", "R", "2026-06-06T00:00:05.000Z");
        await runs.markReady(
          "lr3",
          { total: 3, passed: 3, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:00:06.000Z",
        );

        // With limit=2, should get the 2 newest (lr2, lr3), returned oldest-first
        const limited = await runs.listReadyByProject("lim-p", 2);
        expect(limited.map((r) => r.id)).toEqual(["lr2", "lr3"]);

        // Without limit, all 3 returned oldest-first
        const all = await runs.listReadyByProject("lim-p");
        expect(all.map((r) => r.id)).toEqual(["lr1", "lr2", "lr3"]);
      });

      it("failStaleGenerating marks 'generating' runs as failed and leaves other statuses untouched", async () => {
        await projects.create("stale-p", "2026-06-06T00:00:00.000Z");

        // Create a run in 'generating' state (simulate crash mid-generation)
        await runs.create("stale-p", "stale1", "Stale Run", "2026-06-06T00:00:00.000Z");
        await runs.claimPending("stale1"); // -> generating

        // Create a run already 'ready' — should be untouched
        await runs.create("stale-p", "ready1", "Ready Run", "2026-06-06T00:00:00.000Z");
        await runs.markReady(
          "ready1",
          { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:01:00.000Z",
        );

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
  });
}
