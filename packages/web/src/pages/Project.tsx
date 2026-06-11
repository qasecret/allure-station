import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Run, RunStatus, TestDiff, TestHistoryEntry, Regression, RunRef, TrendPoint } from "@allure-station/shared";
import { Settings, FileBarChart, TrendingUp, GitCompareArrows, History, ShieldCheck, ShieldAlert, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { relativeTime, runLabel, formatDurationSec } from "@/lib/format";
import { parseReportFragment, buildReportFragment, withReportHash } from "@/lib/report-deep-link";
import { failedReasons } from "@/lib/quality-gate-verdict";
import { severityChipClass } from "@/lib/severity";
import { RunsTable } from "@/components/RunsTable";

// Lifecycle ordering: a run never moves backwards. Used to drop out-of-order SSE events.
const STATUS_RANK: Record<RunStatus, number> = { pending: 0, generating: 1, ready: 2, failed: 2 };

export function Project() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRun = searchParams.get("run");
  const setSelectedRun = (runId: string | null) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (runId) next.set("run", runId); else next.delete("run");
      return next;
    }, { replace: true });
  };
  const [branchFilter, setBranchFilter] = useState("");
  const [tab, setTab] = useState<"report" | "runs">("report");
  const [focusReport, setFocusReport] = useState(false);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const announceSeq = useRef(0);
  const { user } = useAuth();

  useEffect(() => {
    setBranchFilter(""); // don't carry a previous project's branch filter (could hide all its runs)
    setTab("report"); // reset to report tab when navigating to a new project
    setFocusReport(false); // exit focus mode when switching projects
  }, [id]);

  // A read-gated project 404s for anonymous/non-members — surface that as a clear message
  // instead of a silently-empty page.
  const { isError: projectDenied, data: project } = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id), retry: false });
  // canWrite comes from the server (already part of GET /projects/:id) so the UI always reflects
  // the authoritative permission state — undefined → false while loading (no destructive buttons
  // visible until the server confirms write access).
  const canWrite = project?.canWrite ?? false;

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

  // Live updates over SSE: handle deletions first, then upsert lifecycle events.
  // Refresh trends once a run reaches a terminal status.
  useEffect(() => {
    const unsub = api.subscribeRuns(id, (event) => {
      // A deletion event removes the run from both caches and refreshes paginated/trend views.
      if (event.deleted) {
        qc.setQueryData<Run[]>(["runs", id], (prev = []) => prev.filter((r) => r.id !== event.run.id));
        qc.invalidateQueries({ queryKey: ["runs-page", id] });
        qc.invalidateQueries({ queryKey: ["trends", id] });
        // C5: also invalidate test-history and the deleted run's summary so they don't show stale data.
        qc.invalidateQueries({ queryKey: ["test-history", id] });
        qc.invalidateQueries({ queryKey: ["run-summary", id, event.run.id] });
        // C1: read the CURRENT ?run= value at event time (not the closed-over searchParams object
        // which was captured when the effect ran and doesn't update on navigation).
        const currentRun = new URLSearchParams(window.location.search).get("run");
        if (currentRun === event.run.id) setSelectedRun(null);
        return;
      }
      qc.setQueryData<Run[]>(["runs", id], (prev = []) => {
        // Ignore a stale/out-of-order transition (e.g. a delayed 'generating' arriving after
        // 'ready' over independent Redis paths in bullmq mode) — never regress a run's status.
        // EXCEPT a retry, which legitimately moves a terminal 'failed' run back to 'generating'.
        const existing = prev.find((r) => r.id === event.run.id);
        const isRetry = existing?.status === "failed" && event.run.status === "generating";
        if (existing && !isRetry && STATUS_RANK[event.run.status] < STATUS_RANK[existing.status]) return prev;
        const next = prev.filter((r) => r.id !== event.run.id);
        return [event.run, ...next].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      });
      // Keep the paginated runs table live on every run event (status changes are always relevant).
      qc.invalidateQueries({ queryKey: ["runs-page", id] });
      if (event.run.status === "ready" || event.run.status === "failed") {
        qc.invalidateQueries({ queryKey: ["trends", id] });
        // A newly-ready run adds a point to every open test timeline — refresh them too.
        qc.invalidateQueries({ queryKey: ["test-history", id] });
        setAnnouncement({ id: ++announceSeq.current, text: event.run.status === "ready"
          ? `Run from ${relativeTime(event.run.createdAt)} is ready`
          : `Run from ${relativeTime(event.run.createdAt)} failed to generate` });
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
  // The most recent COMPLETED run (ready/failed). If it failed and isn't what we're showing, surface a
  // banner — so a failure isn't hidden behind an older report, even when a newer run is still generating.
  const latestDone = visibleRuns.find((r) => r.status === "ready" || r.status === "failed");

  // Ref to the report iframe; used to mirror the Allure SPA's internal hash into the parent URL.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Capture the initial #report= once (lazy so parsing runs exactly once, not on every render).
  // runId is set to the first run that consumed the hash; subsequent run switches must not re-apply it.
  // requestedRun captures the ?run= at page load so we can detect a fallback (deleted/missing run).
  const initialDeepLink = useRef<{ hash: string | null; runId: string | null; requestedRun: string | null } | null>(null);
  if (initialDeepLink.current === null) {
    initialDeepLink.current = {
      hash: parseReportFragment(window.location.hash),
      runId: null,
      requestedRun: new URLSearchParams(window.location.search).get("run"),
    };
  }
  // C4(a): pin the run that first consumes the hash; if the resolved run differs from the
  // originally requested run (i.e. we fell back to a different run), drop the hash entirely.
  if (current && initialDeepLink.current.runId === null) {
    const d = initialDeepLink.current;
    if (d.requestedRun && d.requestedRun !== current) d.hash = null;
    d.runId = current;
  }

  // C4(b): once the user navigates away from the deep-linked run, consume the hash permanently
  // so switching back to it doesn't jump to a stale test position.
  useEffect(() => {
    const d = initialDeepLink.current;
    if (d?.runId && current && current !== d.runId) d.hash = null;
  }, [current]);

  // Poll the iframe's location hash and mirror it to the parent URL fragment.
  // When the inner hash is empty or just "#" (fresh load / run switch), clean up the parent fragment.
  // Note: history.replaceState writes bypass react-router, so useLocation().hash is stale by design here.
  useEffect(() => {
    const t = setInterval(() => {
      const frame = frameRef.current;
      if (!frame?.contentWindow) return;
      try {
        // C4(c): only trust the inner hash once the report document has committed — about:blank's
        // pathname is "" or "/" and doesn't contain "/report/", so we skip it entirely.
        if (!frame.contentWindow.location.pathname.includes("/report/")) return;
        const inner = frame.contentWindow.location.hash;
        // Treat "#" (Allure's default root hash) the same as empty — no meaningful test selected.
        const meaningfulInner = inner && inner !== "#" ? inner : "";
        if (meaningfulInner) {
          const outer = buildReportFragment(meaningfulInner);
          if (window.location.hash !== outer) {
            history.replaceState(null, "", window.location.pathname + window.location.search + outer);
          }
        } else if (window.location.hash.startsWith("#report=")) {
          // Inner hash cleared — remove the stale parent fragment (e.g. after run switch).
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } catch { /* cross-origin or detached frame — ignore */ }
    }, 500);
    return () => clearInterval(t);
  }, [current]);

  if (projectDenied) {
    return (
      <>
        <Topbar title="Project unavailable" />
        <main className="grid flex-1 place-items-center p-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold">Project unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This project is private or doesn't exist. If it's private, <Link to="/login" className="text-primary-text underline">sign in</Link> with an account that has access.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={<span className="flex items-center gap-2"><Link to="/" className="text-muted-foreground hover:text-foreground">Projects</Link><span className="text-muted-foreground">/</span><span className="truncate">{project?.displayName ?? id}</span></span>}
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
        <p key={announcement.id} aria-live="polite" role="status" className="sr-only">{announcement.text}</p>
        {/* The latest completed run failed but isn't what we're showing (a prior ready report is) —
            surface it, since otherwise the failure + retry would be hidden behind the run selector. */}
        {latestDone?.status === "failed" && current !== latestDone.id && (
          <button type="button" onClick={() => setSelectedRun(latestDone.id)}
            className="flex items-center gap-2 rounded-lg border border-status-fail/40 bg-status-fail/5 px-3 py-2 text-left text-sm text-status-fail hover:bg-status-fail/10">
            <AlertTriangle className="size-4 shrink-0" />
            <span>The latest run failed to generate. <span className="underline">View &amp; retry</span></span>
          </button>
        )}
        <div className={cn("flex flex-wrap items-center gap-3", focusReport && tab === "report" && "hidden")}>
          {cur && <StatusBadge status={cur.status} />}
          {cur?.stats && (
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{cur.stats.passed}/{cur.stats.total}</span> passed
              {cur.stats.failed ? <> · <span className="text-status-fail">{cur.stats.failed} failed</span></> : null}
              {cur.stats.broken ? <> · <span className="text-status-broken">{cur.stats.broken} broken</span></> : null}
              {cur.stats.flaky ? <> · <span className="text-status-broken">{cur.stats.flaky} flaky</span></> : null}
              {cur.stats.durationMs ? <> · {formatDurationSec(cur.stats.durationMs)}</> : null}
            </span>
          )}
          {cur?.status === "ready" && current && <GateBadge projectId={id} runId={current} />}
          {cur?.branch && <Badge variant="secondary">branch {cur.branch}{cur.commit ? `@${cur.commit.slice(0, 7)}` : ""}</Badge>}
          {cur?.environment && <Badge variant="secondary">env {cur.environment}</Badge>}
          {cur?.ciUrl && <a href={cur.ciUrl} target="_blank" rel="noreferrer" className="text-sm text-primary-text underline">CI build ↗</a>}
          {current && (
            <Button variant="ghost" size="sm" className="text-muted-foreground"
              onClick={async () => {
                try {
                  const u = new URL(window.location.href);
                  if (current) u.searchParams.set("run", current);
                  await navigator.clipboard.writeText(u.toString());
                  toast.success("Link copied");
                } catch {
                  toast.error("Couldn't copy — copy the URL from the address bar");
                }
              }}>
              Copy link
            </Button>
          )}
        </div>
        <div className={cn("flex flex-wrap gap-3", focusReport && tab === "report" && "hidden")}>
          <Card className="min-w-[260px] flex-1">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><TrendingUp className="size-5" /></span>
              <TrendBar points={trends} />
            </CardContent>
          </Card>
          <ComparePanel projectId={id} readyRuns={runs.filter((r) => r.status === "ready")} />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "report" | "runs")} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="runs">Runs</TabsTrigger>
            </TabsList>
            {tab === "report" && (
              <Button variant="ghost" size="icon" aria-label="Focus report" aria-pressed={focusReport}
                onClick={() => setFocusReport((v) => !v)}>
                {focusReport ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            )}
          </div>
          <TabsContent value="report" className="flex min-h-0 flex-1 flex-col">
            {cur?.status === "failed"
              ? <FailedRunPanel projectId={id} run={cur} />
              : current
                ? <iframe ref={frameRef} title="report" className="min-h-0 flex-1 rounded-xl border bg-card shadow-sm"
                    src={withReportHash(`/api/projects/${id}/runs/${current}/report/index.html`, current === initialDeepLink.current?.runId ? initialDeepLink.current.hash : null)} />
                : <EmptyState icon={FileBarChart} title="No ready report yet" description={'Use "Upload & generate" to create the first report.'} />}
          </TabsContent>
          <TabsContent value="runs" className="flex min-h-0 flex-1 flex-col">
            <RunsTable projectId={id} canWrite={canWrite} onOpenRun={(runId) => { setSelectedRun(runId); setTab("report"); }} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// A failed run has no report to embed; show the captured error and a one-click retry (which re-runs
// generation against the still-staged results). SSE flips the run back to generating/ready live.
function FailedRunPanel({ projectId, run }: { projectId: string; run: Run }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.retryRun(projectId, run.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs", projectId] }); toast.success("Retrying generation…"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="grid min-h-0 flex-1 place-items-center rounded-xl border bg-card p-6 shadow-sm">
      <div className="max-w-lg text-center">
        <AlertTriangle className="mx-auto size-8 text-status-fail" />
        <h2 className="mt-3 text-lg font-semibold">Generation failed</h2>
        {run.error
          ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-left text-xs text-muted-foreground">{run.error}</pre>
          : <p className="mt-2 text-sm text-muted-foreground">No error detail was captured.</p>}
        <Button className="mt-4" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {retry.isPending ? "Retrying…" : "Retry generation"}
        </Button>
      </div>
    </div>
  );
}

// Surfaces the configured quality-gate verdict for the selected run in the header. Silent when no
// gate is configured; on failure it names the rules that tripped (the badge SVG only shows pass/fail).
function GateBadge({ projectId, runId }: { projectId: string; runId: string }) {
  const { data } = useQuery({
    queryKey: ["run-summary", projectId, runId],
    queryFn: () => api.getRunSummary(projectId, runId),
    retry: false, // summary is read-gated → 404s for private projects; don't retry-storm (matches ["project"])
  });
  const gate = data?.qualityGate;
  if (!gate?.configured) return null;
  if (gate.passed) {
    return (
      <Badge variant="outline" className="gap-1 border-status-pass/40 text-status-pass">
        <ShieldCheck className="size-3.5" /> Quality gate passed
      </Badge>
    );
  }
  const reasons = failedReasons(gate);
  return (
    <Badge variant="outline" className="gap-1 border-status-fail/40 text-status-fail">
      <ShieldAlert className="size-3.5" /> Quality gate failed
      {reasons.length ? <span className="font-normal text-muted-foreground">({reasons.join(", ")})</span> : null}
    </Badge>
  );
}

function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex flex-1 items-center text-sm text-muted-foreground">
        <span>
          {points.length === 1
            ? "Trends appear after 2 successful runs — 1 more to go."
            : "Trends appear after 2 successful runs. Push results to start the series."}
        </span>
      </div>
    );
  }
  const w = points.length * 14;
  const anyFlaky = points.some((p) => (p.stats.flaky ?? 0) > 0);
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const anyDur = points.some((p) => (p.stats.durationMs ?? 0) > 0);
  const durLine = points.map((p, i) => `${i * 14 + 5},${42 - Math.round(((p.stats.durationMs ?? 0) / maxDur) * 36) - 2}`).join(" ");
  return (
    <div className="flex items-end gap-3">
      <svg width={w} height={44} role="img" aria-label={`Pass-rate and duration trend across ${points.length} runs; latest ${points[points.length - 1].stats.passed}/${points[points.length - 1].stats.total} passed`}>
        {points.map((p, i) => {
          const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
          const h = Math.round(rate * 38) + 2;
          const flaky = p.stats.flaky ?? 0;
          const durMs = p.stats.durationMs ?? 0;
          return (
            <g key={p.runId}>
              <rect x={i * 14} y={42 - h} width={10} height={h} fill={p.stats.failed || p.stats.broken ? "#EF4444" : "#1DB980"}>
                <title>{`${new Date(p.createdAt).toLocaleString()}\n${p.stats.passed}/${p.stats.total} passed, ${p.stats.failed} failed, ${p.stats.broken} broken${flaky ? `, ${flaky} flaky` : ""}${durMs ? `\n${formatDurationSec(durMs)} total` : ""}`}</title>
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
        {anyDur && <span className="text-primary-text">╱ duration</span>}
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
  const [selected, setSelected] = useState<TestDiff | null>(null);
  useEffect(() => { setSelected(null); }, [base, target]); // don't leave the drawer open across a comparison change
  if (readyRuns.length < 2) return null;
  const pick = (set: (v: string) => void) => (v: string) => { setTouched(true); set(v); };
  const runItems = readyRuns.map((r) => (
    <SelectItem key={r.id} value={r.id}><span title={r.createdAt}>{runLabel(r)}</span></SelectItem>
  ));
  return (
    <Card className="min-w-[300px] flex-1">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><GitCompareArrows className="size-5" /></span>
          <span className="mr-1 font-semibold">Compare</span>
          <Select value={base} onValueChange={pick(setBase)}><SelectTrigger className="h-8 w-[180px]" aria-label="Base run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
          <span className="text-muted-foreground">→</span>
          <Select value={target} onValueChange={pick(setTarget)}><SelectTrigger className="h-8 w-[180px]" aria-label="Target run"><SelectValue /></SelectTrigger><SelectContent>{runItems}</SelectContent></Select>
        </div>
        {base === target ? <p className="text-sm text-muted-foreground">Pick two different runs.</p>
          : !diff ? <p className="text-sm text-muted-foreground">Loading comparison…</p>
          : (
            <div className="flex flex-wrap gap-4">
              <Bucket label="Newly failing" color="text-status-fail" tests={diff.newlyFailing} onOpen={setSelected} />
              <Bucket label="Fixed" color="text-status-pass" tests={diff.fixed} onOpen={setSelected} />
              <Bucket label="Flaky" color="text-status-broken" tests={diff.flaky} onOpen={setSelected} />
              <Bucket label="Still failing" color="text-status-fail" tests={diff.stillFailing} onOpen={setSelected} />
              <Bucket label="Added" color="text-primary-text" tests={diff.added} onOpen={setSelected} />
              <Bucket label="Removed" color="text-muted-foreground" tests={diff.removed} onOpen={setSelected} />
            </div>
          )}
        <TestHistorySheet projectId={projectId} test={selected} onClose={() => setSelected(null)} />
      </CardContent>
    </Card>
  );
}

function SeverityChip({ severity }: { severity?: string | null }) {
  const cls = severityChipClass(severity);
  if (!cls) return null;
  return <span title={severity ?? undefined} className={`shrink-0 rounded px-1 text-[10px] font-medium uppercase ${cls}`}>{severity}</span>;
}

function Bucket({ label, color, tests, onOpen }: { label: string; color: string; tests: TestDiff[]; onOpen: (t: TestDiff) => void }) {
  if (tests.length === 0) return null;
  return (
    <div className="min-w-[180px]">
      <div className={`text-sm font-semibold ${color}`}>{label} ({tests.length})</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {tests.map((t) => {
          const meta = [t.suite, t.owner].filter(Boolean).join(" · ");
          return (
          <li key={(t.historyId ?? t.fullName ?? t.name) + label} className="flex items-center gap-1">
            <SeverityChip severity={t.severity} />
            {meta ? (
              <span title={meta} className="max-w-[10rem] shrink truncate text-xs text-muted-foreground">{meta}</span>
            ) : null}
            <span>{t.name}{t.baseStatus && t.targetStatus ? <span className="text-muted-foreground"> ({t.baseStatus}→{t.targetStatus})</span> : null}</span>
            {(t.historyId ?? t.fullName) ? (
              <button type="button" onClick={() => onOpen(t)} aria-label={`History for ${t.name}`}
                className="ml-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <History className="size-3.5" />
                <span>History</span>
              </button>
            ) : null}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  passed: "text-status-pass", failed: "text-status-fail", broken: "text-status-broken",
  skipped: "text-muted-foreground", unknown: "text-muted-foreground",
};

function TestHistorySheet({ projectId, test, onClose }: { projectId: string; test: TestDiff | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["test-history", projectId, test?.historyId, test?.fullName],
    queryFn: () => api.getTestHistory(projectId, { historyId: test!.historyId ?? undefined, fullName: test!.fullName ?? undefined, name: test!.name, limit: 50 }),
    enabled: !!test && !!(test.historyId ?? test.fullName),
  });
  return (
    <Sheet open={!!test} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">{test?.name ?? "Test history"}</SheetTitle>
        </SheetHeader>
        {!data ? <p className="mt-4 text-sm text-muted-foreground">Loading history…</p> : (
          <div className="mt-4 space-y-3">
            <Badge variant="secondary">Flaky {Math.round(data.flakeRate * 100)}% over {data.window} run{data.window === 1 ? "" : "s"}</Badge>
            {data.regression ? <RegressionHint regression={data.regression} entries={data.entries} /> : null}
            <ul className="space-y-2">
              {data.entries.map((e: TestHistoryEntry) => (
                <li key={e.runId} className="rounded-lg border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${STATUS_COLOR[e.status]}`}>{e.status}</span>
                    {e.flaky ? <span className="text-status-broken">flaky</span> : null}
                    <span className="text-muted-foreground" title={e.createdAt}>{relativeTime(e.createdAt)}</span>
                    {e.commit ? <span className="text-muted-foreground">· {e.commit.slice(0, 7)}</span> : null}
                    {e.ciUrl ? <a href={e.ciUrl} target="_blank" rel="noreferrer" className="text-primary-text hover:underline">CI</a> : null}
                  </div>
                  {e.message ? <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{e.message}</pre> : null}
                  {e.hasTrace && test ? <TraceDetails projectId={projectId} test={test} runId={e.runId} /> : null}
                </li>
              ))}
              {data.entries.length === 0 ? <li className="text-sm text-muted-foreground">No history for this test yet.</li> : null}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RegressionHint({ regression, entries }: { regression: Regression; entries: TestHistoryEntry[] }) {
  const link = (ref: RunRef) => {
    const ciUrl = entries.find((e) => e.runId === ref.runId)?.ciUrl ?? null;
    const label = relativeTime(ref.createdAt);
    return ciUrl
      ? <a href={ciUrl} target="_blank" rel="noreferrer" title={ref.createdAt} className="text-primary-text hover:underline">{label}</a>
      : <span title={ref.createdAt}>{label}</span>;
  };
  if (regression.windowLimited) {
    return (
      <p className="text-sm text-status-fail">
        Failing for at least the last {regression.failingRunCount} run{regression.failingRunCount === 1 ? "" : "s"} — no passing run in view.
      </p>
    );
  }
  return (
    <p className="text-sm text-status-fail">
      Failing since {link(regression.firstFailed)}
      {regression.firstFailed.commit ? <span className="text-muted-foreground"> · {regression.firstFailed.commit.slice(0, 7)}</span> : null}
      {regression.lastPassed ? <> — last passed {link(regression.lastPassed)}</> : null}
    </p>
  );
}

// Lazily fetches a single entry's stack trace only when expanded, so the ≤16 KB blob isn't
// transported with the timeline for every run.
function TraceDetails({ projectId, test, runId }: { projectId: string; test: TestDiff; runId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["test-trace", projectId, runId, test.historyId, test.fullName],
    queryFn: () => api.getTestTrace(projectId, { runId, historyId: test.historyId ?? undefined, fullName: test.fullName ?? undefined }),
    enabled: open,
  });
  return (
    <details className="mt-1" onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Stack trace</summary>
      {open ? (
        data === undefined
          ? <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
          : <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{data.trace ?? "(no trace)"}</pre>
      ) : null}
    </details>
  );
}
