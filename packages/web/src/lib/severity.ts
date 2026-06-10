// Severity → Tailwind chip classes, tiered onto the existing status color tokens: blocker/critical
// red (status-fail), normal amber (status-broken), minor/trivial muted. Unknown/absent → null so the
// chip renders nothing. Guards on the value type (not `in`) so prototype keys like "constructor"
// don't leak a bogus class.
const SEVERITY_CHIP: Record<string, string> = {
  blocker: "bg-status-fail/15 text-status-fail",
  critical: "bg-status-fail/15 text-status-fail",
  normal: "bg-status-broken/15 text-status-broken",
  minor: "bg-muted text-muted-foreground",
  trivial: "bg-muted text-muted-foreground",
};

/** Tailwind classes for a severity chip, or null when the level is unknown/absent. */
export function severityChipClass(severity?: string | null): string | null {
  if (!severity) return null;
  const cls = SEVERITY_CHIP[severity as keyof typeof SEVERITY_CHIP];
  return typeof cls === "string" ? cls : null;
}
