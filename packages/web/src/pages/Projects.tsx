import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../main.js";

const PAGE_SIZE = 20;

export function Projects() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [newId, setNewId] = useState("");

  // Reset to the first page whenever the search changes.
  useEffect(() => { setPage(0); }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, page],
    queryFn: () => api.listProjects({ q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const create = useMutation({
    mutationFn: () => api.createProject(newId),
    onSuccess: () => { setNewId(""); qc.invalidateQueries({ queryKey: ["projects"] }); },
  });

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Allure Station</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="new project id" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <button disabled={!newId || create.isPending} onClick={() => create.mutate()}>Create</button>
      </div>
      {create.isError && <p style={{ color: "crimson" }}>{(create.error as Error).message}</p>}
      {isLoading ? <p>Loading…</p> : (
        <>
          <ul>{items.map((p) => (
            <li key={p.id}><Link to={`/projects/${p.id}`}>{p.id}</Link>
              {p.latestRunId ? "" : " (no runs yet)"}</li>
          ))}</ul>
          {items.length === 0 && <p style={{ color: "#888" }}>No projects{q ? ` matching “${q}”` : ""}.</p>}
          {total > PAGE_SIZE && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span style={{ fontSize: 13, color: "#666" }}>Page {page + 1} of {maxPage + 1} · {total} total</span>
              <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
