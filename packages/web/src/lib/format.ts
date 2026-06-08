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

/** Human-friendly run label for selectors: relative time, status, pass ratio, branch@sha · env. */
export function runLabel(r: Run, now: number = Date.now()): string {
  const base = `${relativeTime(r.createdAt, now)} — ${r.status}${r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}`;
  const meta = [
    r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : null,
    r.environment || null,
  ].filter(Boolean).join(" · ");
  return meta ? `${base} — ${meta}` : base;
}
