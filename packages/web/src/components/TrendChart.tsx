import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../main.js";
import { cn } from "@/lib/utils";
import { barGeometry, xAxisLabels } from "@/lib/trend-geometry";
import { formatDurationSec, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { session } from "@/lib/storage";
import type { TrendPoint } from "@allure-station/shared";

const WINDOWS = [10, 30, 100] as const;
type Window = (typeof WINDOWS)[number];

function storageKey(projectId: string) {
  return `trend-window:${projectId}`;
}

function readWindow(projectId: string): Window {
  const stored = session.get(storageKey(projectId));
  if (stored !== null) {
    const n = Number(stored);
    if ((WINDOWS as readonly number[]).includes(n)) return n as Window;
  }
  return 30;
}

// SVG plot dimensions
const PLOT_HEIGHT = 100;
const SVG_PADDING_LEFT = 34; // room for y-axis labels
const SVG_PADDING_BOTTOM = 20; // room for x-axis labels
const SVG_PADDING_RIGHT = 8;
const SVG_PADDING_TOP = 8;

function buildAriaLabel(p: TrendPoint): string {
  const date = new Date(p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = new Date(p.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const s = p.stats;
  const dur = s.durationMs ? `, ${formatDurationSec(s.durationMs)}` : "";
  const flaky = (s.flaky ?? 0) > 0 ? `, ${s.flaky} flaky` : "";
  return `${date} ${time} — ${s.passed}/${s.total} passed, ${(s.failed ?? 0) + (s.broken ?? 0)} failed${flaky}${dur}`;
}

function TooltipContent({ point }: { point: TrendPoint }) {
  const s = point.stats;
  const date = new Date(point.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = new Date(point.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{date} · {time}</div>
      <div className="text-muted-foreground">{s.passed}/{s.total} passed · {(s.failed ?? 0) + (s.broken ?? 0)} failed</div>
      {(s.flaky ?? 0) > 0 && <div className="text-amber-500">{s.flaky} flaky</div>}
      {s.durationMs ? <div className="text-muted-foreground">{formatDurationSec(s.durationMs)}</div> : null}
    </div>
  );
}

interface TrendChartInnerProps {
  points: TrendPoint[];
  onSelectRun: (id: string) => void;
}

function TrendChartInner({ points, onSelectRun }: TrendChartInnerProps) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Roving tabindex: which bar is the single tab stop (default first bar)
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const barRefs = useRef<(SVGGElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollWrapperRef = useRef<HTMLDivElement | null>(null);

  // Tooltip anchor: positioned via getBoundingClientRect relative to the card container
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);

  const plotWidth = Math.max(
    points.length * 10,
    600 - SVG_PADDING_LEFT - SVG_PADDING_RIGHT
  );
  const svgWidth = plotWidth + SVG_PADDING_LEFT + SVG_PADDING_RIGHT;
  const svgHeight = PLOT_HEIGHT + SVG_PADDING_TOP + SVG_PADDING_BOTTOM;

  const { bars, gridY } = barGeometry(points, { width: plotWidth, height: PLOT_HEIGHT });
  const labels = xAxisLabels(points);

  // Adjust bar x to account for left padding
  const barX = (i: number) => bars[i].x + SVG_PADDING_LEFT;

  // Clamp roving index so a shrinking window/dataset can't strand focus with zero tab stops
  const roving = Math.min(activeIndex, points.length - 1);

  const activeIdx = focusIndex ?? hoveredIndex;

  // Compute tooltip position from the bar's actual screen rect
  const updateTooltipPos = useCallback((i: number) => {
    const barEl = barRefs.current[i];
    const container = containerRef.current;
    if (!barEl || !container) { setTooltipPos(null); return; }
    const barRect = barEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const rawLeft = barRect.left + barRect.width / 2 - containerRect.left;
    // Clamp: not less than 80px from left, not so far right the tooltip clips
    const clampedLeft = Math.max(80, Math.min(rawLeft, containerRect.width - 80));
    const top = barRect.top - containerRect.top;
    setTooltipPos({ left: clampedLeft, top });
  }, []);

  const handleBarKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGGElement>, i: number) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectRun(points[i].runId);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        // Use clamped base so stale activeIndex can't reference out-of-bounds bars
        const base = Math.min(i, points.length - 1);
        const next = Math.min(points.length - 1, base + 1);
        barRefs.current[next]?.focus();
        setActiveIndex(next);
        setFocusIndex(next);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const base = Math.min(i, points.length - 1);
        const prev = Math.max(0, base - 1);
        barRefs.current[prev]?.focus();
        setActiveIndex(prev);
        setFocusIndex(prev);
      }
    },
    [onSelectRun, points]
  );

  // Duration polyline (only when any point has duration)
  const anyDur = points.some((p) => (p.stats.durationMs ?? 0) > 0);
  const durPoints = anyDur
    ? points
        .map((p, i) => {
          const bar = bars[i];
          if (bar.durY === null) return null;
          return `${barX(i) + bar.w / 2},${bar.durY + SVG_PADDING_TOP}`;
        })
        .filter(Boolean)
        .join(" ")
    : null;

  // Does any visible point have flaky tests?
  const anyFlaky = points.some((p) => (p.stats.flaky ?? 0) > 0);

  // Summary for screen readers
  const lastPt = points[points.length - 1];
  const summaryLabel = lastPt
    ? `Pass-rate and duration trend across ${points.length} runs; latest ${lastPt.stats.passed}/${lastPt.stats.total} passed`
    : `Pass-rate trend — ${points.length} runs`;

  return (
    // containerRef is on the outer relative div used for tooltip anchoring
    <div ref={containerRef} className="relative w-full">
      {/* Overflow-x scroll wrapper: natural SVG width, inner scroll allowed */}
      <div ref={scrollWrapperRef} className="relative overflow-x-auto">
        {/* SVG chart — rendered at natural width; scroll wrapper clips it */}
        <svg
          role="group"
          aria-label={summaryLabel}
          width={svgWidth}
          height={svgHeight}
          style={{ display: "block" }}
        >
          <title>{summaryLabel}</title>

          {/* Grid lines at 25%, 50%, 75% */}
          {gridY.map((gy, gi) => {
            const y = gy + SVG_PADDING_TOP;
            const labelPct = gi === 0 ? "25%" : gi === 1 ? "50%" : "75%";
            return (
              <g key={gy}>
                <line
                  x1={SVG_PADDING_LEFT}
                  y1={y}
                  x2={svgWidth - SVG_PADDING_RIGHT}
                  y2={y}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                />
                <text
                  x={SVG_PADDING_LEFT - 4}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono"
                  fontSize={10}
                  aria-hidden="true"
                >
                  {labelPct}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {points.map((p, i) => {
            const bar = bars[i];
            const bx = barX(i);
            const by = bar.y + SVG_PADDING_TOP;
            const isFocused = focusIndex === i;
            const isActive = activeIdx === i;

            return (
              <g
                key={p.runId}
                role="button"
                tabIndex={i === roving ? 0 : -1}
                aria-label={buildAriaLabel(p)}
                focusable="true"
                ref={(el) => { barRefs.current[i] = el; }}
                onClick={() => onSelectRun(p.runId)}
                onKeyDown={(e) => handleBarKeyDown(e, i)}
                onMouseEnter={() => { setHoveredIndex(i); updateTooltipPos(i); }}
                onMouseLeave={() => { setHoveredIndex(null); setTooltipPos(null); }}
                onFocus={() => { setFocusIndex(i); updateTooltipPos(i); }}
                onBlur={() => { setFocusIndex(null); setTooltipPos(null); }}
                style={{ cursor: "pointer", outline: "none" }}
              >
                {/* Focus/hover ring behind bar */}
                {isActive && (
                  <rect
                    x={bx - 2}
                    y={SVG_PADDING_TOP}
                    width={bar.w + 4}
                    height={PLOT_HEIGHT}
                    rx={2}
                    fill="hsl(var(--accent))"
                    opacity={0.3}
                    aria-hidden="true"
                  />
                )}
                {/* Main bar */}
                <rect
                  x={bx}
                  y={by}
                  width={bar.w}
                  height={bar.h}
                  fill={bar.failed ? "#EF4444" : "#1DB980"}
                  rx={2}
                  aria-hidden="true"
                />
                {/* Flaky amber topper */}
                {bar.flaky && (
                  <rect
                    x={bx}
                    y={Math.max(SVG_PADDING_TOP, by - 3)}
                    width={bar.w}
                    height={3}
                    fill="#F59E0B"
                    aria-hidden="true"
                  />
                )}
                {/* Focus indicator ring */}
                {isFocused && (
                  <rect
                    x={bx - 1}
                    y={by - 1}
                    width={bar.w + 2}
                    height={bar.h + 2}
                    fill="none"
                    stroke="hsl(var(--ring))"
                    strokeWidth={2}
                    rx={2}
                    aria-hidden="true"
                  />
                )}
              </g>
            );
          })}

          {/* Duration polyline */}
          {durPoints && (
            <polyline
              points={durPoints}
              fill="none"
              stroke="hsl(var(--primary-text))"
              strokeWidth={1.5}
              opacity={0.8}
              pointerEvents="none"
              aria-hidden="true"
            />
          )}

          {/* X-axis labels */}
          {labels.map((lbl) => {
            const bar = bars[lbl.index];
            const bx = barX(lbl.index);
            return (
              <text
                key={lbl.index}
                x={bx + bar.w / 2}
                y={svgHeight - 4}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground font-mono"
                aria-hidden="true"
              >
                {lbl.text}
              </text>
            );
          })}
        </svg>
      </div>

      {/* HTML tooltip: anchored via getBoundingClientRect to the active bar */}
      {activeIdx !== null && activeIdx < points.length && bars[activeIdx] && tooltipPos && (
        <div
          role="tooltip"
          id={`trend-tooltip-${activeIdx}`}
          className={cn(
            "pointer-events-none absolute z-50 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
            "min-w-[140px]"
          )}
          style={{
            left: tooltipPos.left,
            top: tooltipPos.top - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <TooltipContent point={points[activeIdx]} />
        </div>
      )}

      {/* Legend */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-[#1DB980] align-middle" aria-hidden="true" />
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-[#EF4444] align-middle" aria-hidden="true" />
          pass-rate bar
        </span>
        {anyFlaky && (
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-[#F59E0B] align-middle" aria-hidden="true" />
            flaky
          </span>
        )}
        {anyDur && (
          <span>
            <span className="mr-1" aria-hidden="true">╱</span>
            duration
          </span>
        )}
      </div>
    </div>
  );
}

export interface TrendChartProps {
  projectId: string;
  onSelectRun: (id: string) => void;
  /** When true the chart polls every 5s so it self-heals once a generating run becomes ready. */
  pollWhileGenerating?: boolean;
}

export function TrendChart({ projectId, onSelectRun, pollWhileGenerating }: TrendChartProps) {
  const [limit, setLimit] = useState<Window>(() => readWindow(projectId));

  // Reset when project changes
  useEffect(() => {
    setLimit(readWindow(projectId));
  }, [projectId]);

  const { data: points = [] } = useQuery({
    queryKey: ["trends", projectId, limit],
    queryFn: () => api.listTrends(projectId, limit),
    refetchInterval: pollWhileGenerating ? 5000 : false,
  });

  const handleWindowChange = (w: Window) => {
    setLimit(w);
    session.set(storageKey(projectId), String(w));
  };

  const hasEnoughData = points.length >= 2;

  return (
    <div className="space-y-3">
      {/* Window selector */}
      <div className="flex items-center gap-2" role="group" aria-label="Trend window">
        <span className="text-xs text-muted-foreground">Window:</span>
        {WINDOWS.map((w) => (
          <Button
            key={w}
            variant="outline"
            size="sm"
            aria-pressed={limit === w}
            className={cn(
              "h-6 px-2 text-xs",
              limit === w && "bg-accent text-accent-foreground"
            )}
            onClick={() => handleWindowChange(w)}
          >
            {w}
          </Button>
        ))}
      </div>

      {/* Chart or empty state */}
      {!hasEnoughData ? (
        <div className="flex items-center text-sm text-muted-foreground">
          <span>
            {points.length === 1
              ? "Trends appear after 2 successful runs — 1 more to go."
              : "Trends appear after 2 successful runs. Push results to start the series."}
          </span>
        </div>
      ) : (
        <TrendChartInner points={points} onSelectRun={onSelectRun} />
      )}
    </div>
  );
}
