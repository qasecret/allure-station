import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../main.js";
import { useAuth } from "../auth.js";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") === "sso" ? "Single sign-on failed. Try again or use a password." : null);
  const [busy, setBusy] = useState(false);

  const { data: config } = useQuery({ queryKey: ["config"], queryFn: () => api.getConfig() });

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
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <img src="/favicon.svg" alt="Allure Station" width={56} height={56} style={{ display: "inline-block" }} />
        <h1 style={{ fontSize: 20, margin: "10px 0 0" }}>Sign in to Allure Station</h1>
      </div>
      {config?.oidc.enabled && (
        <>
          {/* Plain link, not fetch: the browser must follow the 302 to the IdP. */}
          <a href="/api/auth/oidc/login" style={{ display: "block", textAlign: "center", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 4, marginBottom: 12 }}>
            Sign in with {config.oidc.label ?? "SSO"}
          </a>
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, margin: "8px 0" }}>or</div>
        </>
      )}
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
