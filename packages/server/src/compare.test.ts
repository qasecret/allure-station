import { describe, it, expect } from "vitest";
import { compareRuns } from "./compare.js";
import type { TestSummary } from "@allure-station/shared";

const t = (over: Partial<TestSummary> & { name: string }): TestSummary => ({
  historyId: over.name, // use name as a stable key in tests
  fullName: over.name,
  status: "passed",
  duration: null,
  flaky: false,
  ...over,
});

describe("compareRuns", () => {
  it("buckets transitions, added/removed, and flaky", () => {
    const base = {
      runId: "base", createdAt: "2026-06-06T00:00:00.000Z",
      tests: [
        t({ name: "was-passing-now-failing", status: "passed" }),
        t({ name: "was-failing-now-passing", status: "failed" }),
        t({ name: "failing-both", status: "broken" }),
        t({ name: "only-in-base", status: "passed" }),
        t({ name: "stable", status: "passed" }),
      ],
    };
    const target = {
      runId: "target", createdAt: "2026-06-06T01:00:00.000Z",
      tests: [
        t({ name: "was-passing-now-failing", status: "failed" }),
        t({ name: "was-failing-now-passing", status: "passed" }),
        t({ name: "failing-both", status: "failed" }),
        t({ name: "only-in-target", status: "passed" }),
        t({ name: "stable", status: "passed" }),
        t({ name: "flaky-one", status: "passed", flaky: true }),
      ],
    };

    const r = compareRuns(base, target);
    expect(r.base.runId).toBe("base");
    expect(r.target.runId).toBe("target");
    expect(r.newlyFailing.map((d) => d.name)).toEqual(["was-passing-now-failing"]);
    expect(r.fixed.map((d) => d.name)).toEqual(["was-failing-now-passing"]);
    expect(r.stillFailing.map((d) => d.name)).toEqual(["failing-both"]);
    expect(r.added.map((d) => d.name).sort()).toEqual(["flaky-one", "only-in-target"]);
    expect(r.removed.map((d) => d.name)).toEqual(["only-in-base"]);
    expect(r.flaky.map((d) => d.name)).toEqual(["flaky-one"]);
  });

  it("buckets ambiguous statuses safely (no silent drops, no false 'fixed')", () => {
    const r = compareRuns(
      { runId: "b", createdAt: "x", tests: [
        t({ name: "unknown-to-failed", status: "unknown" }),
        t({ name: "failed-to-skipped", status: "failed" }),
      ] },
      { runId: "t", createdAt: "y", tests: [
        t({ name: "unknown-to-failed", status: "failed" }),  // newly failing (base wasn't failing)
        t({ name: "failed-to-skipped", status: "skipped" }), // NOT "fixed" — skipped isn't a confirmed pass
      ] },
    );
    expect(r.newlyFailing.map((d) => d.name)).toEqual(["unknown-to-failed"]);
    expect(r.fixed).toHaveLength(0);
  });

  it("newlyFailing carries base->target statuses", () => {
    const r = compareRuns(
      { runId: "b", createdAt: "x", tests: [t({ name: "a", status: "passed" })] },
      { runId: "t", createdAt: "y", tests: [t({ name: "a", status: "broken" })] },
    );
    expect(r.newlyFailing[0]).toMatchObject({ name: "a", baseStatus: "passed", targetStatus: "broken" });
  });
});

describe("dimensions on diffs", () => {
  it("copies severity/suite/owner/tags onto a diff (from base when absent in target)", () => {
    const base = { runId: "b", createdAt: "2026-06-06T00:00:00.000Z", tests: [
      t({ name: "gone", status: "failed", severity: "critical", suite: "checkout", owner: "alice", tags: ["smoke"] }),
    ]};
    const target = { runId: "t", createdAt: "2026-06-06T01:00:00.000Z", tests: [] };
    const res = compareRuns(base, target);
    expect(res.removed[0]).toMatchObject({ severity: "critical", suite: "checkout", owner: "alice", tags: ["smoke"] });
  });

  it("orders newlyFailing by severity (blocker first, unknown last)", () => {
    const base = { runId: "b", createdAt: "2026-06-06T00:00:00.000Z", tests: [
      t({ name: "n1", status: "passed" }), t({ name: "n2", status: "passed" }),
      t({ name: "n3", status: "passed" }), t({ name: "n4", status: "passed" }),
    ]};
    const target = { runId: "t", createdAt: "2026-06-06T01:00:00.000Z", tests: [
      t({ name: "n1", status: "failed", severity: "minor" }),
      t({ name: "n2", status: "failed", severity: "blocker" }),
      t({ name: "n3", status: "failed" }),                       // no severity → last
      t({ name: "n4", status: "failed", severity: "critical" }),
    ]};
    const res = compareRuns(base, target);
    expect(res.newlyFailing.map((d) => d.name)).toEqual(["n2", "n4", "n1", "n3"]);
  });
});
