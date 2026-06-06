import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { Run, TrendPoint } from "@allure-station/shared";
import { api } from "../main.js";

export function Project() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    setSelectedRun(null);
  }, [id]);

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", id],
    queryFn: () => api.listRuns(id),
  });

  const { data: trends = [] } = useQuery({
    queryKey: ["trends", id],
    queryFn: () => api.listTrends(id),
  });

  // Live updates over SSE replace polling: upsert the run on every lifecycle event,
  // and refresh trends once a run reaches a terminal status.
  useEffect(() => {
    const unsub = api.subscribeRuns(id, (event) => {
      qc.setQueryData<Run[]>(["runs", id], (prev = []) => {
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
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui" }}>
      <header style={{ borderBottom: "1px solid #ddd" }}>
        <div style={{ padding: 12, display: "flex", gap: 12 }}>
          <strong>{id}</strong>
          <input type="file" multiple ref={fileInput} />
          <button disabled={upload.isPending} onClick={() => upload.mutate()}>Upload &amp; generate</button>
          <select value={current ?? ""} onChange={(e) => setSelectedRun(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.createdAt} — {r.status}{r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ padding: "4px 12px" }}><TrendBar points={trends} /></div>
      </header>
      {current
        ? <iframe title="report" style={{ flex: 1, border: 0 }}
            src={`/api/projects/${id}/runs/${current}/report/index.html`} />
        : <p style={{ padding: 12 }}>No ready report yet. Upload results to generate one.</p>}
    </main>
  );
}

function TrendBar({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return <span style={{ color: "#888", fontSize: 12 }}>Trends appear after 2+ runs.</span>;
  }
  const w = points.length * 14;
  return (
    <svg width={w} height={44} role="img" aria-label="pass-rate trend by run">
      {points.map((p, i) => {
        const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
        const h = Math.round(rate * 38) + 2;
        return (
          <rect key={p.runId} x={i * 14} y={42 - h} width={10} height={h}
            fill={p.stats.failed || p.stats.broken ? "#d9534f" : "#5cb85c"}>
            <title>{`${new Date(p.createdAt).toLocaleString()}\n${p.stats.passed}/${p.stats.total} passed, ${p.stats.failed} failed, ${p.stats.broken} broken`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
