import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { ProjectRole, Run, RunStatus, TestDiff, TrendPoint } from "@allure-station/shared";
import { api } from "../main.js";
import { useAuth } from "../auth.js";

// Lifecycle ordering: a run never moves backwards. Used to drop out-of-order SSE events.
const STATUS_RANK: Record<RunStatus, number> = { pending: 0, generating: 1, ready: 2, failed: 2 };

export function Project() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    setSelectedRun(null);
  }, [id]);

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

  const upload = useMutation({
    mutationFn: async () => {
      const files = Array.from(fileInput.current?.files ?? []);
      await api.sendResults(id, files);
      await api.generate(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", id] });
      qc.invalidateQueries({ queryKey: ["trends", id] });
    },
  });

  const current = selectedRun ?? runs.find((r) => r.status === "ready")?.id ?? null;
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <strong>{id}</strong>
          <input aria-label="Allure result files" type="file" multiple ref={fileInput} />
          <button disabled={upload.isPending} onClick={() => upload.mutate()}>Upload &amp; generate</button>
          <select aria-label="Select run to view" value={current ?? ""} onChange={(e) => setSelectedRun(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.createdAt} — {r.status}{r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ padding: "4px 12px" }}><TrendBar points={trends} /></div>
        <ComparePanel projectId={id} readyRuns={runs.filter((r) => r.status === "ready")} />
        <MembersPanel projectId={id} />
        <AuditPanel projectId={id} />
      </header>
      {current
        ? <iframe title="report" style={{ flex: 1, border: 0 }}
            src={`/api/projects/${id}/runs/${current}/report/index.html`} />
        : <p style={{ padding: 12 }}>No ready report yet. Upload results to generate one.</p>}
    </main>
  );
}

const PROJECT_ROLES: ProjectRole[] = ["viewer", "maintainer", "owner"];

