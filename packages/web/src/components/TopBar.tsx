import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.js";

/** Global identity bar: shows the signed-in user (+ admin links) or a sign-in link. */
export function TopBar() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  if (isLoading) return null;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <Link to="/" style={{ fontWeight: 600 }}>Allure Station</Link>
      <span style={{ flex: 1 }} />
      {user ? (
        <>
          {user.role === "admin" && <Link to="/users">Users</Link>}
          <span style={{ color: "var(--muted)" }}>{user.email}</span>
          <button onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>
        </>
      ) : (
        <Link to="/login">Sign in</Link>
      )}
    </div>
  );
}
