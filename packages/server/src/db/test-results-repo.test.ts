import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";
import { ProjectRepository, RunRepository } from "./repositories.js";
import { TestResultRepository } from "./test-results-repo.js";
import type { TestSummary } from "@allure-station/shared";

type BackendHandle = {
  projects: ProjectRepository;
  runs: RunRepository;
  tests: TestResultRepository;
};

type Backend = { name: string; make: () => Promise<BackendHandle> };

// Deterministic id generator per handle (matches the deps `newId` contract).
const idGen = () => {
  let n = 0;
  return () => `t${++n}`;
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
      };
    },
  },
];

if (process.env.PG_TEST_URL) {
  const pgUrl = process.env.PG_TEST_URL;
  let shared: Awaited<ReturnType<typeof createDb>> | null = null;
  backends.push({
    name: "postgres",
    make: async () => {
      if (!shared) {
        shared = createDb("postgres", { url: pgUrl });
        await shared.migrate();
      }
      const { db } = shared;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).execute(sql`TRUNCATE test_results, runs, projects CASCADE`);
      return {
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        tests: new TestResultRepository(db, idGen()),
      };
    },
  });
}

const sample: TestSummary[] = [
  { historyId: "h-pass", name: "passing test", fullName: "suite#passing", status: "passed", duration: 1000, flaky: false },
  { historyId: "h-fail", name: "failing test", fullName: "suite#failing", status: "failed", duration: 2000, flaky: true },
  { historyId: null, name: "no-history test", fullName: null, status: "skipped", duration: null, flaky: false },
];

for (const backend of backends) {
  describe(`TestResultRepository: ${backend.name}`, () => {
    let projects: ProjectRepository;
    let runs: RunRepository;
    let tests: TestResultRepository;

    beforeEach(async () => {
      ({ projects, runs, tests } = await backend.make());
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
}
