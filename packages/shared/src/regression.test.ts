import { describe, it, expect } from "vitest";
import { computeRegression } from "./regression.js";
import type { TestHistoryEntry, TestStatus } from "./contracts.js";

// Build a newest→oldest entry list from a status string like "F F P". runId/createdAt encode position.
const entries = (spec: string): TestHistoryEntry[] => {
  const map: Record<string, TestStatus> = { F: "failed", B: "broken", P: "passed", S: "skipped", U: "unknown" };
  return spec.split(" ").map((c, i) => ({
    runId: `r${i}`, createdAt: `2026-06-${String(20 - i).padStart(2, "0")}T00:00:00.000Z`,
    branch: null, commit: `c${i}`, ciUrl: null,
    status: map[c], duration: null, flaky: false, message: null, hasTrace: false,
  }));
};

describe("computeRegression", () => {
  it("returns null when the test is currently passing", () => {
    expect(computeRegression(entries("P F F"))).toBeNull();
  });

  it("returns null for an empty timeline", () => {
    expect(computeRegression([])).toBeNull();
  });

  it("reports the most-recent regression (P F F → first failed r1, last passed r2)", () => {
    const reg = computeRegression(entries("F F P"))!; // newest F, then F, then P
    expect(reg.windowLimited).toBe(false);
    expect(reg.failingRunCount).toBe(2);
    expect(reg.firstFailed.runId).toBe("r1"); // oldest run of the current streak
    expect(reg.lastPassed?.runId).toBe("r2"); // the passing run before it
  });

  it("treats broken as failing", () => {
    const reg = computeRegression(entries("B P"))!;
    expect(reg.firstFailed.runId).toBe("r0");
    expect(reg.lastPassed?.runId).toBe("r1");
  });

  it("ignores skipped/unknown runs without breaking the streak (F S F P)", () => {
    const reg = computeRegression(entries("F S F P"))!;
    expect(reg.failingRunCount).toBe(2);          // the S is not counted
    expect(reg.firstFailed.runId).toBe("r2");     // oldest failing (the S at r1 skipped over)
    expect(reg.lastPassed?.runId).toBe("r3");
  });

  it("ignores a skipped run on the streak/pass boundary (F S P)", () => {
    const reg = computeRegression(entries("F S P"))!;
    expect(reg.failingRunCount).toBe(1);
    expect(reg.firstFailed.runId).toBe("r0");
    expect(reg.lastPassed?.runId).toBe("r2"); // the S at r1 is skipped over to reach P
    expect(reg.windowLimited).toBe(false);
  });

  it("only reports the current streak, not an earlier one (F F P F)", () => {
    const reg = computeRegression(entries("F F P F"))!;
    expect(reg.failingRunCount).toBe(2);
    expect(reg.firstFailed.runId).toBe("r1");
    expect(reg.lastPassed?.runId).toBe("r2");
  });

  it("is window-limited when no passing run is in range (all failing)", () => {
    const reg = computeRegression(entries("F F F"))!;
    expect(reg.windowLimited).toBe(true);
    expect(reg.lastPassed).toBeNull();
    expect(reg.failingRunCount).toBe(3);
    expect(reg.firstFailed.runId).toBe("r2"); // oldest in window
  });
});
