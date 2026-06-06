import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
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
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "generating") ? 1500 : false),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const files = Array.from(fileInput.current?.files ?? []);
      await api.sendResults(id, files);
      await api.generate(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs", id] }),
  });

  const current = selectedRun ?? runs.find((r) => r.status === "ready")?.id ?? null;
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui" }}>
      <header style={{ padding: 12, borderBottom: "1px solid #ddd", display: "flex", gap: 12 }}>
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
      </header>
      {current
        ? <iframe title="report" style={{ flex: 1, border: 0 }}
            src={`/api/projects/${id}/runs/${current}/report/index.html`} />
        : <p style={{ padding: 12 }}>No ready report yet. Upload results to generate one.</p>}
    </main>
  );
}
