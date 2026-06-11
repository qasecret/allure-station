import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import type { ProjectListItem } from "@allure-station/shared";
import { api } from "@/main";
import { PassRateDonut } from "@/components/PassRateDonut";
import { Sparkline } from "@/components/Sparkline";
import { passRate, relativeTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ProjectCard({ p }: { p: ProjectListItem }) {
  const [hovered, setHovered] = useState(false);

  // The last ready run is the source-of-truth for visual health (donut, pass line, gate chip).
  // Falls back to latestRun only when it's already "ready" so newly-created projects still show.
  // The status/time line still uses latestRun so freshness ("generating · 1m ago") is honest.
  const healthRun = p.lastReadyRun ?? (p.latestRun?.status === "ready" ? p.latestRun : null);

  const { data: trendPts } = useQuery({
    queryKey: ["trends", p.id],
    queryFn: () => api.listTrends(p.id),
    enabled: hovered && !!p.lastReadyRun,
    staleTime: 60_000,
  });

  const lr = p.latestRun;
  const pct = healthRun?.stats ? passRate(healthRun.stats) : null;
  const series = trendPts ? trendPts.map((pt) => passRate(pt.stats)) : [];

  return (
    <Link to={`/projects/${p.id}`} className="group block"
      onMouseEnter={() => setHovered(true)}
      onFocus={() => setHovered(true)}>
      <Card className="transition-shadow hover:border-primary/30 hover:shadow-md">
        <CardContent className="flex items-center gap-4 p-5">
          {pct !== null
            ? <PassRateDonut pct={pct} size={64} />
            : <div className="grid size-16 place-items-center rounded-full bg-muted"><FolderOpen className="size-6 text-muted-foreground" /></div>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold group-hover:underline">{p.displayName ?? p.id}</span>
              {p.visibility === "private" && <Badge variant="secondary" className="text-xs">private</Badge>}
              {healthRun?.gatePassed === false && (
                <Badge variant="outline" className="border-status-fail/40 text-status-fail-text text-xs">
                  <span role="img" aria-label="Gate failed" className="mr-0.5">✗</span>gate
                </Badge>
              )}
              {healthRun?.gatePassed === true && (
                <Badge variant="outline" className="border-status-pass/40 text-status-pass-text text-xs">
                  <span role="img" aria-label="Gate passed" className="mr-0.5">✓</span>gate
                </Badge>
              )}
            </div>
            {p.displayName && <p className="truncate text-xs text-muted-foreground">{p.id}</p>}
            <p className="mt-0.5 text-sm text-muted-foreground">
              {!p.latestRunId
                ? "No runs yet"
                : lr
                  ? <>{healthRun?.stats ? `${healthRun.stats.passed}/${healthRun.stats.total} passed` : lr.status}{lr.createdAt ? ` · ${relativeTime(lr.createdAt)}` : ""}</>
                  : "No runs yet"}
            </p>
          </div>
          <div className="hidden sm:block self-center">
            {series.length >= 2 && <Sparkline values={series} className="text-primary/70" />}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
