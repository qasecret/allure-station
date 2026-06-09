import type { QualityGateCheck, QualityGateVerdict } from "@allure-station/shared";

// Per-rule presentation: a human label, the comparison direction that constitutes a failure
// (max* rules fail when actual exceeds the threshold; min* rules fail when it falls short), and a
// value formatter matching how the rest of the UI shows pass rate (percent) and duration (seconds).
const RULE_META: Record<string, { label: string; over: boolean; fmt: (n: number) => string }> = {
  maxFailures: { label: "failures", over: true, fmt: (n) => String(n) },
  minTests: { label: "tests", over: false, fmt: (n) => String(n) },
  minPassRate: { label: "pass rate", over: false, fmt: (n) => `${+(n * 100).toFixed(1)}%` },
  maxDurationMs: { label: "duration", over: true, fmt: (n) => `${(n / 1000).toFixed(1)}s` },
};

/** Humanize one gate check into "pass rate 87.5% < 95%" style text explaining the threshold. */
export function formatGateCheck(check: QualityGateCheck): string {
  const m = RULE_META[check.rule];
  if (!m) return `${check.rule} ${check.actual} vs ${check.threshold}`;
  const op = m.over ? ">" : "<";
  return `${m.label} ${m.fmt(check.actual)} ${op} ${m.fmt(check.threshold)}`;
}

/** The humanized reasons a verdict failed — only the checks that didn't pass. Empty when all pass. */
export function failedReasons(verdict: QualityGateVerdict): string[] {
  return verdict.checks.filter((c) => !c.ok).map(formatGateCheck);
}