// Member management — visible only to owners/admins. We detect that capability by attempting the
// owner-gated members fetch: a 401 (non-owner) leaves the query in error state and we render nothing.
function MembersPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("viewer");

  const { data: members, isError } = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => api.listMembers(projectId),
    enabled: !!user, // anonymous can't manage members; skip the request entirely
    retry: false,
  });

  const setMember = useMutation({
    mutationFn: () => api.setMember(projectId, email, role),
    onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["members", projectId] }); },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
  });

  if (!user || isError || members === undefined) return null;

  return (
    <details style={{ padding: "4px 12px", fontSize: 13 }}>
      <summary style={{ cursor: "pointer" }}>Members ({members.length})</summary>
      <form onSubmit={(e) => { e.preventDefault(); setMember.mutate(); }} style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0", flexWrap: "wrap" }}>
        <input aria-label="Member email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select aria-label="Member role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
          {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={setMember.isPending}>Add / update</button>
      </form>
      <ul style={{ margin: "2px 0", paddingLeft: 16 }}>
        {members.map((m) => (
          <li key={m.userId}>
            {m.email} — {m.role}
            <button style={{ marginLeft: 8 }} onClick={() => removeMember.mutate(m.userId)}>remove</button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Per-project audit trail — owner/admin only (detected like MembersPanel: the owner-gated fetch
// errors for everyone else and the panel hides).
function AuditPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data, isError } = useQuery({
    queryKey: ["project-audit", projectId],
    queryFn: () => api.listProjectAudit(projectId, { limit: 50 }),
    enabled: !!user,
    retry: false,
  });
  if (!user || isError || data === undefined) return null;
  return (
    <details style={{ padding: "4px 12px", fontSize: 13 }}>
      <summary style={{ cursor: "pointer" }}>Audit ({data.total})</summary>
      <ul style={{ margin: "2px 0", paddingLeft: 16, maxHeight: 200, overflow: "auto" }}>
        {data.items.map((e) => (
          <li key={e.id}>
            <span style={{ color: "var(--muted)" }}>{new Date(e.at).toLocaleString()}</span>{" "}
            <strong>{e.action}</strong> by {e.actorLabel}
            {e.metadata ? <span style={{ color: "var(--muted)" }}> {JSON.stringify(e.metadata)}</span> : null}
          </li>
        ))}
      </ul>
      {data.items.length === 0 && <p style={{ color: "var(--muted)" }}>No events yet.</p>}
    </details>
  );
}

function ComparePanel({ projectId, readyRuns }: { projectId: string; readyRuns: Run[] }) {
  // readyRuns arrive newest-first. Default: compare the newest (target) against the previous (base),
  // auto-following the latest run until the user picks their own pair.
  const [base, setBase] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [touched, setTouched] = useState(false);

  // Re-default when switching projects.
  useEffect(() => { setTouched(false); }, [projectId]);

  // Keyed on the ready-run id set (stable string) rather than the array identity, so this runs only
  // when the set of ready runs actually changes — not on every parent re-render.
  const readyIds = readyRuns.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = readyIds ? readyIds.split(",") : [];
    if (touched) {
      // Respect the user's choice; only clamp if a selected run disappeared.
      setTarget((t) => (ids.includes(t) ? t : ids[0] ?? ""));
      setBase((b) => (ids.includes(b) ? b : ids[1] ?? ""));
    } else {
      setTarget(ids[0] ?? "");
      setBase(ids[1] ?? "");
    }
  }, [readyIds, touched]);

  const { data: diff } = useQuery({
    queryKey: ["compare", projectId, base, target],
    queryFn: () => api.compareRuns(projectId, base, target),
    enabled: !!base && !!target && base !== target,
  });

  if (readyRuns.length < 2) return null;

  const pick = (set: (v: string) => void) => (e: { target: { value: string } }) => { setTouched(true); set(e.target.value); };

  const runOption = (r: Run) => (
    <option key={r.id} value={r.id}>{r.createdAt}{r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}</option>
  );

  return (
    <details style={{ padding: "4px 12px", fontSize: 13 }}>
      <summary style={{ cursor: "pointer" }}>Compare runs</summary>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
        <label>Base <select value={base} onChange={pick(setBase)}>{readyRuns.map(runOption)}</select></label>
        <span>→</span>
        <label>Target <select value={target} onChange={pick(setTarget)}>{readyRuns.map(runOption)}</select></label>
      </div>
      {base === target ? (
        <p style={{ color: "var(--muted)" }}>Pick two different runs.</p>
      ) : !diff ? (
        <p style={{ color: "var(--muted)" }}>Loading comparison…</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <Bucket label="Newly failing" color="#d9534f" tests={diff.newlyFailing} />
          <Bucket label="Fixed" color="#5cb85c" tests={diff.fixed} />
          <Bucket label="Flaky" color="#f0ad4e" tests={diff.flaky} />
          <Bucket label="Still failing" color="#d9534f" tests={diff.stillFailing} />
          <Bucket label="Added" color="#5bc0de" tests={diff.added} />
          <Bucket label="Removed" color="var(--muted)" tests={diff.removed} />
        </div>
      )}
    </details>
  );
}

function Bucket({ label, color, tests }: { label: string; color: string; tests: TestDiff[] }) {
  if (tests.length === 0) return null;
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 600, color }}>{label} ({tests.length})</div>
      <ul style={{ margin: "2px 0", paddingLeft: 16 }}>
        {tests.map((t) => (
          <li key={(t.historyId ?? t.fullName ?? t.name) + label}>
            {t.name}
            {t.baseStatus && t.targetStatus ? <span style={{ color: "var(--muted)" }}> ({t.baseStatus}→{t.targetStatus})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return <span style={{ color: "var(--muted)", fontSize: 12 }}>Trends appear after 2+ runs.</span>;
  }
  const w = points.length * 14;
  const anyFlaky = points.some((p) => (p.stats.flaky ?? 0) > 0);
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const anyDur = points.some((p) => (p.stats.durationMs ?? 0) > 0);
  // Duration sparkline: per-run total test time, normalized to the max, drawn over the bars.
  const durLine = points
    .map((p, i) => `${i * 14 + 5},${42 - Math.round(((p.stats.durationMs ?? 0) / maxDur) * 36) - 2}`)
    .join(" ");
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "flex-end" }}>
      <svg width={w} height={44} role="img" aria-label="pass-rate, flakiness and duration trend by run">
        {points.map((p, i) => {
          const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
          const h = Math.round(rate * 38) + 2;
          const flaky = p.stats.flaky ?? 0;
          const durMs = p.stats.durationMs ?? 0;
          return (
            <g key={p.runId}>
              <rect x={i * 14} y={42 - h} width={10} height={h}
                fill={p.stats.failed || p.stats.broken ? "#d9534f" : "#5cb85c"}>
                <title>{`${new Date(p.createdAt).toLocaleString()}\n${p.stats.passed}/${p.stats.total} passed, ${p.stats.failed} failed, ${p.stats.broken} broken${flaky ? `, ${flaky} flaky` : ""}${durMs ? `\n${(durMs / 1000).toFixed(1)}s total` : ""}`}</title>
              </rect>
              {/* Orange cap marks runs with flaky tests (the flakiness trend); clamped into view. */}
              {flaky > 0 && <rect x={i * 14} y={Math.max(0, 42 - h - 3)} width={10} height={3} fill="#f0ad4e" pointerEvents="none" />}
            </g>
          );
        })}
        {anyDur && <polyline points={durLine} fill="none" stroke="#337ab7" strokeWidth={1} opacity={0.7} pointerEvents="none" />}
      </svg>
      {anyFlaky && <span style={{ fontSize: 11, color: "#f0ad4e" }}>▮ flaky</span>}
      {anyDur && <span style={{ fontSize: 11, color: "#337ab7" }}>╱ duration</span>}
    </span>
  );
}
