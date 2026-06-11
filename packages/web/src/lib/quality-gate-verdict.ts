import type { QualityGateCheck, QualityGateConfig, QualityGateVerdict, RunStats } from "@allure-station/shared";
import { evaluateGate as sharedEvaluateGate } from "@allure-station/shared";
import { formatPercent, formatDurationSec } from "./format.js";

type Dir = "near" | "up" | "down";

// Per-rule presentation: a human label, the comparison direction that constitutes a failure
// (max* rules fail when actual exceeds the threshold; min* rules fail when it falls short), and a
// value formatter reusing the shared percent/duration helpers from format.ts.
const RULE_META: Record<string, { label: string; over: boolean; fmt: (n: number, dir: Dir) => string }> = {
  maxFailures: { label: "failures", over: true, fmt: (n) => String(n) },
  minTests: { label: "tests", over: false, fmt: (n) => String(n) },
  minPassRate: { label: "pass rate", over: false, fmt: (n, dir) => formatPercent(n, dir) },
  maxDurationMs: { label: "duration", over: true, fmt: (n, dir) => formatDurationSec(n, dir) },
};

/** Humanize one gate check into "pass rate 87.5% < 95%" style text explaining the threshold. */
export function formatGateCheck(check: QualityGateCheck): string {
  const m = RULE_META[check.rule];
  if (!m) return `${check.rule} ${check.actual} vs ${check.threshold}`;
  const op = m.over ? ">" : "<";
  // Round the actual toward the failing side so a sub-display-precision miss (e.g. 99.96% vs a 100%
  // gate) never renders as the self-contradictory "100% < 100%".
  const actual = m.fmt(check.actual, m.over ? "up" : "down");
  return `${m.label} ${actual} ${op} ${m.fmt(check.threshold, "near")}`;
}

/** The humanized reasons a verdict failed — only the checks that didn't pass. Empty when all pass. */
export function failedReasons(verdict: QualityGateVerdict): string[] {
  return verdict.checks.filter((c) => !c.ok).map(formatGateCheck);
}

/** Evaluate a gate config directly against run stats (client-side; delegates rule logic to shared).
 *  Returns null when no rule is configured (nothing to evaluate). */
export function evaluateGate(cfg: QualityGateConfig, stats: RunStats): { passed: boolean; reasons: string[] } | null {
  const verdict = sharedEvaluateGate(stats, cfg);
  if (!verdict.configured) return null;
  return { passed: verdict.passed, reasons: failedReasons(verdict) };
}
