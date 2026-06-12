import type { TrendPoint } from "@allure-station/shared";

export interface BarGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  rate: number;
  failed: boolean;
  flaky: boolean;
  durY: number | null;
}

export function barGeometry(
  points: TrendPoint[],
  plot: { width: number; height: number }
): { bars: BarGeom[]; gridY: number[] } {
  const n = points.length;
  const gap = 4;
  const w = Math.max(6, Math.min(18, Math.floor(plot.width / Math.max(1, n)) - gap));
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const bars = points.map((p, i) => {
    const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
    const h = Math.max(2, Math.round(rate * (plot.height - 4)));
    const dur = p.stats.durationMs ?? 0;
    return {
      x: i * (w + gap),
      y: plot.height - h,
      w,
      h,
      rate,
      failed: (p.stats.failed ?? 0) + (p.stats.broken ?? 0) > 0,
      flaky: (p.stats.flaky ?? 0) > 0,
      durY: dur ? plot.height - Math.round((dur / maxDur) * (plot.height - 8)) - 2 : null,
    };
  });
  return { bars, gridY: [0.25, 0.5, 0.75].map((f) => Math.round(plot.height * (1 - f))) };
}

export function xAxisLabels(
  points: TrendPoint[],
  budget?: { plotWidth: number; labelWidth: number }
): Array<{ index: number; text: string }> {
  if (points.length === 0) return [];
  const day = (iso: string) => iso.slice(0, 10);
  const labels: Array<{ index: number; text: string }> = [{ index: 0, text: day(points[0].createdAt) }];
  for (let i = 1; i < points.length; i++) {
    if (day(points[i].createdAt) !== day(points[i - 1].createdAt)) {
      labels.push({ index: i, text: day(points[i].createdAt) });
    }
  }
  const last = points.length - 1;
  if (labels[labels.length - 1].index !== last) {
    labels.push({ index: last, text: day(points[last].createdAt) });
  }

  // When a budget is provided and labels would collide, keep first + last and every k-th
  // intermediate so the total fits within Math.floor(plotWidth / labelWidth) slots.
  if (budget && labels.length * budget.labelWidth > budget.plotWidth) {
    const maxSlots = Math.max(2, Math.floor(budget.plotWidth / budget.labelWidth));
    const first = labels[0];
    const lastLabel = labels[labels.length - 1];
    const intermediates = labels.slice(1, -1);
    const slots = maxSlots - 2; // slots available for intermediates
    if (slots <= 0 || intermediates.length === 0) {
      return [first, lastLabel];
    }
    const k = Math.ceil(intermediates.length / Math.max(1, slots));
    const kept = intermediates.filter((_, idx) => idx % k === 0);
    return [first, ...kept, lastLabel];
  }

  return labels;
}
