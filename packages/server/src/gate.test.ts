import { describe, it, expect } from "vitest";
import { evaluateGate } from "./gate.js";
import type { RunStats } from "@allure-station/shared";

const stats = (over: Partial<RunStats> = {}): RunStats => ({ total: 10, passed: 10, failed: 0, broken: 0, skipped: 0, ...over });

describe("evaluateGate", () => {
  it("no/empty config → not configured, passes", () => {
    expect(evaluateGate(stats(), null)).toEqual({ configured: false, passed: true, checks: [] });
    expect(evaluateGate(stats(), {})).toEqual({ configured: false, passed: true, checks: [] });
  });

  it("maxFailures counts failed + broken", () => {
    expect(evaluateGate(stats({ failed: 1, broken: 1 }), { maxFailures: 2 }).passed).toBe(true);
    const v = evaluateGate(stats({ failed: 2, broken: 1 }), { maxFailures: 2 });
    expect(v.passed).toBe(false);
    expect(v.checks[0]).toMatchObject({ rule: "maxFailures", actual: 3, threshold: 2, ok: false });
  });

  it("minTests / minPassRate / maxDurationMs", () => {
    expect(evaluateGate(stats({ total: 3 }), { minTests: 5 }).passed).toBe(false);
    expect(evaluateGate(stats({ total: 4, passed: 3 }), { minPassRate: 0.8 }).passed).toBe(false); // 0.75 < 0.8
    expect(evaluateGate(stats({ total: 4, passed: 4 }), { minPassRate: 0.8 }).passed).toBe(true);
    expect(evaluateGate(stats({ total: 0, passed: 0 }), { minPassRate: 0.5 }).passed).toBe(false); // 0 rate
    expect(evaluateGate(stats({ durationMs: 5000 }), { maxDurationMs: 3000 }).passed).toBe(false);
    expect(evaluateGate(stats(), { maxDurationMs: 3000 }).passed).toBe(true); // undefined durationMs → 0
  });

  it("all configured checks must pass", () => {
    const v = evaluateGate(stats({ total: 10, passed: 9, failed: 1 }), { maxFailures: 1, minPassRate: 0.95 });
    expect(v.passed).toBe(false); // maxFailures ok (1<=1) but passRate 0.9 < 0.95
    expect(v.checks.map((c) => c.ok)).toEqual([true, false]);
  });
});
