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

/**
 * Returns the pixel distance between the left edges of adjacent bars (bar width + gap).
 * Used by both barGeometry and the x-axis label thinning so geometry and labels
 * can never disagree about bar spacing.
 */
export function barPitch(n: number, plotWidth: number): number {
  const gap = 4;
  const w = Math.max(6, Math.min(18, Math.floor(plotWidth / Math.max(1, n)) - gap));
  return w + gap;
}

export function barGeometry(
  points: TrendPoint[],
  plot: { width: number; height: number }
): { bars: BarGeom[]; gridY: number[] } {
  const n = points.length;
  const pitch = barPitch(n, plot.width);
  const w = pitch - 4; // gap is always 4
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const bars = points.map((p, i) => {
    const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
    const h = Math.max(2, Math.round(rate * (plot.height - 4)));
    const dur = p.stats.durationMs ?? 0;
    return {
      x: i * pitch,
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

  // Build full day-boundary candidate list (always includes first and last)
  const candidates: Array<{ index: number; text: string }> = [{ index: 0, text: day(points[0].createdAt) }];
  for (let i = 1; i < points.length; i++) {
    if (day(points[i].createdAt) !== day(points[i - 1].createdAt)) {
      candidates.push({ index: i, text: day(points[i].createdAt) });
    }
  }
  const lastIdx = points.length - 1;
  if (candidates[candidates.length - 1].index !== lastIdx) {
    candidates.push({ index: lastIdx, text: day(points[lastIdx].createdAt) });
  }

  // No budget: return all candidates unchanged (backward-compatible)
  if (!budget) return candidates;

  const { plotWidth, labelWidth } = budget;
  const pitch = barPitch(points.length, plotWidth);
  const n = candidates.length;

  // If all candidates fit without overlap, return them all
  if (n <= 1) return candidates;
  const allFit = candidates.every((c, i) => {
    if (i === 0) return true;
    return (c.index - candidates[i - 1].index) * pitch >= labelWidth;
  });
  if (allFit) return candidates;

  // Pixel-greedy pass: always keep first and last; keep an intermediate only when
  // it is at least labelWidth pixels from the last kept label AND at least
  // labelWidth pixels from the always-kept last label.
  const first = candidates[0];
  const last = candidates[n - 1];

  // If first and last are too close together, only show the last (newest date wins).
  if ((last.index - first.index) * pitch < labelWidth) return [last];

  if (n === 2) return [first, last];

  const kept: Array<{ index: number; text: string }> = [first];
  let lastKeptIdx = first.index;

  for (let i = 1; i < n - 1; i++) {
    const c = candidates[i];
    const gapFromPrev = (c.index - lastKeptIdx) * pitch;
    const gapToLast = (last.index - c.index) * pitch;
    if (gapFromPrev >= labelWidth && gapToLast >= labelWidth) {
      kept.push(c);
      lastKeptIdx = c.index;
    }
  }

  kept.push(last);
  return kept;
}
