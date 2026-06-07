# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for an
unpatched vulnerability.

- Preferred: open a [GitHub private security advisory](https://github.com/qasecret/allure-station/security/advisories/new).
- Include: affected version/commit, a description, reproduction steps or a proof
  of concept, and the impact you observed.

We aim to acknowledge a report within a few business days and will keep you
updated on remediation. Coordinated disclosure is appreciated — please give us a
reasonable window to ship a fix before any public write-up.

## Scope

In scope: the server API, worker, web UI, authentication/RBAC/OIDC, the audit
log, and the published Docker image / compose files. Out of scope: issues that
require a pre-existing admin/owner role, social engineering, or misconfiguration
of the operator's own infrastructure (reverse proxy, IdP, network egress).

## Hardening notes for operators

Allure Station is **secure-by-default through progressive disclosure** but a few
deployment choices materially affect your security posture:

- **Reads are public by default.** Report contents are readable without auth;
  tokens/RBAC protect integrity, not confidentiality. Front it with your own
  access layer if reports are sensitive (per-project private visibility is a
  planned feature).
- **Terminate TLS and set `PUBLIC_URL=https://…` (or `COOKIE_SECURE=true`)** so
  session and OIDC cookies carry the `Secure` flag.
- **Never set `OIDC_ALLOW_UNVERIFIED_EMAIL=true`** unless you fully trust the IdP
  — it disables the `email_verified` check and enables email-based account
  takeover.
- **Restrict who can configure webhooks.** The server fetches webhook URLs; an
  SSRF guard blocks loopback/private/link-local IP literals, but internal
  *hostnames* are allowed by design — apply network egress controls on
  internet-exposed instances.
- **Rotate API tokens** after enabling accounts/RBAC; tokens minted while a
  project was open remain valid until revoked.
