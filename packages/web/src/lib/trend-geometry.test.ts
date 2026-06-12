import { describe, it, expect } from "vitest";
import { barGeometry, barPitch, xAxisLabels } from "./trend-geometry";

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

describe("barPitch", () => {
  it("matches the spacing used by barGeometry", () => {
    const plotWidth = 558;
    const n = 30;
    const pitch = barPitch(n, plotWidth);
    const { bars } = barGeometry(
      Array.from({ length: n }, (_, i) => ({
        runId: `r${i}`,
        createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
      })),
      { width: plotWidth, height: 100 }
    );
    // barGeometry places bar i at x = i * pitch; verify the spacing matches
    expect(bars[1].x - bars[0].x).toBe(pitch);
    expect(bars[5].x - bars[4].x).toBe(pitch);
  });
});

describe("xAxisLabels thinning", () => {
  const PLOT_WIDTH = 558;
  const LABEL_WIDTH = 66;

  const mkPts = (days: number) =>
    Array.from({ length: days }, (_, i) => ({
      runId: `r${i}`,
      createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));

  /**
   * Assert that no two adjacent kept labels are closer than labelWidth pixels.
   */
  function assertNoOverlap(
    labels: Array<{ index: number; text: string }>,
    n: number,
    plotWidth: number,
    labelWidth: number,
    msg: string
  ) {
    const pitch = barPitch(n, plotWidth);
    for (let i = 1; i < labels.length; i++) {
      const gap = (labels[i].index - labels[i - 1].index) * pitch;
      expect(gap, `${msg}: gap between label[${i - 1}] (idx ${labels[i - 1].index}) and label[${i}] (idx ${labels[i].index}) = ${gap}px, want >= ${labelWidth}px`).toBeGreaterThanOrEqual(labelWidth);
    }
  }

  it("30-daily dense case (plotWidth 558, labelWidth 66): no adjacent overlap, first+last always kept", () => {
    const pts = mkPts(30);
    const labels = xAxisLabels(pts, { plotWidth: PLOT_WIDTH, labelWidth: LABEL_WIDTH });
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(29);
    assertNoOverlap(labels, 30, PLOT_WIDTH, LABEL_WIDTH, "30-daily dense");
  });

  it("clustered case (10 same-day + 4 daily): must thin the cluster even though count would fit", () => {
    // 10 runs on day 1 (same day = only 1 candidate from cluster), then 4 days each with 1 run
    // Total points: 14; candidates if not thinned: day1(idx 0), day2(idx 10), day3(idx 11), day4(idx 12), day5(idx 13)
    // At standard plotWidth, the cluster boundary at idx 10 is only 1 pitch from idx 9 boundary
    // but we care about pixel distance between KEPT labels.
    const clusterPts = Array.from({ length: 10 }, (_, i) => ({
      runId: `c${i}`,
      createdAt: `2026-05-01T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));
    const dailyPts = Array.from({ length: 4 }, (_, i) => ({
      runId: `d${i}`,
      createdAt: `2026-05-${String(i + 2).padStart(2, "0")}T10:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));
    const pts = [...clusterPts, ...dailyPts]; // 14 points total
    const labels = xAxisLabels(pts, { plotWidth: PLOT_WIDTH, labelWidth: LABEL_WIDTH });
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(13);
    assertNoOverlap(labels, 14, PLOT_WIDTH, LABEL_WIDTH, "clustered");
  });

  it("keeps all candidates when they are pixel-spaced apart (4 runs/day × 3 days)", () => {
    // Bar pitch caps at 22px (w≤18 + 4 gap), so adjacent-day labels can never fit 66px —
    // room means index distance: 4 bars/day puts boundaries 88px apart.
    const pts = Array.from({ length: 12 }, (_, i) => ({
      runId: `r${i}`,
      createdAt: `2026-05-${String(Math.floor(i / 4) + 1).padStart(2, "0")}T${String(10 + (i % 4)).padStart(2, "0")}:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));
    const labels = xAxisLabels(pts, { plotWidth: PLOT_WIDTH, labelWidth: LABEL_WIDTH });
    // candidates: day boundaries at 0, 4, 8 plus the always-kept last point (11) — all spaced ≥ 66px
    expect(labels.map((l) => l.index)).toEqual([0, 4, 8, 11]);
    assertNoOverlap(labels, 12, PLOT_WIDTH, LABEL_WIDTH, "spaced");
  });

  it("is backward compatible without a budget (no thinning)", () => {
    expect(xAxisLabels(mkPts(3))).toHaveLength(3);
  });

  it("2 points on different days (gap 22px < 66px): returns only the last label (newest)", () => {
    // 2 points, plotWidth 558, labelWidth 66 → pitch=22, gap=22 < 66 → only last survives
    const pts = [
      { runId: "a", createdAt: "2026-06-09T23:50:00.000Z", stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
      { runId: "b", createdAt: "2026-06-10T00:05:00.000Z", stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
    ];
    const labels = xAxisLabels(pts, { plotWidth: 558, labelWidth: 66 });
    expect(labels).toHaveLength(1);
    expect(labels[0].index).toBe(1);
  });

  it("3 points spanning midnight at index 2 (gap 44px < 66px): returns only the last label", () => {
    // 3 points: indices 0,1 on 2026-06-09, index 2 on 2026-06-10
    // barPitch(3, 558) = 22, candidates = [{index:0},{index:2}], gap=2*22=44 < 66 → only last survives
    const pts = [
      { runId: "a", createdAt: "2026-06-09T22:00:00.000Z", stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
      { runId: "b", createdAt: "2026-06-09T23:00:00.000Z", stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
      { runId: "c", createdAt: "2026-06-10T00:30:00.000Z", stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
    ];
    const labels = xAxisLabels(pts, { plotWidth: 558, labelWidth: 66 });
    expect(labels).toHaveLength(1);
    expect(labels[0].index).toBe(2);
  });
});
