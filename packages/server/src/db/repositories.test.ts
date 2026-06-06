import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";
import { ProjectRepository, RunRepository } from "./repositories.js";
import { TestResultRepository } from "./test-results-repo.js";
import type { TestSummary } from "@allure-station/shared";

// Deterministic id generator per handle (matches the deps `newId` contract).
const idGen = () => {
  let n = 0;
  return () => `tr${++n}`;
};

type BackendHandle = {
  projects: ProjectRepository;
  runs: RunRepository;
  tests: TestResultRepository;
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
        tests: new TestResultRepository(db, idGen()),
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
      await (db as any).execute(sql`TRUNCATE test_results, runs, projects CASCADE`);
      return {
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        tests: new TestResultRepository(db, idGen()),
        cleanup: async () => {},
      };
    },
  });
}

for (const backend of backends) {
  describe(`repositories: ${backend.name}`, () => {
    let projects: ProjectRepository;
    let runs: RunRepository;
    let tests: TestResultRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ projects, runs, tests, cleanup } = await backend.make());
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
        const first = await runs.claimPending("r2", "2026-06-06T00:00:01.000Z");
        expect(first).toBe(true);

        // Run is now 'generating'
        const claimed = await runs.get("r2");
        expect(claimed?.status).toBe("generating");

        // Second caller loses (run is no longer 'pending')
        const second = await runs.claimPending("r2", "2026-06-06T00:00:02.000Z");
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

      it("failStaleGenerating fails only generating runs older than the cutoff, leaving others untouched", async () => {
        await projects.create("stale-p", "2026-06-06T00:00:00.000Z");

        // Old generating run (started long ago — abandoned/crashed)
        await runs.create("stale-p", "stale1", "Stale Run", "2026-06-06T00:00:00.000Z");
        await runs.claimPending("stale1", "2026-06-06T00:00:00.000Z"); // -> generating, startedAt old

        // Recently-started generating run — another process may still be working it
        await runs.create("stale-p", "fresh1", "Fresh Run", "2026-06-06T00:55:00.000Z");
        await runs.claimPending("fresh1", "2026-06-06T00:59:59.000Z"); // -> generating, startedAt recent

        // 'ready' run — must be untouched regardless of age
        await runs.create("stale-p", "ready1", "Ready Run", "2026-06-06T00:00:00.000Z");
        await runs.markReady(
          "ready1",
          { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 },
          "2026-06-06T00:01:00.000Z",
        );

        // Cutoff 00:30 — stale1 (started 00:00) is before it; fresh1 (started 00:59:59) is after.
        const cutoff = "2026-06-06T00:30:00.000Z";
        const finishedAt = "2026-06-06T01:00:00.000Z";
        const changed = await runs.failStaleGenerating(cutoff, finishedAt);
        expect(changed).toBe(1);

        const stale = await runs.get("stale1");
        expect(stale?.status).toBe("failed");
        expect(stale?.finishedAt).toBe(finishedAt);

        // Recently-started generating run must survive (not abandoned under an active process)
        expect((await runs.get("fresh1"))?.status).toBe("generating");

        // 'ready' run must be untouched
        expect((await runs.get("ready1"))?.status).toBe("ready");
      });
    });

    // -------------------------------------------------------------------------
    // TestResultRepository tests (per-test rows powering run comparison)
    // -------------------------------------------------------------------------

    describe("TestResultRepository", () => {
      const sample: TestSummary[] = [
        { historyId: "h-pass", name: "passing test", fullName: "suite#passing", status: "passed", duration: 1000, flaky: false },
        { historyId: "h-fail", name: "failing test", fullName: "suite#failing", status: "failed", duration: 2000, flaky: true },
        { historyId: null, name: "no-history test", fullName: null, status: "skipped", duration: null, flaky: false },
      ];

      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        await runs.create("p", "r1", "R", "2026-06-06T00:00:00.000Z");
      });

      it("replaceForRun inserts and listByRun round-trips status/duration/flaky/null", async () => {
        await tests.replaceForRun("r1", sample);
        const got = await tests.listByRun("r1");
        expect(got).toHaveLength(3);
        const byName = Object.fromEntries(got.map((t) => [t.name, t]));
        expect(byName["passing test"]).toMatchObject({ status: "passed", duration: 1000, flaky: false, historyId: "h-pass" });
        expect(byName["failing test"]).toMatchObject({ status: "failed", duration: 2000, flaky: true });
        expect(byName["no-history test"]).toMatchObject({ status: "skipped", duration: null, flaky: false, historyId: null, fullName: null });
      });

      it("replaceForRun replaces (no duplicates) on re-generation", async () => {
        await tests.replaceForRun("r1", sample);
        await tests.replaceForRun("r1", [sample[0]]);
        const got = await tests.listByRun("r1");
        expect(got).toHaveLength(1);
        expect(got[0].name).toBe("passing test");
      });

      it("empty list clears prior rows", async () => {
        await tests.replaceForRun("r1", sample);
        await tests.replaceForRun("r1", []);
        expect(await tests.listByRun("r1")).toHaveLength(0);
      });

      it("removing the project cascades to test_results", async () => {
        await tests.replaceForRun("r1", sample);
        await projects.remove("p");
        expect(await tests.listByRun("r1")).toHaveLength(0);
      });
    });
  });
}
