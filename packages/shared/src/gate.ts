import type { QualityGateConfig, QualityGateVerdict, RunStats } from "./contracts.js";

/**
 * Evaluate a quality gate over a run's aggregate stats. All configured checks must pass. An absent
 * or empty config means "no gate" (configured:false, passed:true). Equivalent to Allure's aggregate
 * rules (maxFailures/minTests/minPassRate/maxDurationMs) computed over the stats we already persist.
 */
export function evaluateGate(stats: RunStats, config: QualityGateConfig | null): QualityGateVerdict {
  if (!config || Object.keys(config).length === 0) return { configured: false, passed: true, checks: [] };
  const checks: QualityGateVerdict["checks"] = [];
  const failures = stats.failed + stats.broken;
  if (config.maxFailures !== undefined) {
    checks.push({ rule: "maxFailures", actual: failures, threshold: config.maxFailures, ok: failures <= config.maxFailures });
  }
  if (config.minTests !== undefined) {
    checks.push({ rule: "minTests", actual: stats.total, threshold: config.minTests, ok: stats.total >= config.minTests });
  }
  if (config.minPassRate !== undefined) {
    const rate = stats.total ? stats.passed / stats.total : 0;
    checks.push({ rule: "minPassRate", actual: rate, threshold: config.minPassRate, ok: rate >= config.minPassRate });
  }
  if (config.maxDurationMs !== undefined) {
    const dur = stats.durationMs ?? 0;
    checks.push({ rule: "maxDurationMs", actual: dur, threshold: config.maxDurationMs, ok: dur <= config.maxDurationMs });
  }
  return { configured: true, passed: checks.every((c) => c.ok), checks };
}
