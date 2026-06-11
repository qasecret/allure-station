import { cn } from "@/lib/utils";

/** Exported for testing: arc length for `pct`% of a circle radius `r`. */
export function donutDash(pct: number, r: number): { dash: number; circ: number } {
  const circ = 2 * Math.PI * r;
  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return { dash: (safe / 100) * circ, circ };
}

export function PassRateDonut({ pct, size = 88, className, showLabel = true }: { pct: number; size?: number; className?: string; showLabel?: boolean }) {
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const r = Math.max(1, size / 2 - 8);
  const { dash, circ } = donutDash(safePct, r);
  const color = safePct >= 90 ? "#1DB980" : safePct >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Pass rate ${safePct}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} className="stroke-border" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} stroke={color}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} />
      </svg>
      {showLabel && <span className="absolute text-sm font-semibold tabular-nums">{safePct}%</span>}
    </div>
  );
}
