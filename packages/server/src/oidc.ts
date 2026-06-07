import { randomBytes } from "node:crypto";
import { Issuer, generators, type Client } from "openid-client";
import type { OidcConfig } from "./config.js";
import type { AppDeps } from "./app.js";
import { hashPassword } from "./password.js";

export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export interface OidcLoginStart {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Injectable so routes can be tested with a fake (the real impl needs a live IdP for discovery). */
export interface OidcProvider {
  label: string;
  startLogin(): Promise<OidcLoginStart>;
  completeLogin(args: { query: Record<string, unknown>; state: string; nonce: string; codeVerifier: string }): Promise<OidcClaims>;
}

/**
 * Real provider backed by openid-client. Discovery is lazy + memoized so the server still boots when
 * the IdP is briefly unreachable (the first login retries discovery).
 */
export function createOidcProvider(cfg: OidcConfig): OidcProvider {
  let clientPromise: Promise<Client> | null = null;
  const getClient = (): Promise<Client> => {
    if (!clientPromise) {
      clientPromise = Issuer.discover(cfg.issuer)
        .then((issuer) => new issuer.Client({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uris: [cfg.redirectUri],
          response_types: ["code"],
        }))
        .catch((err) => { clientPromise = null; throw err; }); // don't cache a failed discovery
    }
    return clientPromise;
  };

  return {
    label: cfg.label,
    async startLogin() {
      const client = await getClient();
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const url = client.authorizationUrl({
        scope: cfg.scopes,
        state,
        nonce,
        code_challenge: generators.codeChallenge(codeVerifier),
        code_challenge_method: "S256",
      });
      return { url, state, nonce, codeVerifier };
    },
    async completeLogin({ query, state, nonce, codeVerifier }) {
      const client = await getClient();
      const tokenSet = await client.callback(cfg.redirectUri, query, { state, nonce, code_verifier: codeVerifier });
      const c = tokenSet.claims();
      return {
        sub: c.sub,
        email: typeof c.email === "string" ? c.email : undefined,
        emailVerified: typeof c.email_verified === "boolean" ? c.email_verified : undefined,
        name: typeof c.name === "string" ? c.name : undefined,
      };
    },
  };
}

export type OidcResolveError = "no_email" | "email_unverified" | "domain_not_allowed";

/**
 * Map verified OIDC claims to a local user id, auto-provisioning on first login (role `user`).
 * Linking/creation keys on the verified email — so email_verified must hold (overridable via config)
 * to prevent account takeover by an IdP that lets users set arbitrary unverified emails.
 */
export async function resolveOidcUser(
  deps: AppDeps,
  claims: OidcClaims,
  cfg: OidcConfig,
): Promise<{ userId: string; email: string; provisioned: boolean } | { error: OidcResolveError }> {
  const email = claims.email?.trim().toLowerCase();
  if (!email) return { error: "no_email" };
  if (claims.emailVerified !== true && !cfg.allowUnverifiedEmail) return { error: "email_unverified" };
  if (cfg.allowedDomains.length > 0) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!cfg.allowedDomains.includes(domain)) return { error: "domain_not_allowed" };
  }
  const existing = await deps.users.findByEmail(email);
  if (existing) return { userId: existing.id, email: existing.email, provisioned: false };
  // Auto-provision: random unusable local password (they sign in via SSO; can reset to use local login).
  const user = await deps.users.create(email, await hashPassword(randomBytes(32).toString("hex")), "user", deps.now());
  return { userId: user.id, email: user.email, provisioned: true };
}
