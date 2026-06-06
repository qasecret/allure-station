import type { CompareResult, TestDiff, TestSummary } from "@allure-station/shared";

const keyOf = (t: TestSummary): string => t.historyId ?? t.fullName ?? t.name;
const isFailing = (s: TestSummary["status"]): boolean => s === "failed" || s === "broken";
const isPassing = (s: TestSummary["status"]): boolean => s === "passed" || s === "skipped";

const toDiff = (base: TestSummary | undefined, target: TestSummary | undefined): TestDiff => {
  const t = (target ?? base)!;
  return {
    historyId: t.historyId,
    name: t.name,
    fullName: t.fullName,
    baseStatus: base?.status ?? null,
    targetStatus: target?.status ?? null,
    flaky: t.flaky,
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
    } else if (isFailing(tt.status) && isPassing(bt.status)) {
      res.newlyFailing.push(toDiff(bt, tt));
    } else if (isPassing(tt.status) && isFailing(bt.status)) {
      res.fixed.push(toDiff(bt, tt));
    } else if (isFailing(tt.status) && isFailing(bt.status)) {
      res.stillFailing.push(toDiff(bt, tt));
    }
    if (tt.flaky) res.flaky.push(toDiff(bt, tt));
  }
  for (const [key, bt] of baseMap) {
    if (!targetMap.has(key)) res.removed.push(toDiff(bt, undefined));
  }
  return res;
}
