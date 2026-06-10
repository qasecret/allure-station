// Allure's severity levels, most → least severe. Mirrors `SEVERITY_ORDER` in `@allurereport/core-api`
// (this package depends only on zod, so the constant is duplicated rather than imported — keep it in
// sync if Allure changes its levels). A test's `severity` is a free string (adapters may emit arbitrary
// values), so anything outside this set — and absent severity — sorts after all known levels.
// `as const` makes the keys a literal union, exported as `SeverityLevel` so consumers (e.g. the web
// severity chip) can type their own per-level maps against it and get a compile error if a level is
// added here without being handled there.
export const SEVERITY_RANK = {
  blocker: 0, critical: 1, normal: 2, minor: 3, trivial: 4,
} as const;

/** A known Allure severity level. */
export type SeverityLevel = keyof typeof SEVERITY_RANK;

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
