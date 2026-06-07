import { cn } from "@/lib/utils";

/** Exported for testing: arc length for `pct`% of a circle radius `r`. */
export function donutDash(pct: number, r: number): { dash: number; circ: number } {
  const circ = 2 * Math.PI * r;
  return { dash: (Math.max(0, Math.min(100, pct)) / 100) * circ, circ };
}

export function PassRateDonut({ pct, size = 88, className }: { pct: number; size?: number; className?: string }) {
  const r = size / 2 - 8;
  const { dash, circ } = donutDash(pct, r);
  const color = pct >= 90 ? "#22C55E" : pct >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${pct}% passed`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} stroke={color}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
