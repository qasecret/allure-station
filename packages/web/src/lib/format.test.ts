import { describe, it, expect } from "vitest";
import { passRate, relativeTime, runLabel } from "./format.js";

describe("passRate", () => {
  it("returns rounded percent passed/total", () => {
    expect(passRate({ passed: 7, total: 8 })).toBe(88);
    expect(passRate({ passed: 0, total: 0 })).toBe(0);
    expect(passRate({ passed: 3, total: 3 })).toBe(100);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-07T12:00:00Z").getTime();
  it("formats recent times", () => {
    expect(relativeTime("2026-06-07T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-07T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-07T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-06-05T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("runLabel", () => {
  const now = new Date("2026-06-08T12:00:30Z").getTime(); // 30s after the run below
  const run = {
    id: "r1", projectId: "p", status: "ready", createdAt: "2026-06-08T12:00:00Z",
    stats: { passed: 7, total: 8, failed: 1, broken: 0, skipped: 0, flaky: 0, durationMs: 1000 },
    branch: "main", commit: "e4f5a6b7c8d9", environment: "staging",
  } as unknown as import("@allure-station/shared").Run;

  it("leads with relative time and includes status, ratio, short sha, env", () => {
    expect(runLabel(run, now)).toBe("just now — ready (7/8) — main@e4f5a6b · staging");
  });

  it("falls back cleanly with no branch/env", () => {
    const bare = { ...run, branch: null, commit: null, environment: null } as unknown as import("@allure-station/shared").Run;
    expect(runLabel(bare, now)).toBe("just now — ready (7/8)");
  });

  it("omits the ratio when stats are absent", () => {
    const noStats = { ...run, stats: null, branch: null, commit: null, environment: null } as unknown as import("@allure-station/shared").Run;
    expect(runLabel(noStats, now)).toBe("just now — ready");
  });

  it("shows branch without sha when commit is absent", () => {
    const noCommit = { ...run, commit: null } as unknown as import("@allure-station/shared").Run;
    expect(runLabel(noCommit, now)).toBe("just now — ready (7/8) — main · staging");
  });
});
