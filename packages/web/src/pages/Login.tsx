import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Panel bg is brand teal #1db980; text is dark slate for 7:1 AA contrast (axe-gate verified). */}
      <div className="relative hidden flex-col justify-between bg-[#1db980] p-10 lg:flex lg:p-14">
        <div className="flex items-center gap-3 text-lg font-bold tracking-tight text-slate-950">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/20 shadow-sm backdrop-blur-sm"><img src="/favicon.svg" alt="" className="size-6" /></span>
          Allure Station
        </div>
        <div><h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 lg:text-4xl">Your test reports, beautifully hosted.</h2><p className="mt-4 max-w-md text-lg leading-relaxed text-slate-950/90">Multi-project Allure 3 reports with trends, run comparison, and access control.</p></div>
        <span className="text-sm font-medium text-slate-950/80">Self-hosted report hub</span>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center lg:hidden"><img src="/favicon.svg" alt="Allure Station" className="mx-auto size-12" /></div>
          <div><h1 className="text-xl font-semibold">Sign in to Allure Station</h1><p className="mt-1 text-sm text-muted-foreground">Use SSO or your email and password.</p></div>
          {config?.oidc.enabled && (
            <>
              <Button asChild variant="outline" className="w-full"><a href="/api/auth/oidc/login">Sign in with {config.oidc.label ?? "SSO"}</a></Button>
              <div className="relative text-center text-xs text-muted-foreground"><span className="bg-background px-2">or</span><div className="absolute inset-x-0 top-1/2 -z-10 border-t" /></div>
            </>
          )}
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
