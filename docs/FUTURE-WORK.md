# Allure Station — Future Work / Gap Analysis

> The 5-phase roadmap (core → scale/live → modern UX → CI/DevOps → auth & notifications) is **complete**.
> This document captures what a real **company automation user** would still want next, so we can pick
> up deliberately later. Framed from the perspective of an engineer pushing results from CI and
> triaging failures daily. Ordered by value/impact, not by effort.
>
> Last updated: 2026-06-07.

## What already exists (so we don't re-litigate)

Ingest → embed Allure 3 → store → serve + React UI; S3/Postgres/BullMQ scale; live SSE updates;
trend dashboards (pass rate / flakiness / duration); run comparison; project search + pagination;
dark mode + a11y + Playwright e2e; scoped API tokens; GitHub Action; quality gates + PR status
checks/comments; status badges; Slack + generic-webhook notifications; user accounts + per-project
RBAC (owner/maintainer/viewer) + global admin; local password login + **OIDC/SSO**; append-only
audit log.

---

## High-value gaps (the ones that unlock the most)

### 1. Run metadata: branch, commit, CI build URL, environment  ✅ DONE (Slice 6a, 2026-06-07)
Runs now carry `branch` / `commit` / `environment` / `ci_url` (nullable). Accepted as multipart text
fields on `send-results`, returned on the run, surfaced in the UI (enriched run labels + a metadata
caption with a CI link) with a client-side branch filter, and exposed via `GET …/runs?branch=`. The
GitHub Action auto-derives branch/commit/ci_url from the GitHub context (+ an `environment` input).
**Remaining stretch:** branch-aware *trend deltas* and PR-vs-base comparison scoping (now unblocked).

### 2. Private / read-gated reports  ✅ DONE (Slice 6b, 2026-06-07)
Per-project `visibility` (`public` default | `private`). Private gates all reads (project/runs/report/
trends/compare/events/summary) behind admin / `viewer+` membership / project token via `readGate`
(returns 404 — existence hidden); the project list is filtered by the caller; **badge stays public**
(aggregate counts only — accepted trade-off). Owner/admin toggle via `PUT /projects/:id/visibility`
(audited); web toggle in the Members panel + a "private/sign in" message on denied access.
**Deferred hardening:** write routes still 404-then-401 (existence disclosure via management endpoints —
pre-existing, instance-wide; make all management routes 404-on-unauthorized to fully hide); a central
read preHandler (fail-closed default vs per-route readGate); `inArray` bound limit for users in 1000+
projects (use a membership subquery); badge optionally per-project opt-out.

### 3. Per-test history + cross-run search
**Problem:** the daily triage question — "is this test *newly* failing or always flaky, and when did
it start?" — has no answer; `test_results` exist per run (for comparison) but there's no cross-run
query. **Sketch:** index test results by `historyId`/`fullName`; endpoints to search by name/status/
error and to return a single test's pass/fail timeline + flake rate; a test-detail UI view.

### 4. Known-issues / mute / failure categorization
**Problem:** no way to mark a failure as product-bug vs test-bug vs environment, link it to a ticket,
or **mute a known flaky so it doesn't trip the quality gate** — so gates get ignored. **Why it
matters:** this is the core triage workflow (ReportPortal's main value prop). **Sketch:** per-project
"known issue" rules (match by test id / error signature) with mute + ticket link; gate evaluation
skips muted; show annotations in run/compare views. Manual first; ML auto-analysis is a far-future
stretch.

### 5. CI breadth — a language-agnostic CLI + recipes
**Problem:** only a GitHub Action exists; most shops also run GitLab/Jenkins/Azure/CircleCI.
**Sketch:** a small `allure-station` CLI (`upload → generate → poll`, reads a token + run metadata
from env) that works in any pipeline and locally; documented GitLab/Jenkins/Azure recipes.

### 6. Sharded / parallel run aggregation ("launches")
**Problem:** a CI matrix produces N shards → N separate runs. **Sketch:** a "launch" that aggregates
shards (by a CI run id) into one logical report + one set of stats/trends — matches how suites
actually run.

---

## Operational table-stakes (for running it in prod)

- **Retention & quotas, enforced:** auto-prune old runs/artifacts; per-project storage caps. Disk
  grows forever otherwise. (A periodic sweeper pattern already exists — `startReconciler`.)
- **Observability:** Prometheus `/metrics`, structured logs, health/readiness endpoints.
- **Login rate-limiting:** bounds `login_failed` audit growth + brute force (already flagged in 5c/5d).
- **Periodic sweepers:** expired sessions (5b) and (if added) old audit rows.
- **Backup/restore docs** for the DB + storage bucket.

## More integrations

- **Email/SMTP** notifications (deferred in 5a — currently webhook-only).
- **MS Teams**, and **Jira** (open/link a ticket from a failure).
- **Per-user "watch"** subscriptions, not just per-project.
- **Shareable read-only run links** with expiry (paste into a bug / share with a vendor).

## Identity / org (builds on 5b)

- **Organizations / teams:** group projects + group membership; org-level admins.
- **IdP group → role mapping** + SCIM provisioning (deferred in 5d — roles are local today).
- **Single sign-out** (RP-style); **read vs write API-token scopes**.
- **Account-linking hardening:** bind OIDC `sub`/issuer on first login (TOFU) instead of email-only.

## Known follow-ups carried from shipped slices

- 5b: per-project private visibility (= gap #2), periodic session sweeper, MembersPanel effective-role
  from the server (not failing-fetch), `cookieSecure` via `X-Forwarded-Proto`, RBAC-enable doesn't
  auto-revoke zero-config-minted tokens.
- 5c: login rate-limiting, req-bound audit hook (vs per-route `recordAudit` drift), pagination-guard
  dedupe across repos, PII (emails) visible to project owners in per-project audit (accepted).
- 5d: OIDC `sub`/TOFU binding, `OIDC_ALLOW_UNVERIFIED_EMAIL` is a takeover escape hatch,
  `OIDC_ALLOWED_DOMAINS` isn't a boundary vs a permissive multi-tenant issuer, `/config` could use an
  exists-probe instead of `count()`.
- Cross-phase niceties: content-addressed asset dedupe, i18n, cross-run status-instability flakiness,
  branch-aware trend deltas (depends on gap #1).

## Test-infra note

e2e persists `DATA_DIR` at `packages/e2e/.e2e-data` and the search spec doesn't self-clean — stale
accumulated projects can fail it. `rm -rf packages/e2e/.e2e-data` before running. (Pre-existing
test-isolation gap; worth fixing when next in the e2e files.)

---

**Suggested next slice:** #1 (run metadata) — smallest contained change with the widest downstream
payoff. #2 (private reports) is the likely adoption blocker. #3 + #4 are the daily-triage win.

## Auth: split 401/403 on write routes

The server currently returns the same `401 {"error":"unauthorized"}` for an expired/missing
session AND for a signed-in user below the required role, so the web client cannot tell
"sign in again" apart from "ask for write access" (`packages/web/src/lib/errors.ts` ships
combined copy as a bridge). Fix at the server: keep `401` for unauthenticated principals,
return `403` for authenticated-but-insufficient-role — then tighten the client mapping.
Touches: `auth.ts` authorize helpers, route tests asserting 401, OpenAPI error declarations.
