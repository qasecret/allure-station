import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Run, RunStatus } from "@allure-station/shared";
import { api } from "@/main";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { relativeTime, formatDurationSec } from "@/lib/format";
import { evaluateGate } from "@/lib/quality-gate-verdict";

const PAGE = 20;
const FILTERS: Array<{ label: string; value?: RunStatus }> = [
  { label: "all" }, { label: "ready", value: "ready" }, { label: "failed", value: "failed" }, { label: "generating", value: "generating" },
];

function GateMark({ verdict }: { verdict: { passed: boolean; reasons: string[] } | null }) {
  if (!verdict) return <span aria-hidden className="text-muted-foreground">—</span>;
  const reasons = verdict.reasons.join(", ");
  return verdict.passed
    ? <span role="img" aria-label="Gate passed" className="text-status-pass-text">✓</span>
    : <span role="img" aria-label={`Gate failed: ${reasons}`} title={reasons} className="text-status-fail-text">✗</span>;
}

function RowActions({ r, canWrite, onOpenRun, retry, setConfirming }: {
  r: Run; canWrite: boolean; onOpenRun: (id: string) => void;
  retry: { isPending: boolean; mutate: (id: string) => void };
  setConfirming: (r: Run) => void;
}) {
  return (
    <span className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => onOpenRun(r.id)}>Open</Button>
      {r.status === "failed" && canWrite && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Retry</Button>}
      {canWrite && <Button size="sm" variant="outline" className="text-status-fail-text" disabled={r.status === "generating"} onClick={() => setConfirming(r)}>Delete</Button>}
    </span>
  );
}

export function RunsTable({ projectId, canWrite, onOpenRun }: {
  projectId: string;
  /** Hides destructive actions in secure mode when not signed in; true in open mode and for signed-in users. */
  canWrite: boolean;
  /** Called when the user clicks "Open" on a run — switches to the Report tab with this run selected. */
  onOpenRun: (runId: string) => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RunStatus | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<Run | null>(null);

  const { data } = useQuery({
    queryKey: ["runs-page", projectId, status ?? "all", page],
    queryFn: () => api.listRunsWithTotal(projectId, { status, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const { data: gate } = useQuery({ queryKey: ["quality-gate", projectId], queryFn: () => api.getQualityGate(projectId), retry: false });

  const del = useMutation({
    mutationFn: (runId: string) => api.deleteRun(projectId, runId),
    onSuccess: () => {
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["runs-page", projectId] });
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
      qc.invalidateQueries({ queryKey: ["trends", projectId] });
      toast.success("Run deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const retry = useMutation({
    mutationFn: (runId: string) => api.retryRun(projectId, runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs-page", projectId] });
      toast.success("Retrying generation…");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <Button key={f.label} size="sm" variant={status === f.value ? "default" : "outline"}
            aria-pressed={status === f.value}
            onClick={() => { setStatus(f.value); setPage(0); }}>{f.label}</Button>
        ))}
      </div>
      {/* Mobile card list — visible below sm */}
      <ul role="list" className="space-y-2 sm:hidden">
        {items.map((r) => {
          const verdict = gate && r.stats ? evaluateGate(gate, r.stats) : null;
          return (
            <li key={r.id} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.stats && <span className="text-sm">{r.stats.passed}/{r.stats.total}{r.stats.failed ? <span className="text-status-fail-text"> · {r.stats.failed} failed</span> : null}</span>}
                  <GateMark verdict={verdict} />
                </span>
                <span title={r.createdAt} className="text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : "—"}
                  {r.environment ? ` · ${r.environment}` : ""}
                  {r.stats?.durationMs ? ` · ${formatDurationSec(r.stats.durationMs)}` : ""}
                </span>
                <RowActions r={r} canWrite={canWrite} onOpenRun={onOpenRun} retry={retry} setConfirming={setConfirming} />
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">No runs{status ? ` with status ${status}` : ""}.</li>}
      </ul>
      {/* Desktop table — hidden below sm */}
      <div className="relative hidden overflow-x-auto rounded-xl border bg-card shadow-sm sm:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="p-2">Status</th><th scope="col" className="p-2">Result</th><th scope="col" className="p-2">Gate</th>
              <th scope="col" className="p-2">Branch</th><th scope="col" className="p-2">Env</th><th scope="col" className="p-2">Duration</th>
              <th scope="col" className="p-2">Age</th><th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const verdict = gate && r.stats ? evaluateGate(gate, r.stats) : null;
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-2"><StatusBadge status={r.status} /></td>
                  <td className="p-2">{r.stats ? <>{r.stats.passed}/{r.stats.total}{r.stats.failed ? <span className="text-status-fail-text"> · {r.stats.failed} failed</span> : null}</> : "—"}</td>
                  <td className="p-2"><GateMark verdict={verdict} /></td>
                  <td className="p-2">{r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : "—"}</td>
                  <td className="p-2">{r.environment ?? "—"}</td>
                  <td className="p-2">{r.stats?.durationMs ? formatDurationSec(r.stats.durationMs) : "—"}</td>
                  <td className="p-2"><span title={r.createdAt}>{relativeTime(r.createdAt)}</span></td>
                  <td className="p-2 text-right">
                    <RowActions r={r} canWrite={canWrite} onOpenRun={onOpenRun} retry={retry} setConfirming={setConfirming} />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No runs{status ? ` with status ${status}` : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
        <span>{page + 1} / {pages} · {total} run{total === 1 ? "" : "s"}</span>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
      <Dialog open={!!confirming} onOpenChange={(o) => { if (!o) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete run?</DialogTitle>
            <DialogDescription>
              Permanently deletes the {confirming ? relativeTime(confirming.createdAt) : ""} run
              {confirming?.commit ? ` (${confirming.commit.slice(0, 7)})` : ""}, its report, and its history contribution. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button className="bg-status-fail text-white hover:bg-status-fail/90" disabled={del.isPending}
              onClick={() => confirming && del.mutate(confirming.id)}>{del.isPending ? "Deleting…" : "Delete run"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
