# Slice 5d — OIDC / SSO (the final roadmap item)

**Goal:** External single sign-on via a generic OIDC provider, coexisting with 5b local
password login — modeled on ReportPortal (external SSO alongside internal auth, auto-provision
external users as a regular USER, roles managed in-app).

**Decisions (locked w/ user — "like ReportPortal"):**
- **Generic OIDC** (issuer discovery + client id/secret), authorization-code + PKCE, via
  `openid-client@5.7.1`. One code path for Keycloak/Okta/Auth0/Entra/Google.
- **Auto-provision** on first login: a verified-email user with no local account is created as
  global role `user` (optional `OIDC_ALLOWED_DOMAINS` allowlist). Existing local user with the same
  (verified) email is linked — email is the join key.
- **Local role management** — OIDC authenticates identity only; admin/owner/maintainer/viewer stay
  in-app. Local password login stays available.

## Config (config.ts)
`config.oidc` present only when `OIDC_ISSUER` set:
`{ issuer, clientId, clientSecret, redirectUri, scopes (default "openid email profile"),
   label (OIDC_LABEL default "SSO"), allowedDomains?, allowUnverifiedEmail (default false) }`.
`redirectUri` defaults to `${publicUrl}/api/auth/oidc/callback` when PUBLIC_URL set.

## oidc.ts
- `OidcProvider` interface (injectable → unit-testable; real impl backs onto openid-client with
  **lazy, memoized discovery** so the server boots even if the IdP is briefly unreachable):
  - `label: string`
  - `startLogin(): { url, state, nonce, codeVerifier }` (PKCE S256, openid-client generators)
  - `completeLogin({ query, state, nonce, codeVerifier }): Promise<OidcClaims>` (client.callback →
    normalized `{ sub, email?, emailVerified?, name? }`)
- `resolveOidcUser(deps, claims, cfg): Promise<{ userId; provisioned }>` — PURE-ish, unit-tested:
  reject if no email / unverified (unless allowUnverifiedEmail) / domain not allowed; else
  findByEmail → link, or auto-provision (random unusable password, role user).

## Routes (auth.ts)
- `GET /api/auth/oidc/login` → 404 if not configured; else startLogin, set short-lived httpOnly
  cookie `as_oidc` = JSON{state,nonce,codeVerifier} (sameSite=lax so it survives the IdP round-trip
  on the top-level GET callback; path=/api/auth/oidc; maxAge 600; secure=cookieSecure), 302 to url.
- `GET /api/auth/oidc/callback` → read+clear `as_oidc` (400 if missing); completeLogin; resolveOidcUser;
  issue the same DB-backed session cookie as local login; audit `login` (+ `user_created` if
  provisioned); 302 to `/` (SPA). On any failure → 302 to `/login?error=sso`.

## /config (meta.ts)
Return `{ securityEnabled: usersExist, oidc: { enabled, label }, allure }` so the SPA can render the
SSO button without guessing.

## Web
- `api/client.ts` `getConfig()`; Login page fetches it and shows a **"Sign in with <label>"** button
  (a plain link to `/api/auth/oidc/login`) when `oidc.enabled`; shows an error banner on `?error=sso`.

## Tests
- Unit: `resolveOidcUser` (provision new, link existing, reject no-email/unverified/blocked-domain);
  callback route with an **injected fake OidcProvider** (provision→session+audit, link, verified-email
  enforcement, missing-cookie 400, failure→redirect); `/login` sets cookie + 302s to provider url;
  `/config` reflects oidc enabled/disabled; routes 404 when OIDC unconfigured.
- Live: stand up **Dex** (lightweight OIDC) in docker; verify discovery + `/login` 302 to Dex authorize
  with correct client_id/redirect_uri/PKCE; attempt the full browser flow (document if interactive
  login form makes pure-curl impractical — the callback logic is fully unit-covered).

## Notes / follow-ups
- Account-takeover guard: require `email_verified === true` to link/provision (overridable only via
  explicit `OIDC_ALLOW_UNVERIFIED_EMAIL=true`).
- Provider adapter (openid-client glue) is thin and excluded from unit tests (needs network) — covered
  by the live Dex smoke.
- Follow-ups: IdP-group→role mapping (deferred — local roles for now), single-logout (RP-style),
  refresh-token handling (we only need the id_token at login).
