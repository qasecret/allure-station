import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb } from "./client.js";
import type { Db } from "./client.js";
import { testResults } from "./schema.sqlite.js";
import { ProjectRepository, RunRepository } from "./repositories.js";
import { TestResultRepository } from "./test-results-repo.js";
import { ApiTokenRepository } from "./api-tokens-repo.js";
import { NotificationRepository } from "./notifications-repo.js";
import { UserRepository } from "./user-repo.js";
import { SessionRepository } from "./session-repo.js";
import { MembershipRepository } from "./membership-repo.js";
import { AuditRepository } from "./audit-repo.js";
import type { TestSummary } from "@allure-station/shared";

// Deterministic id generator per handle (matches the deps `newId` contract).
const idGen = () => {
  let n = 0;
  return () => `tr${++n}`;
};

type BackendHandle = {
  db: Db; // raw handle for asserting persisted columns that no repo reader echoes back yet
  projects: ProjectRepository;
  runs: RunRepository;
  tests: TestResultRepository;
  tokens: ApiTokenRepository;
  notifs: NotificationRepository;
  users: UserRepository;
  sessions: SessionRepository;
  members: MembershipRepository;
  audit: AuditRepository;
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
        db,
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        tests: new TestResultRepository(db, idGen()),
        tokens: new ApiTokenRepository(db, idGen()),
        notifs: new NotificationRepository(db, idGen()),
        users: new UserRepository(db, idGen()),
        sessions: new SessionRepository(db, idGen()),
        members: new MembershipRepository(db, idGen()),
        audit: new AuditRepository(db, idGen()),
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
      await (db as any).execute(sql`TRUNCATE audit_log, memberships, sessions, users, notifications, api_tokens, test_results, runs, projects CASCADE`);
      return {
        db,
        projects: new ProjectRepository(db),
        runs: new RunRepository(db),
        tests: new TestResultRepository(db, idGen()),
        tokens: new ApiTokenRepository(db, idGen()),
        notifs: new NotificationRepository(db, idGen()),
        users: new UserRepository(db, idGen()),
        sessions: new SessionRepository(db, idGen()),
        members: new MembershipRepository(db, idGen()),
        audit: new AuditRepository(db, idGen()),
        cleanup: async () => {},
      };
    },
  });
}

