import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Run, RunStatus, TestDiff, TrendPoint } from "@allure-station/shared";
import { Settings, FileBarChart } from "lucide-react";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { RunSelector } from "@/components/RunSelector";
import { UploadDialog } from "@/components/UploadDialog";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Lifecycle ordering: a run never moves backwards. Used to drop out-of-order SSE events.
const STATUS_RANK: Record<RunStatus, number> = { pending: 0, generating: 1, ready: 2, failed: 2 };

export function Project() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState("");
  const { user } = useAuth();

  useEffect(() => {
    setSelectedRun(null);
    setBranchFilter(""); // don't carry a previous project's branch filter (could hide all its runs)
  }, [id]);

  // A read-gated project 404s for anonymous/non-members — surface that as a clear message
  // instead of a silently-empty page.
  const { isError: projectDenied } = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id), retry: false });

  // SSE drives instant updates; a slow refetch is kept only as a backstop while a run is
  // generating, so the UI still self-heals if SSE is unavailable or an event is missed.
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", id],
    queryFn: () => api.listRuns(id),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "generating") ? 5000 : false),
  });

  const { data: trends = [] } = useQuery({
    queryKey: ["trends", id],
    queryFn: () => api.listTrends(id),
    refetchInterval: () => (runs.some((r) => r.status === "generating") ? 5000 : false),
  });

  // Live updates over SSE: upsert the run on every lifecycle event, and refresh trends once a
  // run reaches a terminal status.
  useEffect(() => {
    const unsub = api.subscribeRuns(id, (event) => {
      qc.setQueryData<Run[]>(["runs", id], (prev = []) => {
        // Ignore a stale/out-of-order transition (e.g. a delayed 'generating' arriving after
        // 'ready' over independent Redis paths in bullmq mode) — never regress a run's status.
        const existing = prev.find((r) => r.id === event.run.id);
        if (existing && STATUS_RANK[event.run.status] < STATUS_RANK[existing.status]) return prev;
        const next = prev.filter((r) => r.id !== event.run.id);
        return [event.run, ...next].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      });
      if (event.run.status === "ready" || event.run.status === "failed") {
        qc.invalidateQueries({ queryKey: ["trends", id] });
      }
    });
    return unsub;
  }, [id, qc]);

  // Distinct branches across loaded runs power a client-side filter (no extra fetch).
  const branches = Array.from(new Set(runs.map((r) => r.branch).filter((b): b is string => !!b))).sort();
  const visibleRuns = branchFilter ? runs.filter((r) => r.branch === branchFilter) : runs;
  // Honor an explicit selection only while it's in the visible set, so the <select> value always
  // matches a rendered option (e.g. after a branch filter excludes the previously-selected run).
  const selectedVisible = selectedRun && visibleRuns.some((r) => r.id === selectedRun) ? selectedRun : null;
  const current = selectedVisible ?? visibleRuns.find((r) => r.status === "ready")?.id ?? visibleRuns[0]?.id ?? null;
  const cur = runs.find((r) => r.id === current);

  if (projectDenied) {
    return (
      <>
        <Topbar title="Project unavailable" />
        <main className="grid flex-1 place-items-center p-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold">Project unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This project is private or doesn't exist. If it's private, <Link to="/login" className="text-primary underline">sign in</Link> with an account that has access.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={<span className="flex items-center gap-2"><Link to="/" className="text-muted-foreground hover:text-foreground">Projects</Link><span className="text-muted-foreground">/</span><span className="truncate">{id}</span></span>}
        actions={<>
          {branches.length > 0 && (
            <Select value={branchFilter || "__all"} onValueChange={(v) => { setBranchFilter(v === "__all" ? "" : v); setSelectedRun(null); }}>
              <SelectTrigger aria-label="Filter by branch" className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">all branches</SelectItem>
                {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {current && <RunSelector runs={visibleRuns} value={current} onChange={setSelectedRun} />}
          <UploadDialog projectId={id} />
          {user && <Button variant="outline" size="icon" asChild aria-label="Project settings"><Link to={`/projects/${id}/settings`}><Settings className="size-4" /></Link></Button>}
        </>}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {cur && <StatusBadge status={cur.status} />}
          {cur?.stats && (
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{cur.stats.passed}/{cur.stats.total}</span> passed
              {cur.stats.failed ? <> · <span className="text-status-fail">{cur.stats.failed} failed</span></> : null}
              {cur.stats.broken ? <> · <span className="text-status-broken">{cur.stats.broken} broken</span></> : null}
              {cur.stats.flaky ? <> · <span className="text-status-broken">{cur.stats.flaky} flaky</span></> : null}
              {cur.stats.durationMs ? <> · {(cur.stats.durationMs / 1000).toFixed(1)}s</> : null}
            </span>
          )}
          {cur?.branch && <Badge variant="secondary">branch {cur.branch}{cur.commit ? `@${cur.commit.slice(0, 7)}` : ""}</Badge>}
          {cur?.environment && <Badge variant="secondary">env {cur.environment}</Badge>}
          {cur?.ciUrl && <a href={cur.ciUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline">CI build ↗</a>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Card className="min-w-[260px] flex-1"><CardContent className="p-4"><TrendBar points={trends} /></CardContent></Card>
          <ComparePanel projectId={id} readyRuns={runs.filter((r) => r.status === "ready")} />
        </div>
        {current
          ? <iframe title="report" className="min-h-0 flex-1 rounded-lg border bg-card"
              src={`/api/projects/${id}/runs/${current}/report/index.html`} />
          : <EmptyState icon={FileBarChart} title="No ready report yet" description={'Use “Upload & generate” to create the first report.'} />}
      </div>
    </>
  );
}

function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <span className="text-xs text-muted-foreground">Trends appear after 2+ runs.</span>;
  const w = points.length * 14;
  const anyFlaky = points.some((p) => (p.stats.flaky ?? 0) > 0);
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const anyDur = points.some((p) => (p.stats.durationMs ?? 0) > 0);
  const durLine = points.map((p, i) => `${i * 14 + 5},${42 - Math.round(((p.stats.durationMs ?? 0) / maxDur) * 36) - 2}`).join(" ");
  return (
    <div className="flex items-end gap-3">
      <svg width={w} height={44} role="img" aria-label="pass-rate, flakiness and duration trend by run">
        {points.map((p, i) => {
          const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
          const h = Math.round(rate * 38) + 2;
          const flaky = p.stats.flaky ?? 0;
          const durMs = p.stats.durationMs ?? 0;
          return (
            <g key={p.runId}>
              <rect x={i * 14} y={42 - h} width={10} height={h} fill={p.stats.failed || p.stats.broken ? "#EF4444" : "#22C55E"}>
                <title>{`${new Date(p.createdAt).toLocaleString()}\n${p.stats.passed}/${p.stats.total} passed, ${p.stats.failed} failed, ${p.stats.broken} broken${flaky ? `, ${flaky} flaky` : ""}${durMs ? `\n${(durMs / 1000).toFixed(1)}s total` : ""}`}</title>
              </rect>
              {flaky > 0 && <rect x={i * 14} y={Math.max(0, 42 - h - 3)} width={10} height={3} fill="#F59E0B" pointerEvents="none" />}
            </g>
          );
        })}
        {anyDur && <polyline points={durLine} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} opacity={0.8} pointerEvents="none" />}
      </svg>
      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Trend</span>
        {anyFlaky && <span className="text-status-broken">▮ flaky</span>}
        {anyDur && <span className="text-primary">╱ duration</span>}
      </div>
    </div>
  );
}

function ComparePanel({ projectId, readyRuns }: { projectId: string; readyRuns: Run[] }) {
  const [base, setBase] = useState<string>(() => readyRuns[1]?.id ?? "");
  const [target, setTarget] = useState<string>(() => readyRuns[0]?.id ?? "");
  const [touched, setTouched] = useState(false);
  useEffect(() => { setTouched(false); }, [projectId]);
  const readyIds = readyRuns.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = readyIds ? readyIds.split(",") : [];
    if (touched) {
      setTarget((t) => (ids.includes(t) ? t : ids[0] ?? ""));
      setBase((b) => (ids.includes(b) ? b : ids[1] ?? ""));
    } else { setTarget(ids[0] ?? ""); setBase(ids[1] ?? ""); }
  }, [readyIds, touched]);
  const { data: diff } = useQuery({
    queryKey: ["compare", projectId, base, target],
    queryFn: () => api.compareRuns(projectId, base, target),
    enabled: !!base && !!target && base !== target,
  });
  if (readyRuns.length < 2) return null;
  const pick = (set: (v: string) => void) => (v: string) => { setTouched(true); set(v); };
  const runItems = readyRuns.map((r) => (
    <SelectItem key={r.id} value={r.id}>{r.createdAt}{r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}</SelectItem>
  ));
  return (
    <Card className="min-w-[300px] flex-1">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Compare</span>
          <Select value={base} onValueChange={pick(setBase)}><SelectTrigger className="h-8 w-[180px]" aria-label="Base run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
          <span className="text-muted-foreground">→</span>
          <Select value={target} onValueChange={pick(setTarget)}><SelectTrigger className="h-8 w-[180px]" aria-label="Target run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
        </div>
        {base === target ? <p className="text-sm text-muted-foreground">Pick two different runs.</p>
          : !diff ? <p className="text-sm text-muted-foreground">Loading comparison…</p>
          : (
            <div className="flex flex-wrap gap-4">
              <Bucket label="Newly failing" color="text-status-fail" tests={diff.newlyFailing} />
              <Bucket label="Fixed" color="text-status-pass" tests={diff.fixed} />
              <Bucket label="Flaky" color="text-status-broken" tests={diff.flaky} />
              <Bucket label="Still failing" color="text-status-fail" tests={diff.stillFailing} />
              <Bucket label="Added" color="text-primary" tests={diff.added} />
              <Bucket label="Removed" color="text-muted-foreground" tests={diff.removed} />
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function Bucket({ label, color, tests }: { label: string; color: string; tests: TestDiff[] }) {
  if (tests.length === 0) return null;
  return (
    <div className="min-w-[180px]">
      <div className={`text-sm font-semibold ${color}`}>{label} ({tests.length})</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {tests.map((t) => (
          <li key={(t.historyId ?? t.fullName ?? t.name) + label}>
            {t.name}
            {t.baseStatus && t.targetStatus ? <span className="text-muted-foreground"> ({t.baseStatus}→{t.targetStatus})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
