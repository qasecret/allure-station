import type { TestStatus } from "./contracts.js";

/**
 * Single source of truth for how a test status is bucketed across features (run comparison, the
 * regression bisect hint, etc.): a test is *failing*, *passing*, or *ignored* (no pass/fail signal).
 *
 * Exhaustive over `TestStatus` — the `never` default makes adding a status to `testStatusSchema`
 * without classifying it here a compile error, so the policy can't silently drift.
 */
export function classifyStatus(status: TestStatus): "failing" | "passing" | "ignored" {
  switch (status) {
    case "failed":
    case "broken":
      return "failing";
    case "passed":
      return "passing";
    case "skipped":
    case "unknown":
      return "ignored";
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled test status: ${String(_exhaustive)}`);
    }
  }
}

export const isFailingStatus = (s: TestStatus): boolean => classifyStatus(s) === "failing";
export const isIgnoredStatus = (s: TestStatus): boolean => classifyStatus(s) === "ignored";
