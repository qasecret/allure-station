import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";
import type { OidcClaims, OidcProvider } from "../oidc.js";
import type { OidcConfig } from "../config.js";

const cfg: OidcConfig = {
  issuer: "https://idp.example", clientId: "c", clientSecret: "s",
  redirectUri: "https://app/api/auth/oidc/callback", scopes: "openid email", label: "TestIdP",
  allowedDomains: [], allowUnverifiedEmail: false,
};

// Inject a fake provider so the routes are exercised without a live IdP.
function withOidc(deps: AppDeps, claims: OidcClaims | (() => Promise<OidcClaims>)): AppDeps {
  const provider: OidcProvider = {
    label: cfg.label,
    startLogin: async () => ({ url: "https://idp.example/authorize?client_id=c", state: "st", nonce: "no", codeVerifier: "cv" }),
    completeLogin: async () => (typeof claims === "function" ? claims() : claims),
  };
  return { ...deps, oidc: provider, oidcConfig: cfg };
}

const OK_COOKIE = JSON.stringify({ state: "st", nonce: "no", codeVerifier: "cv" });

describe("OIDC routes", () => {
  it("are absent (404) when OIDC is not configured", async () => {
    const app = buildApp(await makeTestDeps());
    expect((await app.inject({ method: "GET", url: "/api/auth/oidc/login" })).statusCode).toBe(404);
    await app.close();
  });

  it("/config advertises the provider when configured", async () => {
    const app = buildApp(withOidc(await makeTestDeps(), { sub: "s", email: "a@x.com", emailVerified: true }));
    expect((await app.inject({ method: "GET", url: "/api/config" })).json()).toMatchObject({ oidc: { enabled: true, label: "TestIdP" } });
    await app.close();
  });

  it("login sets the flow cookie and 302s to the IdP authorize URL", async () => {
    const app = buildApp(withOidc(await makeTestDeps(), { sub: "s", email: "a@x.com", emailVerified: true }));
    const res = await app.inject({ method: "GET", url: "/api/auth/oidc/login" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("https://idp.example/authorize");
    const cookie = res.cookies.find((c) => c.name === "as_oidc")!;
    expect(cookie.httpOnly).toBe(true);
    expect(JSON.parse(cookie.value)).toMatchObject({ state: "st", codeVerifier: "cv" });
    await app.close();
  });

  it("callback provisions the user, starts a session, and redirects to /", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(withOidc(deps, { sub: "s", email: "alice@corp.com", emailVerified: true }));
    const res = await app.inject({ method: "GET", url: "/api/auth/oidc/callback?code=abc&state=st", cookies: { as_oidc: OK_COOKIE } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    const session = res.cookies.find((c) => c.name === "as_session");
    expect(session?.value).toBeTruthy();

    // the new session authenticates as the provisioned user
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { as_session: session!.value } });
    expect(me.json()).toMatchObject({ email: "alice@corp.com", role: "user" });

    // audit recorded user_created (via oidc) + login
    const actions = (await deps.audit.list()).map((e) => e.action);
    expect(actions).toContain("user_created");
    expect(actions).toContain("login");
    await app.close();
  });

  it("callback redirects to /login?error=sso on missing cookie, unverified email, or provider error", async () => {
    // missing cookie
    let app = buildApp(withOidc(await makeTestDeps(), { sub: "s", email: "a@x.com", emailVerified: true }));
    expect((await app.inject({ method: "GET", url: "/api/auth/oidc/callback?code=x&state=st" })).headers.location).toBe("/login?error=sso");
    await app.close();

    // unverified email → resolveOidcUser error
    app = buildApp(withOidc(await makeTestDeps(), { sub: "s", email: "a@x.com", emailVerified: false }));
    expect((await app.inject({ method: "GET", url: "/api/auth/oidc/callback?code=x&state=st", cookies: { as_oidc: OK_COOKIE } })).headers.location).toBe("/login?error=sso");
    await app.close();

    // provider.completeLogin throws (bad code / state mismatch)
    app = buildApp(withOidc(await makeTestDeps(), async () => { throw new Error("state mismatch"); }));
    expect((await app.inject({ method: "GET", url: "/api/auth/oidc/callback?code=x&state=st", cookies: { as_oidc: OK_COOKIE } })).headers.location).toBe("/login?error=sso");
    await app.close();
  });
});
