import type { Run } from "@allure-station/shared";

export function passRate(stats: { passed: number; total: number }): number {
  if (!stats.total) return 0;
  return Math.round((stats.passed / stats.total) * 100);
}

/** Short local date: "Jun 5", with year when requested or differing: "Dec 25, 2024". */
export function absoluteDate(iso: string, opts: { year?: boolean } = {}): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) });
}

/** Full local timestamp for tooltips and dense audit rows: "Jun 12, 2026, 06:44:11". */
export function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Compact relative time. Falls over to absoluteDate beyond 7 days, including year when the
 *  calendar year differs (so a December date viewed in January always shows the year).
 *  `now` is injectable for testing. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (Number.isNaN(sec)) return "—";
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day <= 7) return `${day}d ago`;
  const yearApart = new Date(iso).getFullYear() !== new Date(now).getFullYear();
  return absoluteDate(iso, { year: yearApart });
}

/**
 * Round to one decimal. `dir` controls the tie-break direction: "near" (default) rounds to nearest,
 * while "up"/"down" force the result toward that side — used when displaying a value that must read
 * as strictly greater/less than another so a sub-precision miss never renders as equal.
 */
function round1(n: number, dir: "near" | "up" | "down"): number {
  const x = n * 10;
  return (dir === "up" ? Math.ceil(x) : dir === "down" ? Math.floor(x) : Math.round(x)) / 10;
}

/** Ratio (0–1) → percent string, 1 decimal, trailing ".0" trimmed: 0.95 → "95%", 0.875 → "87.5%". */
export function formatPercent(ratio: number, dir: "near" | "up" | "down" = "near"): string {
  return `${+round1(ratio * 100, dir).toFixed(1)}%`;
}

/** Milliseconds → seconds string, 1 decimal kept: 80000 → "80.0s", 65449 → "65.4s". */
export function formatDurationSec(ms: number, dir: "near" | "up" | "down" = "near"): string {
  return `${round1(ms / 1000, dir).toFixed(1)}s`;
}

/** Signed delta string for comparison tiles: "+3", "-2", null for zero (omit from UI). */
export function formatDelta(n: number): string | null {
  return n === 0 ? null : n > 0 ? `+${n}` : String(n);
}

/** Human-friendly run label for selectors: relative time, status, pass ratio, branch@sha · env. */
export function runLabel(r: Run, now: number = Date.now()): string {
  const base = `${relativeTime(r.createdAt, now)} — ${r.status}${r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}`;
  const meta = [
    r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : null,
    r.environment || null,
  ].filter(Boolean).join(" · ");
  return meta ? `${base} — ${meta}` : base;
}