for (const backend of backends) {
  describe(`repositories: ${backend.name}`, () => {
    let db: Db;
    let projects: ProjectRepository;
    let runs: RunRepository;
    let tests: TestResultRepository;
    let tokens: ApiTokenRepository;
    let notifs: NotificationRepository;
    let users: UserRepository;
    let sessions: SessionRepository;
    let members: MembershipRepository;
    let audit: AuditRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, projects, runs, tests, tokens, notifs, users, sessions, members, audit, cleanup } = await backend.make());
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

      it("list({q}) substring-searches by id with wildcards escaped", async () => {
        for (const id of ["alpha", "a_b", "axb", "beta"]) await projects.create(id, "2026-06-06T00:00:00.000Z");
        expect((await projects.list({ q: "lph" })).map((p) => p.id)).toEqual(["alpha"]);
        // '_' must be escaped — search "a_b" matches only the literal "a_b", not "axb".
        expect((await projects.list({ q: "a_b" })).map((p) => p.id)).toEqual(["a_b"]);
        expect(await projects.count({ q: "a_b" })).toBe(1);
        expect(await projects.count()).toBe(4);
      });

      it("visibility defaults to public, setVisibility flips it, and list/count scope filters", async () => {
        await projects.create("pub", "2026-06-06T00:00:00.000Z");
        await projects.create("prv", "2026-06-06T00:00:00.000Z");
        await projects.setVisibility("prv", "private");
        expect((await projects.get("pub"))?.visibility).toBe("public");
        expect((await projects.get("prv"))?.visibility).toBe("private");

        expect((await projects.list({ scope: { mode: "public" } })).map((p) => p.id)).toEqual(["pub"]);
        expect(await projects.count({ scope: { mode: "public" } })).toBe(1);
        expect((await projects.list({ scope: { mode: "all" } })).map((p) => p.id).sort()).toEqual(["prv", "pub"]);
        expect((await projects.list({ scope: { mode: "member", projectIds: ["prv"] } })).map((p) => p.id).sort()).toEqual(["prv", "pub"]);
        expect((await projects.list({ scope: { mode: "member", projectIds: [] } })).map((p) => p.id)).toEqual(["pub"]);
        expect((await projects.list()).map((p) => p.id).sort()).toEqual(["prv", "pub"]); // no scope → all (back-compat)
      });

      it("quality gate config round-trips and clears", async () => {
        await projects.create("qg", "2026-06-06T00:00:00.000Z");
        expect(await projects.getQualityGate("qg")).toBeNull();
        await projects.setQualityGate("qg", { maxFailures: 0, minPassRate: 0.9 });
        expect(await projects.getQualityGate("qg")).toEqual({ maxFailures: 0, minPassRate: 0.9 });
        await projects.setQualityGate("qg", null);
        expect(await projects.getQualityGate("qg")).toBeNull();
      });

      it("list({limit,offset}) windows results in id order", async () => {
        for (const id of ["p1", "p2", "p3", "p4", "p5"]) await projects.create(id, "2026-06-06T00:00:00.000Z");
        expect((await projects.list({ limit: 2 })).map((p) => p.id)).toEqual(["p1", "p2"]);
        expect((await projects.list({ limit: 2, offset: 2 })).map((p) => p.id)).toEqual(["p3", "p4"]);
        expect((await projects.list({ limit: 2, offset: 4 })).map((p) => p.id)).toEqual(["p5"]);
        // offset without limit must not emit OFFSET-without-LIMIT (a SQLite syntax error) — offset is ignored.
        expect((await projects.list({ offset: 3 })).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
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

      it("markFailed stores a (truncated) error; retryFailed clears it and re-claims; markReady clears it", async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        await runs.create("p", "rf", "R", "2026-06-06T00:00:00.000Z");

        await runs.markFailed("rf", "2026-06-06T00:01:00.000Z", "x".repeat(5000));
        const failed = await runs.get("rf");
        expect(failed?.status).toBe("failed");
        expect(failed?.error).toHaveLength(2000); // truncated
        expect(failed?.finishedAt).toBe("2026-06-06T00:01:00.000Z");

        // retry re-claims a failed run, clearing error + finishedAt
        expect(await runs.retryFailed("rf", "2026-06-06T00:02:00.000Z")).toBe(true);
        const retrying = await runs.get("rf");
        expect(retrying?.status).toBe("generating");
        expect(retrying?.error).toBeNull();
        expect(retrying?.finishedAt).toBeNull();
        // a non-failed run can't be re-claimed for retry
        expect(await runs.retryFailed("rf", "2026-06-06T00:03:00.000Z")).toBe(false);

        // a subsequent success clears any lingering error
        await runs.markFailed("rf", "2026-06-06T00:04:00.000Z", "boom");
        await runs.markReady("rf", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:05:00.000Z");
        expect((await runs.get("rf"))?.error).toBeNull();
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

      it("previousReadyBefore returns the prior ready run", async () => {
        await projects.create("pr", "2026-06-06T00:00:00.000Z");
        const mk = async (id: string, t: string) => {
          await runs.create("pr", id, "R", t);
          await runs.claimPending(id, t);
          await runs.markReady(id, { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, t);
        };
        await mk("r1", "2026-06-06T00:00:01.000Z");
        await mk("r2", "2026-06-06T00:00:02.000Z");
        expect((await runs.previousReadyBefore("pr", "2026-06-06T00:00:02.000Z"))?.id).toBe("r1");
        expect(await runs.previousReadyBefore("pr", "2026-06-06T00:00:01.000Z")).toBeNull(); // nothing before r1
      });

      it("persists + returns run metadata (empty → null) and filters/counts by branch", async () => {
        await projects.create("m", "2026-06-06T00:00:00.000Z");
        await runs.create("m", "rm1", "R", "2026-06-06T00:00:01.000Z", { branch: "main", commit: "abc123", environment: "staging", ciUrl: "https://ci/1" });
        await runs.create("m", "rm2", "R", "2026-06-06T00:00:02.000Z", { branch: "feature" });
        await runs.create("m", "rm3", "R", "2026-06-06T00:00:03.000Z"); // no metadata
        await runs.create("m", "rm4", "R", "2026-06-06T00:00:04.000Z", { branch: "" }); // empty → null

        expect(await runs.get("rm1")).toMatchObject({ branch: "main", commit: "abc123", environment: "staging", ciUrl: "https://ci/1" });
        expect(await runs.get("rm3")).toMatchObject({ branch: null, commit: null, environment: null, ciUrl: null });
        expect((await runs.get("rm4"))?.branch).toBeNull();

        expect((await runs.listByProject("m", { branch: "main" })).map((r) => r.id)).toEqual(["rm1"]);
        expect(await runs.countByProject("m", { branch: "feature" })).toBe(1);
        expect(await runs.countByProject("m")).toBe(4);
      });

      it("listByProject filters by status and paginates; countByProject counts", async () => {
        await projects.create("f", "2026-06-06T00:00:00.000Z");
        await runs.create("f", "f1", "R", "2026-06-06T00:00:01.000Z");
        await runs.create("f", "f2", "R", "2026-06-06T00:00:02.000Z");
        await runs.claimPending("f2", "2026-06-06T00:00:03.000Z");
        await runs.markReady("f2", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-06T00:00:04.000Z");
        await runs.create("f", "f3", "R", "2026-06-06T00:00:05.000Z");

        expect((await runs.listByProject("f", { status: "pending" })).map((r) => r.id).sort()).toEqual(["f1", "f3"]);
        expect((await runs.listByProject("f", { status: "ready" })).map((r) => r.id)).toEqual(["f2"]);
        expect(await runs.countByProject("f")).toBe(3);
        expect(await runs.countByProject("f", { status: "pending" })).toBe(2);
        // newest-first; limit/offset window
        expect((await runs.listByProject("f", { limit: 1 })).map((r) => r.id)).toEqual(["f3"]);
        expect((await runs.listByProject("f", { limit: 1, offset: 1 })).map((r) => r.id)).toEqual(["f2"]);
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
        { historyId: "h-pass", name: "passing test", fullName: "suite#passing", status: "passed", duration: 1000, flaky: false, message: null, trace: null, severity: "critical", owner: "alice", suite: "checkout", tags: ["smoke", "regression"], muted: false, known: false },
        { historyId: "h-fail", name: "failing test", fullName: "suite#failing", status: "failed", duration: 2000, flaky: true, message: "boom", trace: "at x:1", severity: "blocker", owner: null, suite: "checkout", tags: [], muted: true, known: true },
        { historyId: null, name: "no-history test", fullName: null, status: "skipped", duration: null, flaky: false },
      ];

      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        await runs.create("p", "r1", "R", "2026-06-06T00:00:00.000Z");
      });

      // listByRun is the lean comparison reader (no message/trace); message/trace persistence is
      // covered by the historyByKey timeline test below.
      it("replaceForRun inserts and listByRun round-trips status/duration/flaky/null", async () => {
        await tests.replaceForRun("r1", sample);
        const got = await tests.listByRun("r1");
        expect(got).toHaveLength(3);
        const byName = Object.fromEntries(got.map((t) => [t.name, t]));
        expect(byName["passing test"]).toMatchObject({ status: "passed", duration: 1000, flaky: false, historyId: "h-pass" });
        expect(byName["failing test"]).toMatchObject({ status: "failed", duration: 2000, flaky: true });
        expect(byName["no-history test"]).toMatchObject({ status: "skipped", duration: null, flaky: false, historyId: null, fullName: null });
      });

      // The slice-able dimensions are persisted for future trends/filter + known-issues consumers but
      // intentionally not echoed by listByRun (the lean comparison reader). Assert the stored columns
      // directly so we verify the write + encoding without widening the hot path.
      it("replaceForRun persists the slice-able dimensions (severity/owner/suite/tags) and muted/known flags", async () => {
        await tests.replaceForRun("r1", sample);
        const rows = await db.select().from(testResults).where(eq(testResults.runId, "r1"));
        const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
        // tags persists as a JSON string; an empty/absent tag list is stored as NULL; muted/known as "true"/"false".
        expect(byName["passing test"]).toMatchObject({ severity: "critical", owner: "alice", suite: "checkout", tags: JSON.stringify(["smoke", "regression"]), muted: "false", known: "false" });
        expect(byName["failing test"]).toMatchObject({ severity: "blocker", owner: null, suite: "checkout", tags: null, muted: "true", known: "true" });
        // A summary persisted without the new fields stores NULL for the dimensions and "false" for the flags.
        expect(byName["no-history test"]).toMatchObject({ severity: null, owner: null, suite: null, tags: null, muted: "false", known: "false" });
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

    // -------------------------------------------------------------------------
    // ApiTokenRepository tests
    // -------------------------------------------------------------------------

    describe("ApiTokenRepository", () => {
      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
      });

      it("create + listByProject does not leak the hash, counts, and resolves by hash", async () => {
        const tok = await tokens.create("p", "ci", "hash-abc", "ast_abc123", "2026-06-06T00:00:01.000Z");
        expect(tok).toMatchObject({ projectId: "p", name: "ci", prefix: "ast_abc123", lastUsedAt: null });
        const listed = await tokens.listByProject("p");
        expect(listed).toHaveLength(1);
        expect(listed[0]).not.toHaveProperty("tokenHash");
        expect(await tokens.countByProject("p")).toBe(1);
        expect(await tokens.findByHash("hash-abc")).toEqual({ id: tok.id, projectId: "p" });
        expect(await tokens.findByHash("nope")).toBeNull();
      });

      it("remove is project-scoped and reports whether a row was deleted", async () => {
        const tok = await tokens.create("p", "ci", "h", "pre", "2026-06-06T00:00:01.000Z");
        expect(await tokens.remove("other", tok.id)).toBe(false); // wrong project
        expect(await tokens.remove("p", tok.id)).toBe(true);
        expect(await tokens.countByProject("p")).toBe(0);
      });

      it("removing the project cascades to api_tokens", async () => {
        await tokens.create("p", "ci", "h", "pre", "2026-06-06T00:00:01.000Z");
        await projects.remove("p");
        expect(await tokens.countByProject("p")).toBe(0);
      });
    });

    // -------------------------------------------------------------------------
    // NotificationRepository tests
    // -------------------------------------------------------------------------

    describe("NotificationRepository", () => {
      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
      });

      it("create + listByProject round-trips events; countByProject counts", async () => {
        const n = await notifs.create("p", "slack", "https://hooks.example/x", ["failed", "regression"], "2026-06-06T00:00:01.000Z");
        expect(n).toMatchObject({ projectId: "p", kind: "slack", url: "https://hooks.example/x", events: ["failed", "regression"] });
        const list = await notifs.listByProject("p");
        expect(list).toHaveLength(1);
        expect(list[0].events).toEqual(["failed", "regression"]);
        expect(await notifs.countByProject("p")).toBe(1);
      });

      it("get is project-scoped and round-trips events; null when absent or wrong project", async () => {
        const n = await notifs.create("p", "slack", "https://h/x", ["failed"], "2026-06-06T00:00:01.000Z");
        expect(await notifs.get("p", n.id)).toMatchObject({ id: n.id, kind: "slack", events: ["failed"] });
        expect(await notifs.get("other", n.id)).toBeNull();
        expect(await notifs.get("p", "nope")).toBeNull();
      });

      it("remove is project-scoped", async () => {
        const n = await notifs.create("p", "webhook", "https://h/x", ["completed"], "2026-06-06T00:00:01.000Z");
        expect(await notifs.remove("other", n.id)).toBe(false);
        expect(await notifs.remove("p", n.id)).toBe(true);
        expect(await notifs.countByProject("p")).toBe(0);
      });

      it("removing the project cascades to notifications", async () => {
        await notifs.create("p", "webhook", "https://h/x", ["completed"], "2026-06-06T00:00:01.000Z");
        await projects.remove("p");
        expect(await notifs.countByProject("p")).toBe(0);
      });
    });

    // -------------------------------------------------------------------------
    // UserRepository / SessionRepository / MembershipRepository (Phase 5b)
    // -------------------------------------------------------------------------

    describe("UserRepository", () => {
      it("create + findByEmail/findById + list + count; email is unique", async () => {
        const u = await users.create("a@x.com", "scrypt$aa$bb", "admin", "2026-06-06T00:00:00.000Z");
        expect(u).toMatchObject({ email: "a@x.com", role: "admin" });
        expect(await users.findByEmail("a@x.com")).toMatchObject({ id: u.id, passwordHash: "scrypt$aa$bb" });
        expect((await users.findById(u.id))?.email).toBe("a@x.com");
        expect(await users.count()).toBe(1);
        await expect(users.create("a@x.com", "h", "user", "2026-06-06T00:00:00.000Z")).rejects.toThrow();
      });

      it("upsertByEmail inserts then updates password/role in place", async () => {
        const first = await users.upsertByEmail("admin@x.com", "h1", "admin", "2026-06-06T00:00:00.000Z");
        const second = await users.upsertByEmail("admin@x.com", "h2", "admin", "2026-06-06T00:01:00.000Z");
        expect(second.id).toBe(first.id);
        expect((await users.findByEmail("admin@x.com"))?.passwordHash).toBe("h2");
        expect(await users.count()).toBe(1);
      });

      it("remove deletes the user and cascades to its sessions and memberships", async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        const u = await users.create("u@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        await sessions.create("sess-hash", u.id, "2026-06-06T00:00:00.000Z", "2026-06-13T00:00:00.000Z");
        await members.upsert("p", u.id, "viewer", "2026-06-06T00:00:00.000Z");

        expect(await users.remove(u.id)).toBe(true);
        expect(await users.findById(u.id)).toBeNull();
        expect(await sessions.findByHash("sess-hash")).toBeNull();
        expect(await members.find("p", u.id)).toBeNull();
        expect(await users.remove(u.id)).toBe(false); // already gone
      });
    });

    describe("SessionRepository", () => {
      it("create + findByHash + removeByHash + deleteExpired", async () => {
        const u = await users.create("u@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        await sessions.create("live", u.id, "2026-06-06T00:00:00.000Z", "2026-06-13T00:00:00.000Z");
        await sessions.create("stale", u.id, "2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
        expect((await sessions.findByHash("live"))?.userId).toBe(u.id);

        await sessions.deleteExpired("2026-06-06T00:00:00.000Z"); // removes 'stale' (expired 06-02)
        expect(await sessions.findByHash("stale")).toBeNull();
        expect(await sessions.findByHash("live")).not.toBeNull();

        await sessions.removeByHash("live");
        expect(await sessions.findByHash("live")).toBeNull();
      });
    });

    describe("MembershipRepository", () => {
      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
      });

      it("upsert sets then updates a role; one role per (project,user)", async () => {
        const u = await users.create("u@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        const m1 = await members.upsert("p", u.id, "viewer", "2026-06-06T00:00:00.000Z");
        const m2 = await members.upsert("p", u.id, "maintainer", "2026-06-06T00:01:00.000Z");
        expect(m2.id).toBe(m1.id);
        expect((await members.find("p", u.id))?.role).toBe("maintainer");
      });

      it("listByProject joins the user email, ordered by email", async () => {
        const a = await users.create("a@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        const b = await users.create("b@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        await members.upsert("p", b.id, "owner", "2026-06-06T00:00:00.000Z");
        await members.upsert("p", a.id, "viewer", "2026-06-06T00:00:00.000Z");
        const list = await members.listByProject("p");
        expect(list.map((m) => m.email)).toEqual(["a@x.com", "b@x.com"]);
        expect(list[0]).toMatchObject({ email: "a@x.com", role: "viewer" });
      });

      it("remove is scoped and removing the project cascades to memberships", async () => {
        const u = await users.create("u@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        await members.upsert("p", u.id, "viewer", "2026-06-06T00:00:00.000Z");
        expect(await members.remove("other", u.id)).toBe(false);
        await projects.remove("p");
        expect(await members.find("p", u.id)).toBeNull();
      });
    });

    describe("historyByKey (cross-run timeline)", () => {
      const mk = async (proj: string, runId: string, createdAt: string, status: TestSummary["status"], ready = true) => {
        await runs.create(proj, runId, "R", createdAt, { branch: "main", commit: "c1", ciUrl: "http://ci/" + runId });
        await runs.claimPending(runId, createdAt);
        await tests.replaceForRun(runId, [{
          historyId: "h1", name: "t", fullName: "s#t", status,
          duration: 5, flaky: status === "failed", message: status === "failed" ? "boom" : null, trace: null,
        }]);
        if (ready) await runs.markReady(runId, { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, createdAt);
      };

      beforeEach(async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        await projects.create("other", "2026-06-06T00:00:00.000Z");
        await mk("p", "r1", "2026-06-01T00:00:00.000Z", "passed");
        await mk("p", "r2", "2026-06-02T00:00:00.000Z", "failed");
        await mk("p", "r3", "2026-06-03T00:00:00.000Z", "passed");
        await mk("other", "o1", "2026-06-02T12:00:00.000Z", "failed");           // different project
        await mk("p", "pending", "2026-06-04T00:00:00.000Z", "failed", false);   // not ready
      });

      it("returns the test's ready runs newest-first, scoped to the project, with flake rate", async () => {
        const res = await tests.historyByKey("p", { historyId: "h1" }, 50);
        expect(res.entries.map((e) => e.runId)).toEqual(["r3", "r2", "r1"]);
        expect(res.latestName).toBe("t");
        expect(res.entries[1]).toMatchObject({ runId: "r2", status: "failed", flaky: true, message: "boom", branch: "main", ciUrl: "http://ci/r2" });
        expect(res.flakeRate).toBeCloseTo(1 / 3);
      });

      it("clamps the limit to [1,200]", async () => {
        expect((await tests.historyByKey("p", { historyId: "h1" }, 1)).entries).toHaveLength(1);
        expect((await tests.historyByKey("p", { historyId: "h1" }, 9999)).entries.length).toBeLessThanOrEqual(200);
      });

      it("matches by fullName when historyId is not given", async () => {
        const res = await tests.historyByKey("p", { fullName: "s#t" }, 50);
        expect(res.entries.map((e) => e.runId)).toEqual(["r3", "r2", "r1"]);
      });

      it("collapses retried rows (same run, same historyId) to one entry per run", async () => {
        await runs.create("p", "rdup", "R", "2026-06-05T00:00:00.000Z", { branch: "main" });
        await runs.claimPending("rdup", "2026-06-05T00:00:00.000Z");
        await tests.replaceForRun("rdup", [
          { historyId: "h1", name: "t", fullName: "s#t", status: "failed", duration: 5, flaky: true, message: "a", trace: null },
          { historyId: "h1", name: "t", fullName: "s#t", status: "passed", duration: 6, flaky: true, message: null, trace: null },
        ]);
        await runs.markReady("rdup", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "2026-06-05T00:00:00.000Z");
        const res = await tests.historyByKey("p", { historyId: "h1" }, 50);
        expect(res.entries.filter((e) => e.runId === "rdup")).toHaveLength(1); // not two
        expect(res.entries).toHaveLength(4); // distinct ready runs r1,r2,r3,rdup — not 5 rows
      });

      it("returns the test's real identity (historyId + fullName) from the newest row", async () => {
        const res = await tests.historyByKey("p", { historyId: "h1" }, 50);
        expect(res.latestHistoryId).toBe("h1");
        expect(res.latestFullName).toBe("s#t");
        expect(res.latestName).toBe("t");
      });

      it("flags hasTrace per entry and serves the blob lazily via traceForRun (project-scoped)", async () => {
        await runs.create("p", "rtrace", "R", "2026-06-05T00:00:00.000Z", { branch: "main" });
        await runs.claimPending("rtrace", "2026-06-05T00:00:00.000Z");
        await tests.replaceForRun("rtrace", [
          { historyId: "h1", name: "t", fullName: "s#t", status: "failed", duration: 5, flaky: false, message: "boom", trace: "line1\nline2" },
        ]);
        await runs.markReady("rtrace", { total: 1, passed: 0, failed: 1, broken: 0, skipped: 0 }, "2026-06-05T00:00:00.000Z");
        const res = await tests.historyByKey("p", { historyId: "h1" }, 50);
        expect(res.entries.find((e) => e.runId === "rtrace")!.hasTrace).toBe(true);
        expect(res.entries.find((e) => e.runId === "r1")!.hasTrace).toBe(false); // passed run, no trace
        expect(await tests.traceForRun("p", "rtrace", { historyId: "h1" })).toBe("line1\nline2");
        expect(await tests.traceForRun("p", "rtrace", { fullName: "s#t" })).toBe("line1\nline2");
        expect(await tests.traceForRun("other", "rtrace", { historyId: "h1" })).toBeNull(); // wrong project
      });
    });

    describe("AuditRepository", () => {
      it("records, lists recent-first, filters by project, paginates, round-trips metadata", async () => {
        await audit.record({ actorType: "user", actorId: "u1", actorLabel: "a@x", action: "login", targetType: "user", targetId: "u1" }, "2026-06-06T00:00:01.000Z");
        await audit.record({ actorType: "user", actorId: "u1", actorLabel: "a@x", action: "project_created", targetType: "project", targetId: "p", projectId: "p", metadata: { foo: "bar" } }, "2026-06-06T00:00:02.000Z");
        await audit.record({ actorType: "anonymous", actorId: null, actorLabel: "anonymous", action: "login_failed", metadata: { email: "x@x" } }, "2026-06-06T00:00:03.000Z");

        const all = await audit.list();
        expect(all.map((e) => e.action)).toEqual(["login_failed", "project_created", "login"]); // recent-first
        expect(await audit.count()).toBe(3);

        // metadata round-trips; null metadata stays null
        expect(all.find((e) => e.action === "project_created")?.metadata).toEqual({ foo: "bar" });
        expect(all.find((e) => e.action === "login")?.metadata).toBeNull();

        // project filter
        expect((await audit.list({ projectId: "p" })).map((e) => e.action)).toEqual(["project_created"]);
        expect(await audit.count({ projectId: "p" })).toBe(1);

        // pagination
        expect((await audit.list({ limit: 1 })).map((e) => e.action)).toEqual(["login_failed"]);
        expect((await audit.list({ limit: 1, offset: 1 })).map((e) => e.action)).toEqual(["project_created"]);
      });

      it("since bounds the listing to a start time (per-project view can't reveal a reused id's prior tenant)", async () => {
        // Old tenant of project 'p' (before it was deleted + recreated).
        await audit.record({ actorType: "user", actorId: "old", actorLabel: "old@x", action: "project_created", targetType: "project", targetId: "p", projectId: "p" }, "2026-06-01T00:00:00.000Z");
        // New tenant after recreation at a later createdAt.
        await audit.record({ actorType: "user", actorId: "new", actorLabel: "new@x", action: "project_created", targetType: "project", targetId: "p", projectId: "p" }, "2026-06-10T00:00:00.000Z");

        const scoped = await audit.list({ projectId: "p", since: "2026-06-10T00:00:00.000Z" });
        expect(scoped.map((e) => e.actorLabel)).toEqual(["new@x"]); // old tenant's row excluded
        expect(await audit.count({ projectId: "p", since: "2026-06-10T00:00:00.000Z" })).toBe(1);
        // Without `since`, both are visible (global/admin view).
        expect(await audit.count({ projectId: "p" })).toBe(2);
      });

      it("is NOT cascade-deleted when the referenced project or user is removed", async () => {
        await projects.create("p", "2026-06-06T00:00:00.000Z");
        const u = await users.create("u@x.com", "h", "user", "2026-06-06T00:00:00.000Z");
        await audit.record({ actorType: "user", actorId: u.id, actorLabel: u.email, action: "project_created", targetType: "project", targetId: "p", projectId: "p" }, "2026-06-06T00:00:01.000Z");

        await projects.remove("p");
        await users.remove(u.id);

        // The audit row survives — it outlives the entities it references (the whole point of an audit log).
        expect(await audit.count()).toBe(1);
        expect((await audit.list())[0].targetId).toBe("p");
      });
    });
  });
}
