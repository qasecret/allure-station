import { describe, it, expect } from "vitest";
import { barGeometry, xAxisLabels } from "./trend-geometry";

describe("trend geometry", () => {
  const pts = [
    { runId: "a", createdAt: "2026-06-10T10:00:00.000Z", stats: { total: 8, passed: 8, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
    { runId: "b", createdAt: "2026-06-11T10:00:00.000Z", stats: { total: 8, passed: 4, failed: 4, broken: 0, skipped: 0, durationMs: 2000 } },
  ];
  it("scales bar heights by pass rate within the plot height", () => {
    const g = barGeometry(pts, { width: 300, height: 120 });
    expect(g.bars).toHaveLength(2);
    expect(g.bars[0].h).toBeGreaterThan(g.bars[1].h); // 100% vs 50%
    expect(g.bars[1].h / g.bars[0].h).toBeCloseTo(0.5, 1);
  });
  it("labels first and last points and day boundaries", () => {
    const labels = xAxisLabels(pts);
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(1);
  });
});
