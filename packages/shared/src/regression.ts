import type { Regression, TestHistoryEntry } from "./contracts.js";
import { classifyStatus } from "./status.js";

/**
 * Most-recent regression for a test's timeline (entries newest→oldest, one per run). Returns null
 * unless the test is currently failing. failed/broken = failing, passed = passing, skipped/unknown =
 * ignored (skipped over) — see classifyStatus and
 * docs/superpowers/specs/2026-06-08-regression-bisect-hint-design.md.
 */
export function computeRegression(entries: TestHistoryEntry[]): Regression | null {
  const meaningful = entries.filter((e) => classifyStatus(e.status) !== "ignored"); // drop ignored, keep order
  const newest = meaningful[0];
  if (!newest || classifyStatus(newest.status) !== "failing") return null; // not currently failing

  // Walk the leading failing streak; stop at the first passing run (or the end of the window).
  let i = 0;
  while (i < meaningful.length && classifyStatus(meaningful[i].status) === "failing") i++;
  const firstFailed = meaningful[i - 1]; // oldest run of the streak
  const before = meaningful[i];          // first non-ignored older than the streak — passing, if present

  const ref = (e: TestHistoryEntry) => ({ runId: e.runId, createdAt: e.createdAt, commit: e.commit });
  return {
    windowLimited: before === undefined,
    firstFailed: ref(firstFailed),
    lastPassed: before ? ref(before) : null,
    failingRunCount: i,
  };
}
