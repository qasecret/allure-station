import { describe, it, expect } from "vitest";
import { resolveOidcUser, type OidcClaims } from "./oidc.js";
import { makeTestDeps } from "./test-helpers.js";
import type { OidcConfig } from "./config.js";

const baseCfg: OidcConfig = {
  issuer: "https://idp.example", clientId: "c", clientSecret: "s",
  redirectUri: "https://app/cb", scopes: "openid email", label: "SSO",
  allowedDomains: [], allowUnverifiedEmail: false,
};
const claims = (over: Partial<OidcClaims> = {}): OidcClaims => ({ sub: "sub1", email: "alice@corp.com", emailVerified: true, name: "Alice", ...over });

describe("resolveOidcUser", () => {
  it("auto-provisions a new verified user as role 'user' (email lowercased)", async () => {
    const deps = await makeTestDeps();
    const res = await resolveOidcUser(deps, claims({ email: "Alice@Corp.com" }), baseCfg);
    expect(res).toMatchObject({ email: "alice@corp.com", provisioned: true });
    const u = await deps.users.findByEmail("alice@corp.com");
    expect(u?.role).toBe("user");
  });

  it("links to an existing local account by email (no duplicate, not provisioned)", async () => {
    const deps = await makeTestDeps();
    const existing = await deps.users.create("alice@corp.com", "scrypt$aa$bb", "admin", deps.now());
    const res = await resolveOidcUser(deps, claims(), baseCfg);
    expect(res).toEqual({ userId: existing.id, email: "alice@corp.com", provisioned: false });
    expect(await deps.users.count()).toBe(1);
  });

  it("rejects missing email and unverified email (unless allowed)", async () => {
    const deps = await makeTestDeps();
    expect(await resolveOidcUser(deps, claims({ email: undefined }), baseCfg)).toEqual({ error: "no_email" });
    expect(await resolveOidcUser(deps, claims({ emailVerified: false }), baseCfg)).toEqual({ error: "email_unverified" });
    expect(await resolveOidcUser(deps, claims({ emailVerified: undefined }), baseCfg)).toEqual({ error: "email_unverified" });
    // overridable
    const r = await resolveOidcUser(deps, claims({ emailVerified: false }), { ...baseCfg, allowUnverifiedEmail: true });
    expect(r).toMatchObject({ provisioned: true });
  });

  it("enforces the domain allowlist", async () => {
    const deps = await makeTestDeps();
    const cfg = { ...baseCfg, allowedDomains: ["corp.com"] };
    expect(await resolveOidcUser(deps, claims({ email: "bob@evil.com" }), cfg)).toEqual({ error: "domain_not_allowed" });
    expect(await resolveOidcUser(deps, claims({ email: "bob@corp.com" }), cfg)).toMatchObject({ provisioned: true });
  });
});
