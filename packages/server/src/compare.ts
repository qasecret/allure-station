import { bySeverity, isFailingStatus, type CompareResult, type TestDiff, type TestSummary } from "@allure-station/shared";

// Cross-run match key. historyId is Allure's stable per-test hash and is effectively always present;
// fullName/name are fallbacks. Two distinct tests with no identity at all (null historyId AND null
// fullName) and the same name are indistinguishable across runs and would share a key — unavoidable
// without identity, and not produced by Allure in practice.
const keyOf = (t: TestSummary): string => t.historyId ?? t.fullName ?? t.name;
const isFailing = isFailingStatus;

const toDiff = (base: TestSummary | undefined, target: TestSummary | undefined): TestDiff => {
  const t = (target ?? base)!;
  return {
    historyId: t.historyId,
    name: t.name,
    fullName: t.fullName,
    baseStatus: base?.status ?? null,
    targetStatus: target?.status ?? null,
    flaky: t.flaky,
    severity: t.severity ?? null,
    suite: t.suite ?? null,
    owner: t.owner ?? null,
    tags: t.tags ?? [],
  };
};

/**
 * Diff two runs' per-test results. Tests are matched across runs by `keyOf`
 * (historyId, falling back to fullName then name). Buckets are mutually exclusive
 * except `flaky`, which is a cross-cutting annotation (a flaky test may also appear
 * in another bucket).
 */
export function compareRuns(
  base: { runId: string; createdAt: string; tests: TestSummary[] },
  target: { runId: string; createdAt: string; tests: TestSummary[] },
): CompareResult {
  const baseMap = new Map(base.tests.map((t) => [keyOf(t), t]));
  const targetMap = new Map(target.tests.map((t) => [keyOf(t), t]));

  const res: CompareResult = {
    base: { runId: base.runId, createdAt: base.createdAt },
    target: { runId: target.runId, createdAt: target.createdAt },
    newlyFailing: [], fixed: [], stillFailing: [], added: [], removed: [], flaky: [],
  };

  for (const [key, tt] of targetMap) {
    const bt = baseMap.get(key);
    if (!bt) {
      res.added.push(toDiff(undefined, tt));
    } else if (isFailing(tt.status)) {
      // Every target-failing test is bucketed (no status — incl. 'unknown' or 'skipped' base — slips through).
      (isFailing(bt.status) ? res.stillFailing : res.newlyFailing).push(toDiff(bt, tt));
    } else if (isFailing(bt.status) && tt.status === "passed") {
      // "Fixed" requires a real pass; failed→skipped/unknown is not a confirmed fix, so it isn't claimed here.
      res.fixed.push(toDiff(bt, tt));
    }
    if (tt.flaky) res.flaky.push(toDiff(bt, tt));
  }
  for (const [key, bt] of baseMap) {
    if (!targetMap.has(key)) res.removed.push(toDiff(bt, undefined));
  }
  // Surface the worst regressions first: order each bucket by severity (blocker→trivial, unknown last).
  // Array.sort is stable, so within a rank the original insertion order is preserved.
  for (const bucket of [res.newlyFailing, res.fixed, res.stillFailing, res.added, res.removed, res.flaky]) {
    bucket.sort(bySeverity);
  }
  return res;
}
