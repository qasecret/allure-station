import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.js";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Sign in</h1>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Email
          <input aria-label="Email" type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Password
          <input aria-label="Password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" style={{ color: "#d9534f", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
