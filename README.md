<div align="center">

<p align="center">
  <img src="branding/allure-station-github-1280x640.png" alt="Allure Station — self-hosted Allure 3 report hub" width="900">
</p>

# Allure Station

**A self-hosted, multi-project [Allure 3](https://allurereport.org/) report hub for your whole organization.**

Push test results from any CI, generate rich reports, track trends and flakiness,
gate pull requests, and control access with accounts, RBAC, and SSO — all in one container.

[![Release](https://img.shields.io/github/v/release/qasecret/allure-station?color=1db980&label=release)](https://github.com/qasecret/allure-station/releases)
[![License](https://img.shields.io/github/license/qasecret/allure-station?color=success)](LICENSE)
[![Allure](https://img.shields.io/badge/Allure-3.9_embedded-FF6C37)](https://allurereport.org/)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)

[Quick start](#quick-start) · [Screenshots](#screenshots) · [User guide](docs/user-guide/README.md) · [Configuration](#configuration) · [API](#api-at-a-glance)

</div>

> A single TypeScript codebase on **Allure 3**: Allure is **embedded** (no Java CLI, no bash glue), storage and database are **pluggable**, and it scales from one container to a multi-replica deployment **by configuration, not rewrite**.

---

## Contents

[Highlights](#highlights) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Quick start](#quick-start) · [Documentation](#documentation) · [Configuration](#configuration) · [Security &amp; access](#security--access) · [CI/CD integration](#cicd-integration) · [Analytics](#analytics) · [Deployment](#deployment-topologies) · [API](#api-at-a-glance) · [Development](#development) · [Status](#project-status) · [Contributing](#contributing)

---

## Highlights

| Capability | What you get |
|---|---|
| **Embedded Allure 3** | Reports generated in-process via `@allurereport/*` — no CLI shelling, no Java. |
| **Multi-project hub** | Many projects, each with its own runs, history, trends, and access control. Projects carry a display name shown alongside the id. |
| **Pluggable storage** | Local filesystem (zero-config) or any S3-compatible backend (MinIO, AWS S3). |
| **SQLite → Postgres** | Zero-config SQLite by default; switch to Postgres for multi-instance — same schema. |
| **Scales by config** | In-process queue, or BullMQ + Redis with horizontally-scaled worker replicas. |
| **Live updates** | Server-Sent Events stream run status to the UI in real time — no polling. |
| **Instance status overview** | Home page **status strip** shows failing-project count, gate-breach count, runs in the last 24 h, and actively-generating runs at a glance — tiles are live-refreshed and clickable to jump straight to triage. |
| **Worst-first sort** | Sort the project grid by **Worst first** (gate-breached → lowest pass-rate → no runs) or **Recently active** to surface problems immediately; sort selection is URL-persistent (`?sort=worst`). |
| **Trends &amp; comparison** | Pass-rate / flakiness / duration **trend chart** per project with configurable look-back window (10 / 30 / 100 runs), keyboard-navigable bars, and a run-click-to-select shortcut. Diff any two runs (new failures, fixed, flaky) in a collapsible Compare panel. The project page **stats row** shows pass rate, failures, duration, and flaky count with deltas versus the previous run. |
| **Per-test history** | Every test's outcome timeline across runs, with a "failing since" regression hint. |
| **Sortable runs table** | The **Runs tab** lists every run with retry/delete actions and a **shareable deep link** (`?run=`). Column headers for Status, Duration, and Age are sortable (click to cycle desc → asc → default). |
| **Run metadata** | Branch, commit, environment, and CI build URL attached at upload — via API fields or the upload dialog's optional **CI context** panel (values are remembered per project). |
| **CI/CD native** | Reusable GitHub Action, quality gates, PR status checks &amp; comments, status badges. |
| **Notifications** | Slack &amp; generic-webhook on completion / failure / gate breach / regression. |
| **Enterprise auth** | Accounts + per-project RBAC, scoped API tokens, **OIDC/SSO**, private projects. **Filterable audit log** (by action, actor, time window) with CSV export and humanized event descriptions. |
| **Responsive &amp; accessible** | Full mobile support (drawer nav, adaptive tables, report focus mode) with an axe-core accessibility gate in CI. All charts meet WCAG AA contrast and support keyboard navigation. |

## Screenshots

Browse projects and runs, read the embedded Allure report, track trends, and trace any test's history across runs — with light/dark themes.

<p align="center">
  <img src="docs/user-guide/images/01-projects-list.png" alt="Projects list — every project with latest-run status at a glance" width="49%" />
  <img src="docs/user-guide/images/03-project-overview.png" alt="Project overview — runs, trends, and quality-gate verdicts" width="49%" />
</p>
<p align="center">
  <img src="docs/user-guide/images/04-allure-report-test-detail.png" alt="Embedded Allure 3 report — full test detail with steps and attachments" width="49%" />
  <img src="docs/user-guide/images/05-test-history-regression-hint.png" alt="Per-test history with the 'failing since' regression hint" width="49%" />
</p>

> 📸 These four are just the start — the **[end-user guide](docs/user-guide/README.md)** walks through every screen, and the [quick start](#quick-start) brings up the full UI at `http://localhost:5050` in one command.

## Architecture

```mermaid
flowchart LR
  CI["CI pipeline"] -- "POST results (+token)" --> API
  Dev["Browser / SSO"] --> API
  IdP["OIDC IdP"] -. "auth-code + PKCE" .-> API

  subgraph AS["Allure Station"]
    API["Fastify API<br/>ingest · auth · serve · audit"]
    Q(["Job queue<br/>in-process / BullMQ"])
    W["Worker<br/>embeds Allure 3"]
    API --> Q --> W
  end

  API --> DB[("Metadata<br/>SQLite / Postgres")]
  W --> STO[("Artifacts &amp; reports<br/>Local / S3")]
  API --> STO
  API -. "SSE · Slack / webhooks" .-> Dev
```

**Request flow:** CI uploads raw results (scoped token) → API persists them and enqueues a generate job → worker loads history, runs the Allure 3 pipeline, writes the report to storage and indexes the run in the DB → UI/API list projects, serve reports, and render DB-backed trends; the worker streams progress to the UI over SSE.

<details>
<summary><b>Monorepo layout &amp; tech stack</b></summary>

```text
packages/
  server/   Fastify API — ingest, generate (embeds Allure 3), serve, auth, RBAC, audit
  worker/   report-generation job processor (in-process or BullMQ)
  web/      React 18 + Vite single-page UI
  shared/   zod contracts + types shared by server and web
  e2e/      Playwright full-stack tests
docker/         Dockerfile + docker-compose (postgres / bullmq / minio profiles)
github-action/  reusable upload → generate → gate action
docs/           user guide, architecture spec, per-slice plans, FUTURE-WORK.md
```

| Layer | Choice |
|---|---|
| Runtime | Node ≥ 20, TypeScript (ESM) |
| API | Fastify 4 |
| Allure | `@allurereport/*` core 3.9 — embedded programmatically |
| Database | Drizzle ORM — SQLite/libsql (default) or Postgres |
| Storage | Pluggable `StorageDriver` — Local FS or S3-compatible |
| Queue &amp; events | In-process (default) or BullMQ + Redis pub/sub |
| Web | React 18 + Vite + TanStack Query |
| Auth | scrypt + httpOnly cookie sessions · project API tokens · OIDC/SSO |
| Contracts | zod (single source of truth, shared server ↔ web) |
| Monorepo | pnpm workspaces + Turborepo |

</details>

## Quick start

**Prerequisites:** Docker is the only requirement to run it. (To develop: Node ≥ 20 and pnpm 9 — see [Development](#development).)

**Run the published image** — single container, zero config, data persisted in a named volume:

```bash
docker run -p 5050:5050 -v allure-data:/data ghcr.io/qasecret/allure-station:1
```

<details>
<summary><b>Or build from source</b> (no image pull — clones the repo and builds locally)</summary>

```bash
git clone https://github.com/qasecret/allure-station.git
cd allure-station
docker compose -f docker/docker-compose.yml up
```

The first build takes a few minutes; subsequent starts are instant. The compose file is also the entry point for the optional Postgres / BullMQ / MinIO [profiles](#deployment-topologies).

</details>

Either way the service listens on **`:5050`** and serves both the API (`/api`) and the web UI (`/`). Data persists in the `allure-data` volume (local filesystem, zero-config).

**Push your first report** (zero-config mode — no auth required until you add a token or an account):

```bash
# 1) create a project
curl -XPOST localhost:5050/api/projects -H 'content-type: application/json' -d '{"id":"my-app"}'

# 2) upload Allure result files (the *-result.json / *-container.json files your
#    test run produces — any Allure adapter for Pytest, Jest, JUnit, etc. emits them)
#    Optional CI context: -F branch=main -F commit=$SHA -F environment=staging -F ciUrl=$BUILD_URL
curl -XPOST localhost:5050/api/projects/my-app/send-results -F files=@allure-results/abc-result.json

# 3) generate the report (async → 202 Accepted), then open the UI
curl -XPOST localhost:5050/api/projects/my-app/generate
```

Open **http://localhost:5050** and watch the run go `generating → ready` live.

> 🧪 No result files handy? The user guide's [Appendix C](docs/user-guide/README.md#appendix-c--reproduce-the-demo-dataset) builds a realistic two-run demo (green baseline → regression) from the open-source [kotest-examples-allure](https://github.com/kotest/kotest-examples-allure) suite — the same dataset behind all the screenshots.

## Documentation

| Resource | What's inside |
|---|---|
| **[End-user guide](docs/user-guide/README.md)** | Screenshot-by-screenshot walkthrough of every feature — from first upload to RBAC, gates, and audit. |
| **[Interactive API docs](#api-documentation)** | Swagger UI at `/api/docs`, OpenAPI 3.1 at `/api/openapi.json`, generated from the zod contracts. |
| **[GitHub Action](github-action/)** | The reusable upload → generate → gate action, plus GitLab CI and Jenkins recipes. |
| **[Roadmap &amp; gap analysis](docs/FUTURE-WORK.md)** | What's shipped, what's next, and why. |
| **[Security policy](SECURITY.md)** | How to report a vulnerability privately. |

## Configuration

All configuration is via environment variables. Everything has a sensible zero-config default — you only set what you change.

<details open>
<summary><b>Core</b></summary>

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5050` | HTTP port. |
| `DATA_DIR` | `./data` | Base directory for the SQLite file + local storage. |
| `PUBLIC_URL` | _(none)_ | Absolute base URL — makes report links in notifications absolute, defaults the OIDC redirect URI, and auto-enables Secure cookies on `https://`. |
| `WORK_DIR` | `$DATA_DIR/work` | Scratch directory for generation jobs. |

</details>

<details>
<summary><b>Storage — Local (default) or S3-compatible</b></summary>

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` or `s3`. |
| `STORAGE_ROOT` | `$DATA_DIR/storage` | Root for local storage. |
| `S3_ENDPOINT` | _(AWS)_ | Custom endpoint, e.g. `http://minio:9000`. |
| `S3_REGION` | `us-east-1` | Region. |
| `S3_BUCKET` | _(required for s3)_ | Bucket name. |
| `S3_FORCE_PATH_STYLE` | `true` | Set `false` for AWS virtual-hosted-style. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | _(SDK default chain)_ | Optional when using IAM/instance roles. |

</details>

<details>
<summary><b>Database — SQLite (default) or Postgres</b></summary>

| Variable | Default | Description |
|---|---|---|
| `DB_DRIVER` | `sqlite` | `sqlite` or `postgres`. |
| `DB_FILE` | `$DATA_DIR/allure-station.db` | SQLite file path. |
| `DATABASE_URL` | _(required for postgres)_ | e.g. `postgresql://user:pass@host:5432/db`. |

Drizzle migrations apply automatically on startup. After a schema change, regenerate for **both** dialects: `pnpm --filter @allure-station/server db:generate:sqlite` and `db:generate:pg`.

</details>

<details>
<summary><b>Job queue &amp; generation</b></summary>

| Variable | Default | Description |
|---|---|---|
| `QUEUE_DRIVER` | `inprocess` | `inprocess` (single container) or `bullmq` (scaled workers). |
| `REDIS_URL` | _(required for bullmq)_ | e.g. `redis://redis:6379`. |
| `GENERATE_CONCURRENCY` | `2` | Max concurrent generation jobs per process. |
| `GENERATE_STALE_MS` | `1800000` | A run stuck `generating` longer than this is reconciled to `failed`. Set above your slowest report. |

> **BullMQ mode requires shared Postgres + shared storage (S3 or shared volume)** — the API and worker(s) are separate processes over the same data. SQLite + local FS are single-process only.

</details>

<details>
<summary><b>Accounts, sessions &amp; OIDC/SSO</b></summary>

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | _(none)_ | Seed/upsert a global admin on startup (idempotent). |
| `SESSION_TTL_MS` | `604800000` (7d) | Session lifetime. |
| `COOKIE_SECURE` | _(auto)_ | Force the Secure cookie flag; auto-on when `PUBLIC_URL` is `https`. |
| `TRUST_PROXY` | `false` | Set `true` or `1` when the server runs behind a reverse-proxy/load-balancer that sets `X-Forwarded-For`/`X-Forwarded-Proto`. **Do not enable on a directly-exposed server** (spoofable headers). Session IPs are only recorded when this is enabled. |
| `BRAND_NAME` | `Allure Station` | White-label display name shown in the UI title, sidebar, and login page. |
| `BRAND_TAGLINE` | `Your test reports, beautifully hosted.` | Tagline shown on the login page below the product name. |
| `BRAND_LOGO_URL` | _(none)_ | URL of a custom logo image (shown on the login page). Falls back to the default Allure Station logo when unset. |
| `OIDC_ISSUER` | _(none)_ | Issuer URL (OIDC discovery). Setting it enables SSO. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | _(required for oidc)_ | From your IdP's client registration. |
| `OIDC_REDIRECT_URI` | from `PUBLIC_URL` | `…/api/auth/oidc/callback`; must match the IdP registration. |
| `OIDC_SCOPES` | `openid email profile` | Must include `openid`. |
| `OIDC_LABEL` | `SSO` | Sign-in button text. |
| `OIDC_ALLOWED_DOMAINS` | _(any)_ | Comma-separated email-domain allowlist. |
| `OIDC_ALLOW_UNVERIFIED_EMAIL` | `false` | **Dangerous** — disables the `email_verified` requirement (enables email-based takeover). Leave off. |

</details>

## Security &amp; access

Allure Station is **secure-by-default through progressive disclosure**: it runs fully open in zero-config dev mode, and tightens automatically the moment you introduce credentials or accounts.

- **Scoped API tokens (CI).** Per-project, least-privilege bearer tokens for pipelines. A project with no tokens is open; once it has one, writes require a token scoped to that project. Tokens are stored sha256-hashed; the plaintext is shown **once**. A token for project A can never write to project B.
- **Accounts + RBAC (humans).** Seed a global **admin**, then manage users and grant per-project roles — **`owner` / `maintainer` / `viewer`**. Writes need `maintainer+` (or a token); member/token management needs `owner`/admin. Local email+password login issues an httpOnly, DB-backed session (cookie hashed at rest).
- **Private projects.** Reads are public by default (tokens/RBAC protect *integrity*); flip a project to **private** (`PUT /api/projects/:id/visibility`) and reads — runs, reports, trends, badge — require `viewer+`, admin, or a project token.
- **OIDC / SSO.** Add "Sign in with …" for any OIDC provider (Keycloak, Okta, Auth0, Entra, Google) via authorization-code + PKCE. First-time users are **auto-provisioned** as `user` (keyed on verified email; existing accounts are linked). Local login stays available.
- **Audit log.** Append-only record of sensitive actions (logins, user/token/member/project/visibility/gate/notification changes). `GET /api/audit` (admin), `GET /api/projects/:id/audit` (owner).

> **SSRF guard:** the server fetches webhook URLs you configure. URLs must be http(s) and may not target loopback/private/link-local **IP literals** or `localhost` (rejected at create + dispatch). Internal *hostnames* are allowed; on an internet-exposed instance, restrict who can configure webhooks and apply egress controls.

## CI/CD integration

Push results from any pipeline with the reusable **[GitHub Action](github-action/)** (upload → generate → wait; fails the job if generation fails). The action README also has copy-paste **GitLab CI** and **Jenkins** recipes (the same three HTTP calls).

```yaml
- uses: qasecret/allure-station/github-action@v1
  with:
    url: https://allure.example.com
    project: my-app
    token: ${{ secrets.ALLURE_TOKEN }}   # only if the project is token-protected
```

**Run metadata.** Attach CI context at upload time — `branch`, `commit`, `environment`, `ciUrl` — as extra form fields on `send-results`. It shows up on the run, in comparisons, and in per-test history.

**Quality gates &amp; PR checks.** Configure a per-project gate; on `pull_request` the action posts a **commit status + PR comment** (pass/fail, gate verdict, stats, trend delta) and fails on a breach.

```bash
curl -XPUT https://allure.example.com/api/projects/my-app/quality-gate -H 'content-type: application/json' \
  -d '{"maxFailures":0,"minPassRate":0.95,"minTests":1}'
```

Rules (all configured must pass): `maxFailures` (failed+broken ≤ N) · `minTests` (total ≥ N) · `minPassRate` (0–1) · `maxDurationMs`. The verdict is exposed at `GET /api/projects/:id/runs/:runId/summary`.

**Status badge** — embed the latest run state in any README:

```markdown
![tests](https://allure.example.com/api/projects/my-app/badge.svg)
```

**Notifications** — Slack or generic webhook, fired when a run finishes:

```bash
curl -XPOST https://allure.example.com/api/projects/my-app/notifications -H 'content-type: application/json' \
  -d '{"kind":"slack","url":"https://hooks.slack.com/services/…","events":["failed","gate_failed","regression"]}'
```

Triggers: `completed` · `failed` · `gate_failed` · `regression` (≥1 newly-failing test vs the previous run). Delivery is best-effort (a down endpoint never fails a run). Set `PUBLIC_URL` for absolute report links. _(Email/SMTP is not built in — bridge via webhook.)_

## Analytics

- **Trends** — `GET /api/projects/:id/trends` returns recent ready runs as a stats series (pass/fail/broken/skipped + flaky count); the UI renders a pass-rate bar chart with a flaky marker and a duration sparkline.
- **Run comparison** — `GET /api/projects/:id/compare?base=&target=` diffs two runs into `newlyFailing` / `fixed` / `stillFailing` / `added` / `removed` / `flaky`, matched by Allure's stable `historyId`.
- **Per-test history** — `GET /api/projects/:id/tests/history` traces one test's outcome across runs (with each run's branch/commit) and surfaces a **"failing since"** hint for regressions; `…/tests/history/trace` returns the failure detail per run.
- **Live updates** — the UI subscribes to `GET /api/projects/:id/events` (SSE); every lifecycle transition is pushed as a `RunEvent`. Backed by an in-memory bus (default) or Redis pub/sub (BullMQ mode).
- **Search &amp; pagination** — list endpoints accept `?q=&status=&limit=&offset=` and return `X-Total-Count`; `limit` caps at 200.

## Deployment topologies

**Single container (default).** SQLite + local storage + in-process queue. One container, zero external dependencies — ideal for teams and small/medium scale.

**Scaled / HA.** Postgres + S3 + BullMQ/Redis with N stateless API replicas and N worker replicas. Every process runs an age-bounded stale-run reconciler, so worker crashes self-heal safely across replicas.

<details>
<summary><b>docker-compose profiles (postgres / bullmq / minio)</b></summary>

The compose file ships optional services behind profiles. Uncomment the matching `environment` blocks for the `allure-station` (and `worker`) services, then start with the profile(s):

```bash
# Postgres
docker compose -f docker/docker-compose.yml --profile postgres up

# Postgres + BullMQ workers (also start the worker via: pnpm --filter @allure-station/server start:worker)
docker compose -f docker/docker-compose.yml --profile postgres --profile bullmq up

# MinIO for S3 parity (then set STORAGE_DRIVER=s3 + the S3_* vars)
docker compose -f docker/docker-compose.yml --profile minio up
```

A plain `docker compose up` (no profiles) stays single-process on SQLite + local storage, with no extra services.

</details>

### Operations

- **Health check** — `GET /api/version` returns `200` when the service is up; use it as the liveness/readiness probe (the Docker image already wires it into `HEALTHCHECK`).
- **Async generation** — `POST /api/projects/:id/generate` returns **202** with the run at `generating`; track completion via SSE or by polling `GET …/runs/:runId` until `ready`/`failed`.
- **Backup** — single-container: snapshot the `allure-data` volume (it holds the SQLite DB + reports). Scaled: back up Postgres (metadata) and the S3 bucket (artifacts) on their own schedules.

## API at a glance

All endpoints are under `/api`. Reads are public unless the project is private; writes follow the access model above.

| Area | Endpoints |
|---|---|
| Projects | `GET/POST /projects` · `GET/DELETE /projects/:id` · `PATCH /projects/:id` (rename) · `PUT /projects/:id/visibility` |
| Results | `POST /projects/:id/send-results` (+ `branch`/`commit`/`environment`/`ciUrl` fields) · `POST /projects/:id/generate` |
| Runs &amp; report | `GET /projects/:id/runs[?status=&limit=&offset=]` · `GET …/runs/:runId` · `DELETE …/runs/:runId` · `POST …/runs/:runId/retry` · `GET …/runs/:runId/report/*` · `GET …/runs/:runId/summary` |
| Analytics | `GET /projects/:id/trends` · `GET /projects/:id/compare?base=&target=` · `GET /projects/:id/tests/history[/trace]` · `GET /projects/:id/events` (SSE) · `GET /projects/:id/badge.svg` |
| Quality gate | `GET/PUT /projects/:id/quality-gate` |
| Tokens | `GET/POST /projects/:id/tokens` · `DELETE …/tokens/:tokenId` |
| Notifications | `GET/POST /projects/:id/notifications` · `DELETE …/:notificationId` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/oidc/login` · `GET /auth/oidc/callback` |
| Admin | `GET/POST /users` · `DELETE /users/:id` · `GET/PUT/DELETE /projects/:id/members` · `GET /audit` · `GET /projects/:id/audit` |
| Meta | `GET /version` · `GET /config` · `GET /openapi.json` · `GET /docs` |

### API documentation

A live OpenAPI 3.1 specification is generated from the server's Zod contracts:

- **Interactive docs (Swagger UI):** `GET /api/docs`
- **Raw document:** `GET /api/openapi.json`

The document is built at startup from `@allure-station/shared`; a drift-guard test
(`packages/server/src/openapi/drift.test.ts`) fails CI if a route is added without a
spec entry.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

<details>
<summary><b>Integration &amp; conformance test suites (env-gated)</b></summary>

Unit tests always run; backend-specific suites activate when their service URL is set, against the test compose file `docker/docker-compose.test.yml`.

```bash
# Postgres repository conformance
docker compose -f docker/docker-compose.test.yml up -d postgres
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure \
  pnpm --filter @allure-station/server test src/db/repositories

# S3 driver conformance (MinIO)
docker compose -f docker/docker-compose.test.yml up -d minio
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_KEY=minio S3_TEST_SECRET=minio12345 \
  pnpm --filter @allure-station/server test src/storage/s3-driver

# BullMQ / Redis pub-sub conformance
docker compose -f docker/docker-compose.test.yml up -d redis
REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @allure-station/worker test

# End-to-end (Playwright, full stack)
pnpm --filter @allure-station/e2e exec playwright install chromium   # once
pnpm --filter @allure-station/e2e test:e2e
```

</details>

## Project status

All five roadmap phases are complete — **(1)** core ingest → generate → serve · **(2)** scale &amp; live (S3 / Postgres / BullMQ / SSE) · **(3)** modern UX (trends, comparison, search, dark mode, a11y) · **(4)** CI/DevOps (Action, gates, PR checks, badges) · **(5)** auth &amp; notifications (accounts + RBAC, audit log, OIDC/SSO) — plus **run metadata**, **private projects**, and **per-test history** from the follow-up slices.

Planned next steps and gap analysis (known-issue muting, sharded-run aggregation, a language-agnostic CLI, …) live in **[docs/FUTURE-WORK.md](docs/FUTURE-WORK.md)**.

## Contributing

Contributions are welcome — bug reports, docs, and PRs alike.

1. Fork and clone, then `pnpm install` (Node ≥ 20, pnpm 9).
2. Make your change with tests; `pnpm test && pnpm typecheck` must pass.
3. Open a PR with a clear description of the why, not just the what.

Start with the [Development](#development) section above; [docs/FUTURE-WORK.md](docs/FUTURE-WORK.md) lists good areas to pick up.

## Security

Found a vulnerability? Please report it **privately** — see [SECURITY.md](SECURITY.md).

## License

Licensed under the **[Apache License 2.0](LICENSE)**.
