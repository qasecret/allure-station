import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../main.js";
import { cn } from "@/lib/utils";
import { barGeometry, xAxisLabels } from "@/lib/trend-geometry";
import { formatDurationSec, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { TrendPoint } from "@allure-station/shared";

const WINDOWS = [10, 30, 100] as const;
type Window = (typeof WINDOWS)[number];

function storageKey(projectId: string) {
  return `trend-window:${projectId}`;
}

function readWindow(projectId: string): Window {
  try {
    const stored = sessionStorage.getItem(storageKey(projectId));
    if (stored !== null) {
      const n = Number(stored);
      if ((WINDOWS as readonly number[]).includes(n)) return n as Window;
    }
  } catch { /* ignore */ }
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
  const barRefs = useRef<(SVGGElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Measure container width responsively
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    obs.observe(el);
    setContainerWidth(el.clientWidth || 600);
    return () => obs.disconnect();
  }, []);

  const plotWidth = Math.max(
    points.length * 10,
    containerWidth - SVG_PADDING_LEFT - SVG_PADDING_RIGHT
  );
  const svgWidth = plotWidth + SVG_PADDING_LEFT + SVG_PADDING_RIGHT;
  const svgHeight = PLOT_HEIGHT + SVG_PADDING_TOP + SVG_PADDING_BOTTOM;

  const { bars, gridY } = barGeometry(points, { width: plotWidth, height: PLOT_HEIGHT });
  const labels = xAxisLabels(points);

  // Adjust bar x to account for left padding
  const barX = (i: number) => bars[i].x + SVG_PADDING_LEFT;

  const activeIdx = focusIndex ?? hoveredIndex;

  const handleBarKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGGElement>, i: number) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectRun(points[i].runId);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(points.length - 1, i + 1);
        barRefs.current[next]?.focus();
        setFocusIndex(next);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(0, i - 1);
        barRefs.current[prev]?.focus();
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

  // Summary for screen readers
  const lastPt = points[points.length - 1];
  const summaryLabel = lastPt
    ? `Pass-rate and duration trend across ${points.length} runs; latest ${lastPt.stats.passed}/${lastPt.stats.total} passed`
    : `Pass-rate trend — ${points.length} runs`;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* SVG chart */}
      <svg
        role="img"
        aria-label={summaryLabel}
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full overflow-visible"
        style={{ maxHeight: svgHeight }}
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
              tabIndex={0}
              aria-label={buildAriaLabel(p)}
              aria-pressed="false"
              focusable="true"
              ref={(el) => { barRefs.current[i] = el; }}
              onClick={() => onSelectRun(p.runId)}
              onKeyDown={(e) => handleBarKeyDown(e, i)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setFocusIndex(i)}
              onBlur={() => setFocusIndex(null)}
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

      {/* HTML tooltip: positioned over hovered/focused bar */}
      {activeIdx !== null && activeIdx < points.length && bars[activeIdx] && (
        <div
          role="tooltip"
          id={`trend-tooltip-${activeIdx}`}
          className={cn(
            "pointer-events-none absolute z-50 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
            "min-w-[140px]"
          )}
          style={{
            left: Math.min(
              barX(activeIdx) + bars[activeIdx].w / 2,
              containerWidth - 160
            ),
            top: bars[activeIdx].y + SVG_PADDING_TOP - 8,
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
}

export function TrendChart({ projectId, onSelectRun }: TrendChartProps) {
  const [limit, setLimit] = useState<Window>(() => readWindow(projectId));

  // Reset when project changes
  useEffect(() => {
    setLimit(readWindow(projectId));
  }, [projectId]);

  const { data: points = [] } = useQuery({
    queryKey: ["trends", projectId, limit],
    queryFn: () => api.listTrends(projectId, limit),
  });

  const handleWindowChange = (w: Window) => {
    setLimit(w);
    try { sessionStorage.setItem(storageKey(projectId), String(w)); } catch { /* ignore */ }
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
