// Allure's severity levels, most → least severe. A test's `severity` is a free string (adapters may
// emit arbitrary values), so anything outside this set — and absent severity — sorts after all known
// levels.
export const SEVERITY_RANK: Record<string, number> = {
  blocker: 0, critical: 1, normal: 2, minor: 3, trivial: 4,
};

/** Sort rank for a severity value; unknown/absent ranks after every known level. Guards on the value
 *  type (not `in`) so inherited prototype keys like "constructor" don't leak a non-number rank. */
export function severityRank(severity: string | null | undefined): number {
  if (severity == null) return Number.MAX_SAFE_INTEGER;
  const r = SEVERITY_RANK[severity as keyof typeof SEVERITY_RANK];
  return typeof r === "number" ? r : Number.MAX_SAFE_INTEGER;
}

/** Stable comparator: ascending by severity rank (blocker first, unknown/null last). */
export function bySeverity<T extends { severity?: string | null }>(a: T, b: T): number {
  return severityRank(a.severity) - severityRank(b.severity);
}
