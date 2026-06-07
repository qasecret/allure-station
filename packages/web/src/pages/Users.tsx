import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlobalRole } from "@allure-station/shared";
import { api } from "../main.js";
import { useAuth } from "../auth.js";

export function Users() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<GlobalRole>("user");
  const [error, setError] = useState<string | null>(null);

  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers(), enabled: user?.role === "admin" });
  const create = useMutation({
    mutationFn: () => api.createUser(email, password, role),
    onSuccess: () => { setEmail(""); setPassword(""); setError(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: Error) => setError(e.message.includes("409") ? "Email already in use." : "Could not create user (password must be 8+ chars)."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (isLoading) return null;
  if (user?.role !== "admin") return <main style={{ padding: 16 }}><p>Admins only.</p></main>;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Users</h1>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <input aria-label="New user email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input aria-label="New user password" type="password" placeholder="password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <select aria-label="New user role" value={role} onChange={(e) => setRole(e.target.value as GlobalRole)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" disabled={create.isPending}>Add user</button>
      </form>
      {error && <p role="alert" style={{ color: "#d9534f" }}>{error}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td style={{ textAlign: "right" }}>
                {u.id !== user.id && <button onClick={() => remove.mutate(u.id)}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
