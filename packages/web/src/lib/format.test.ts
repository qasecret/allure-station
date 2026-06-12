import { describe, it, expect } from "vitest";
import { passRate, relativeTime, runLabel, formatPercent, formatDurationSec, formatDelta, absoluteDate, formatAbsolute } from "./format.js";

describe("formatDelta", () => {
  it("renders signed deltas and omits zero", () => {
    expect(formatDelta(3)).toBe("+3");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(0)).toBeNull();
  });
});

describe("passRate", () => {
  it("returns rounded percent passed/total", () => {
    expect(passRate({ passed: 7, total: 8 })).toBe(88);
    expect(passRate({ passed: 0, total: 0 })).toBe(0);
    expect(passRate({ passed: 3, total: 3 })).toBe(100);
  });
});

describe("formatPercent", () => {
  it("trims trailing .0 and keeps a meaningful decimal", () => {
    expect(formatPercent(0.95)).toBe("95%");
    expect(formatPercent(0.875)).toBe("87.5%");
  });
  it("directional rounding avoids a sub-precision value reading as equal", () => {
    expect(formatPercent(0.9996, "down")).toBe("99.9%"); // a 99.96% actual that failed a 100% gate
    expect(formatPercent(1, "near")).toBe("100%");
  });
});

describe("formatDurationSec", () => {
  it("keeps one decimal", () => {
    expect(formatDurationSec(80000)).toBe("80.0s");
    expect(formatDurationSec(65449)).toBe("65.4s");
  });
  it("rounds up for an over-threshold actual so it doesn't read as equal", () => {
    expect(formatDurationSec(60001, "up")).toBe("60.1s");
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

describe("relativeTime fallover", () => {
  const now = Date.parse("2026-06-12T12:00:00.000Z");
  it("keeps compact forms under 7 days", () => {
    expect(relativeTime("2026-06-12T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-06-10T12:00:00.000Z", now)).toBe("2d ago");
  });
  it("falls over to a date beyond 7 days, with year beyond a year", () => {
    expect(relativeTime("2026-06-01T12:00:00.000Z", now)).toBe(absoluteDate("2026-06-01T12:00:00.000Z"));
    expect(relativeTime("2024-12-25T12:00:00.000Z", now)).toBe(absoluteDate("2024-12-25T12:00:00.000Z", { year: true }));
  });
  it("exactly 7 days ago shows '7d ago'", () => {
    const exactly7d = Date.parse("2026-06-05T12:00:00.000Z"); // exactly 7 days before now
    expect(relativeTime("2026-06-05T12:00:00.000Z", exactly7d + 7 * 24 * 3600 * 1000)).toBe("7d ago");
  });
  it("8 days ago falls over to a date string", () => {
    const ref = "2026-06-04T12:00:00.000Z"; // 8 days before June 12
    const result = relativeTime(ref, now);
    expect(result).not.toMatch(/ago/);
    expect(result).toMatch(/Jun/);
  });
  it("a December date viewed in January includes the year (calendar-year boundary)", () => {
    const jan1Now = Date.parse("2027-01-15T12:00:00.000Z");
    const dec25 = "2026-12-25T12:00:00.000Z";
    const result = relativeTime(dec25, jan1Now);
    // The years differ (2026 vs 2027) → year must be shown
    expect(result).toContain("2026");
  });
});
describe("formatAbsolute", () => {
  it("renders a full local timestamp", () => {
    // local-TZ dependent — assert shape, not exact text
    expect(formatAbsolute("2026-06-12T06:44:11.000Z")).toMatch(/2026/);
    expect(formatAbsolute("2026-06-12T06:44:11.000Z")).toMatch(/\d{1,2}:\d{2}/);
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
