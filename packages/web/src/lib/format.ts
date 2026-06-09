import type { Run } from "@allure-station/shared";

export function passRate(stats: { passed: number; total: number }): number {
  if (!stats.total) return 0;
  return Math.round((stats.passed / stats.total) * 100);
}

/** Compact relative time. `now` is injectable for testing. */
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
  return `${day}d ago`;
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

/** Human-friendly run label for selectors: relative time, status, pass ratio, branch@sha · env. */
export function runLabel(r: Run, now: number = Date.now()): string {
  const base = `${relativeTime(r.createdAt, now)} — ${r.status}${r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}`;
  const meta = [
    r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : null,
    r.environment || null,
  ].filter(Boolean).join(" · ");
  return meta ? `${base} — ${meta}` : base;
}
