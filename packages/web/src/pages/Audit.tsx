import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../main.js";
import { useAuth } from "../auth.js";

const PAGE = 50;

export function Audit() {
  const { user, isLoading } = useAuth();
  const [page, setPage] = useState(0);
  const { data } = useQuery({
    queryKey: ["audit", page],
    queryFn: () => api.listAudit({ limit: PAGE, offset: page * PAGE }),
    enabled: user?.role === "admin",
    placeholderData: keepPreviousData,
  });

  if (isLoading) return null;
  if (user?.role !== "admin") return <main style={{ padding: 16 }}><p>Admins only.</p></main>;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const target = (e: { targetType: string | null; targetId: string | null }) =>
    e.targetType ? `${e.targetType}${e.targetId ? `:${e.targetId}` : ""}` : "";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Audit log</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Project</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString()}</td>
              <td>{e.actorLabel}</td>
              <td>{e.action}</td>
              <td style={{ color: "var(--muted)" }}>{target(e)}</td>
              <td>{e.projectId ?? ""}</td>
              <td style={{ color: "var(--muted)" }}>{e.metadata ? JSON.stringify(e.metadata) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p style={{ color: "var(--muted)" }}>No audit events yet.</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
        <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
        <span>{total === 0 ? 0 : page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}</span>
        <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </main>
  );
}
