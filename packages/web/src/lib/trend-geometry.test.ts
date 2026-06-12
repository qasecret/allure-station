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

describe("xAxisLabels thinning", () => {
  const mkPts = (days: number) =>
    Array.from({ length: days }, (_, i) => ({
      runId: `r${i}`,
      createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));
  it("keeps first and last, drops intermediates that would collide", () => {
    const labels = xAxisLabels(mkPts(30), { plotWidth: 300, labelWidth: 70 });
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(29);
    expect(labels.length).toBeLessThanOrEqual(Math.floor(300 / 70) + 1); // budget honored
  });
  it("keeps all day boundaries when there is room", () => {
    const labels = xAxisLabels(mkPts(3), { plotWidth: 600, labelWidth: 70 });
    expect(labels).toHaveLength(3);
  });
  it("is backward compatible without a budget (no thinning)", () => {
    expect(xAxisLabels(mkPts(3))).toHaveLength(3);
  });
});
