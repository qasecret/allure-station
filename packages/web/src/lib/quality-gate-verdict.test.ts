import { describe, it, expect } from "vitest";
import type { QualityGateVerdict } from "@allure-station/shared";
import { formatGateCheck, failedReasons, evaluateGate } from "./quality-gate-verdict.js";

describe("formatGateCheck", () => {
  it("renders a failed maxFailures as a > comparison", () => {
    expect(formatGateCheck({ rule: "maxFailures", ok: false, actual: 1, threshold: 0 }))
      .toBe("failures 1 > 0");
  });
  it("renders a failed minTests as a < comparison", () => {
    expect(formatGateCheck({ rule: "minTests", ok: false, actual: 0, threshold: 1 }))
      .toBe("tests 0 < 1");
  });
  it("renders minPassRate as a percentage", () => {
    expect(formatGateCheck({ rule: "minPassRate", ok: false, actual: 0.875, threshold: 0.95 }))
      .toBe("pass rate 87.5% < 95%");
  });
  it("renders maxDurationMs in seconds", () => {
    expect(formatGateCheck({ rule: "maxDurationMs", ok: false, actual: 80000, threshold: 60000 }))
      .toBe("duration 80.0s > 60.0s");
  });
  it("rounds the actual toward the failing side so a near miss never reads as equal", () => {
    // 99.96% pass rate failing a 100% gate must not render as "100% < 100%".
    expect(formatGateCheck({ rule: "minPassRate", ok: false, actual: 0.9996, threshold: 1 }))
      .toBe("pass rate 99.9% < 100%");
  });
  it("falls back gracefully for an unknown rule", () => {
    expect(formatGateCheck({ rule: "wat", ok: false, actual: 3, threshold: 2 }))
      .toBe("wat 3 vs 2");
  });
});

describe("evaluateGate (client-side, config × stats)", () => {
  const stats = { total: 8, passed: 7, failed: 1, broken: 0, skipped: 0, flaky: 0, durationMs: 65_000 };
  it("returns null when no rule is configured", () => {
    expect(evaluateGate({}, stats)).toBeNull();
  });
  it("fails on maxFailures and minPassRate, listing reasons", () => {
    const v = evaluateGate({ maxFailures: 0, minPassRate: 0.95 }, stats);
    expect(v).toEqual({ passed: false, reasons: ["failures 1 > 0", "pass rate 87.5% < 95%"] });
  });
  it("passes when all configured rules hold", () => {
    expect(evaluateGate({ maxFailures: 1, minTests: 1 }, stats)).toEqual({ passed: true, reasons: [] });
  });
});

describe("failedReasons", () => {
  const verdict = (checks: QualityGateVerdict["checks"]): QualityGateVerdict =>
    ({ configured: true, passed: checks.every((c) => c.ok), checks });

  it("returns only the failing checks, humanized", () => {
    expect(failedReasons(verdict([
      { rule: "maxFailures", ok: false, actual: 1, threshold: 0 },
      { rule: "minTests", ok: true, actual: 8, threshold: 1 },
      { rule: "minPassRate", ok: false, actual: 0.875, threshold: 0.95 },
    ]))).toEqual(["failures 1 > 0", "pass rate 87.5% < 95%"]);
  });

  it("returns an empty array when every check passes", () => {
    expect(failedReasons(verdict([{ rule: "maxFailures", ok: true, actual: 0, threshold: 0 }]))).toEqual([]);
  });
});
