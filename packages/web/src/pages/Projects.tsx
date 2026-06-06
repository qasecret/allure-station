import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../main.js";

export function Projects() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [newId, setNewId] = useState("");
  const { data = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const create = useMutation({
    mutationFn: () => api.createProject(newId),
    onSuccess: () => { setNewId(""); qc.invalidateQueries({ queryKey: ["projects"] }); },
  });

  const shown = data.filter((p) => p.id.includes(filter));
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Allure Station</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <input placeholder="new project id" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <button disabled={!newId || create.isPending} onClick={() => create.mutate()}>Create</button>
      </div>
      {create.isError && <p style={{ color: "crimson" }}>{(create.error as Error).message}</p>}
      {isLoading ? <p>Loading…</p> : (
        <ul>{shown.map((p) => (
          <li key={p.id}><Link to={`/projects/${p.id}`}>{p.id}</Link>
            {p.latestRunId ? "" : " (no runs yet)"}</li>
        ))}</ul>
      )}
    </main>
  );
}
