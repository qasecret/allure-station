import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import type { Project } from "@allure-station/shared";
import { api } from "@/main";
import { PassRateDonut } from "@/components/PassRateDonut";
import { Sparkline } from "@/components/Sparkline";
import { passRate, relativeTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ProjectCard({ p }: { p: Project }) {
  const hasRuns = !!p.latestRunId;
  // Enrich from the runs endpoint (no stats on the project list item). Cached + reused on the project page.
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", p.id],
    queryFn: () => api.listRuns(p.id),
    enabled: hasRuns,
    staleTime: 30_000,
  });
  const sorted = [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  const latest = sorted[0];
  const latestReady = sorted.find((r) => r.status === "ready" && r.stats);
  const pct = latestReady?.stats ? passRate(latestReady.stats) : null;
  const series = [...sorted].reverse().filter((r) => r.stats).map((r) => passRate(r.stats!)); // oldest->newest

  return (
    <Link to={`/projects/${p.id}`} className="group block">
      <Card className="transition-shadow hover:border-primary/30 hover:shadow-md">
        <CardContent className="flex items-center gap-4 p-5">
          {pct !== null
            ? <PassRateDonut pct={pct} size={64} />
            : <div className="grid size-16 place-items-center rounded-full bg-muted"><FolderOpen className="size-6 text-muted-foreground" /></div>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold group-hover:text-primary">{p.id}</span>
              {p.visibility === "private" && <Badge variant="secondary" className="text-xs">private</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {!hasRuns
                ? "No runs yet"
                : latest
                  ? <>{latestReady?.stats ? `${latestReady.stats.passed}/${latestReady.stats.total} passed` : `${runs.length} run${runs.length === 1 ? "" : "s"}`}{latest.createdAt ? ` · ${relativeTime(latest.createdAt)}` : ""}</>
                  : "Loading…"}
            </p>
          </div>
          {series.length >= 2 && <Sparkline values={series} className="self-center text-primary/70" />}
        </CardContent>
      </Card>
    </Link>
  );
}
