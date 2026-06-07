# Allure Station

A self-hosted Allure report service with pluggable storage backends.

## Quick Start

```bash
docker compose -f docker/docker-compose.yml up
```

The service listens on port `5050`. Reports and results are stored in the `allure-data` named volume by default (local filesystem).

## CI integration

Push results from any pipeline with the reusable **[GitHub Action](github-action/)** (upload → generate → wait), which fails the job if generation fails:

```yaml
- uses: qasecret/allure-station/github-action@v1
  with:
    url: https://allure.example.com
    project: my-app
    token: ${{ secrets.ALLURE_TOKEN }}   # only if the project is token-protected
```

The action README also has copy-paste **GitLab CI** and **Jenkins** recipes (the same three HTTP calls).

On `pull_request` events the action posts a **commit status + PR comment** (pass/fail, quality-gate verdict, stats, trend delta vs the previous run) and fails the job on a gate breach. Configure a per-project **quality gate**:

```bash
curl -XPUT host/api/projects/my-app/quality-gate -H 'content-type: application/json' \
  -d '{"maxFailures":0,"minPassRate":0.95,"minTests":1}'   # PUT is auth-gated; GET is open
```

Rules (all configured must pass): `maxFailures` (failed+broken ≤ N), `minTests` (total ≥ N), `minPassRate` (0..1), `maxDurationMs`. The verdict is exposed on `GET /api/projects/:id/runs/:runId/summary`.

Embed a live **status badge** (latest run, public) in your project README:

```markdown
![tests](https://allure.example.com/api/projects/my-app/badge.svg)
```

## Notifications

Subscribe a project to **Slack** or **generic webhook** notifications, fired when a run finishes:

```bash
curl -XPOST host/api/projects/my-app/notifications -H 'content-type: application/json' \
  -d '{"kind":"slack","url":"https://hooks.slack.com/services/…","events":["failed","gate_failed","regression"]}'
```

- **kinds**: `slack` (posts `{text}`), `webhook` (posts a JSON payload: `{project, runId, status, stats, triggers, newlyFailing, reportUrl}`).
- **triggers** (`events`): `completed` (any terminal run), `failed` (generation failed), `gate_failed` (ready but the quality gate breached), `regression` (≥1 newly-failing test vs the previous run). Default: `["failed","gate_failed","regression"]`.

Endpoints (auth-gated — they expose webhook URLs): `POST` / `GET` / `DELETE /api/projects/:id/notifications[/:id]`. Delivery is best-effort (a down endpoint never fails a run). Set `PUBLIC_URL` so report links in payloads are absolute. (Email/SMTP is not built in — use a webhook bridge.)

> **SSRF note:** the server fetches webhook URLs. URLs must be http(s) and may not point at loopback/private/link-local **IP literals** or `localhost` (rejected at create + dispatch). Internal *hostnames* are allowed (legitimate on a self-hosted network) — on an internet-exposed instance, restrict who can configure webhooks (project tokens) and apply network egress controls.

## Authentication (scoped API tokens)

Auth is **opt-in per project**. A project with no tokens is fully open (zero-config dev mode). The moment a project has at least one token, its **write** endpoints require a bearer token scoped to that project:

- gated writes: `POST /send-results`, `POST /generate`, `DELETE /projects/:id`, and the token-management endpoints below;
- reads (list/runs/report/trends/compare/events) stay open — **tokens protect integrity (who can push/delete), not confidentiality**: report contents remain publicly readable. (Per-project private visibility is a planned follow-up; see Accounts, RBAC & SSO below.)

Tokens are stored hashed (sha256) — the plaintext is shown **once**, at creation.

```bash
# Create the first token for a project (no auth needed while the project is open):
curl -XPOST host/api/projects/myapp/tokens -H 'content-type: application/json' -d '{"name":"ci"}'
# → { "id": "...", "prefix": "ast_x9...", "token": "ast_x9....", ... }   (save `token` now)

# Subsequent writes must present it:
curl -XPOST host/api/projects/myapp/send-results -H 'authorization: Bearer ast_x9....' -F files=@result.json
```

Endpoints: `POST /api/projects/:id/tokens` (create), `GET /api/projects/:id/tokens` (list — prefixes only, no secrets), `DELETE /api/projects/:id/tokens/:tokenId` (revoke). Deleting the last token re-opens the project.

> A token scoped to project A cannot authorize writes to project B. **Caveat:** while a project is open, anyone can create its first token (and thus lock it).

## Accounts, RBAC & SSO

Beyond CI tokens, Allure Station has **user accounts** with per-project roles. It stays zero-config until you create an account: set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to seed (idempotently, on every boot) a global **admin**, then sign in at `/login`.

- **Roles:** global `admin` (manage users, create/delete any project) + per-project `owner` / `maintainer` / `viewer` (granted by an owner/admin via `PUT /api/projects/:id/members`). Writes require `maintainer+` or a project token; member management requires `owner`/admin. **Reads stay public.**
- **Sessions:** local email+password login issues an httpOnly, DB-backed session cookie (the cookie value is sha256-hashed at rest). `SESSION_TTL_MS` (default 7d); `COOKIE_SECURE=true` to force the Secure flag behind TLS (auto-on when `PUBLIC_URL` is https).
- **Audit log:** sensitive actions (logins, user/token/member/project/gate/notification changes) are recorded. `GET /api/audit` (admin) and `GET /api/projects/:id/audit` (owner).

### Single sign-on (OIDC)

Configure any OIDC provider (Keycloak, Okta, Auth0, Entra, Google) to add a **"Sign in with …"** option alongside local login. Users authenticating for the first time are **auto-provisioned** as role `user` (keyed on their verified email; an existing local account with the same email is linked). Roles are still managed in-app.

| Env var | Required | Notes |
| --- | --- | --- |
| `OIDC_ISSUER` | yes | Issuer URL; OIDC discovery is used (`…/.well-known/openid-configuration`). |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | yes | From your IdP's client registration. |
| `OIDC_REDIRECT_URI` | yes* | `…/api/auth/oidc/callback`. *Defaults from `PUBLIC_URL` if set. Must match the IdP registration. |
| `OIDC_SCOPES` | no | Default `openid email profile` (must include `openid`). |
| `OIDC_LABEL` | no | Button text (default `SSO`). |
| `OIDC_ALLOWED_DOMAINS` | no | Comma-separated email-domain allowlist. Not a security boundary against a permissive multi-tenant issuer. |
| `OIDC_ALLOW_UNVERIFIED_EMAIL` | no | `true` disables the `email_verified` requirement — **dangerous** (enables email-based account takeover); leave off unless your IdP omits the claim and you fully trust it. |

Flow: `GET /api/auth/oidc/login` → IdP (authorization-code + PKCE, with `state`/`nonce`) → `GET /api/auth/oidc/callback` → session cookie. Local password login remains available.

## Storage

Allure Station supports two storage backends, configured via environment variables.

### Local (default)

No configuration needed. Results and reports are stored on the local filesystem under `DATA_DIR/storage` (default: `./data/storage`).

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Storage backend (`local` or `s3`) |
| `STORAGE_ROOT` | `$DATA_DIR/storage` | Root directory for local storage |
| `DATA_DIR` | `./data` | Base data directory |

### S3-compatible (MinIO, AWS S3, etc.)

Set `STORAGE_DRIVER=s3` and configure the S3 variables:

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Set to `s3` to enable |
| `S3_ENDPOINT` | _(none — uses AWS)_ | Custom endpoint URL (e.g. `http://minio:9000`) |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_BUCKET` | _(required)_ | Bucket name |
| `S3_FORCE_PATH_STYLE` | `true` | Set `false` for AWS S3 virtual-hosted-style |
| `S3_ACCESS_KEY_ID` | _(SDK default chain)_ | Access key ID (optional if using IAM/instance roles) |
| `S3_SECRET_ACCESS_KEY` | _(SDK default chain)_ | Secret access key |

#### Switching docker-compose to S3/MinIO

Uncomment the `environment` block under the `allure-station` service in `docker/docker-compose.yml`:

```yaml
environment:
  STORAGE_DRIVER: s3
  S3_ENDPOINT: http://minio:9000
  S3_BUCKET: allure
  S3_ACCESS_KEY_ID: minio
  S3_SECRET_ACCESS_KEY: minio12345
```

Then `docker compose -f docker/docker-compose.yml up` will start both the app and MinIO.

## Running S3 Conformance Tests

The S3 driver has an environment-gated conformance suite that runs against a real MinIO instance.

1. Start MinIO:

```bash
docker compose -f docker/docker-compose.test.yml up -d minio
```

2. Run the S3 conformance tests:

```bash
S3_TEST_ENDPOINT=http://localhost:9000 \
S3_TEST_KEY=minio \
S3_TEST_SECRET=minio12345 \
pnpm --filter @allure-station/server test src/storage/s3-driver
```

Without `S3_TEST_ENDPOINT` set, the S3 suite is automatically skipped (the rest of the test suite always runs).

## Database

Allure Station uses **SQLite by default** (zero configuration — the database file is created automatically under `DATA_DIR`). Postgres can be selected for multi-instance deployments.

### SQLite (default)

No configuration needed. The database file is created automatically.

| Variable | Default | Description |
|---|---|---|
| `DB_DRIVER` | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `DB_FILE` | `$DATA_DIR/allure-station.db` | Path to the SQLite database file |
| `DATA_DIR` | `./data` | Base data directory |

### Postgres

Set `DB_DRIVER=postgres` and provide a connection URL:

| Variable | Default | Description |
|---|---|---|
| `DB_DRIVER` | `sqlite` | Set to `postgres` to enable |
| `DATABASE_URL` | _(required when `DB_DRIVER=postgres`)_ | Postgres connection string, e.g. `postgresql://user:pass@host:5432/dbname` |

#### Switching docker-compose to Postgres

The `postgres` service is included in `docker/docker-compose.yml` behind the `postgres` compose profile. To start the app with Postgres:

1. Uncomment the DB env vars in the `allure-station` service in `docker/docker-compose.yml`:

```yaml
environment:
  DB_DRIVER: postgres
  DATABASE_URL: postgresql://allure:allure@postgres:5432/allure
```

2. Start with the `postgres` profile:

```bash
docker compose -f docker/docker-compose.yml --profile postgres up
```

The default `docker compose up` (no profile) continues to use SQLite with no configuration required.

### Schema migrations

Drizzle migrations are applied automatically on startup. If you change the schema, regenerate migrations for **both** dialects:

```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```

### Running Postgres Repository Conformance Tests

The repository conformance suite is environment-gated: it always runs against SQLite (in-memory) and additionally runs against Postgres when `PG_TEST_URL` is set.

1. Start Postgres:

```bash
docker compose -f docker/docker-compose.test.yml up -d postgres
```

2. Run the conformance tests:

```bash
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure \
pnpm --filter @allure-station/server test src/db/repositories
```

Without `PG_TEST_URL` set, the Postgres conformance suite is automatically skipped.

## Job queue

Allure Station uses a job queue to run report-generation asynchronously. The queue driver is configured via environment variable.

### `QUEUE_DRIVER=inprocess` (default)

No configuration needed. Generation jobs run inside the API process under a concurrency limit (default: 2). This is the zero-config default — a single container is all you need.

| Variable | Default | Description |
|---|---|---|
| `QUEUE_DRIVER` | `inprocess` | Queue backend (`inprocess` or `bullmq`) |
| `GENERATE_CONCURRENCY` | `2` | Max concurrent generation jobs (must be a positive integer) |
| `GENERATE_STALE_MS` | `1800000` (30 min) | A run stuck in `generating` longer than this is reconciled to `failed` |

### `QUEUE_DRIVER=bullmq`

Set `QUEUE_DRIVER=bullmq` and provide a Redis URL to use BullMQ as the queue backend. Jobs are enqueued by the API process and consumed by a separate **worker process**. You can scale horizontally by running N worker replicas.

| Variable | Default | Description |
|---|---|---|
| `QUEUE_DRIVER` | `inprocess` | Set to `bullmq` to enable |
| `REDIS_URL` | _(required when `QUEUE_DRIVER=bullmq`)_ | Redis connection URL, e.g. `redis://redis:6379` |
| `GENERATE_CONCURRENCY` | `2` | Max concurrent jobs per worker process |
| `GENERATE_STALE_MS` | `1800000` (30 min) | A run stuck in `generating` longer than this is reconciled to `failed` (see below) |

**Starting the worker process:**

```bash
pnpm --filter @allure-station/server start:worker
```

**Important:** BullMQ mode requires **shared DB (Postgres) and shared storage (S3 or a shared volume)**, since the API and worker run as separate processes that both read/write the same run rows and report files. SQLite and local-filesystem storage are single-process only.

**Stale-run reconciliation.** A run is marked `generating` when claimed and only reaches `ready`/`failed` when a worker finishes it. If the worker that picked up a job dies (or no worker is running at all), the run would otherwise stay `generating` forever. Every process (API and each worker replica) runs a periodic sweep that fails any run whose generation **started more than `GENERATE_STALE_MS` ago** (default 30 min). The sweep is deliberately **age-bounded** — it never touches a recently-started run, so it is safe to run from multiple replicas concurrently without aborting a sibling's in-flight generation. Set `GENERATE_STALE_MS` above your slowest expected report generation time.

#### Running with docker compose (bullmq profile)

The `redis` and `worker` services are included in `docker/docker-compose.yml` behind the `bullmq` compose profile.

1. Uncomment the BullMQ, DB, and storage env vars in the `allure-station` service in `docker/docker-compose.yml`, and uncomment the DB/storage env vars in the `worker` service.

2. Start with the `bullmq` (and `postgres`) profiles:

```bash
docker compose -f docker/docker-compose.yml --profile bullmq --profile postgres up
```

The default `docker compose up` (no profiles) continues to run single-process with the in-process queue — no Redis or worker required.

### `/generate` contract

`POST /api/projects/:projectId/generate` returns **202 Accepted** with the run object at status `generating` (fire-and-forget). The generation job runs asynchronously.

Clients track progress until the run reaches a terminal status (`ready` — report generated; `failed` — generation failed) either by **subscribing to the live event stream** (see below) or by **polling `GET /api/projects/:projectId/runs/:runId`**. This applies to both `inprocess` and `bullmq` drivers.

> **Note:** This changed from the old synchronous behavior (where `/generate` held the HTTP connection open until the report was ready). API clients that previously read the final status from the `/generate` response must now subscribe or poll for it.

### Search, filter & pagination

List endpoints accept optional query params and return the total match count in an `X-Total-Count` header (the JSON body stays a plain array, so existing clients are unaffected):

- `GET /api/projects?q=<substr>&limit=<n>&offset=<n>` — case-sensitive substring search over project id (LIKE wildcards are escaped), windowed by limit/offset.
- `GET /api/projects/:projectId/runs?status=<pending|generating|ready|failed>&limit=<n>&offset=<n>` — filter by run status, windowed.

`limit` is capped at 200; invalid `limit`/`offset`/`status` return 400. The web UI uses server-side search + Prev/Next pagination on the project list.

### End-to-end tests (Playwright)

`packages/e2e` drives a real browser against the full stack — it builds the web bundle, starts the server with `WEB_DIST` pointing at it (default sqlite/local/inprocess, zero external deps), and exercises the SPA. It's isolated from the unit suites, so `pnpm -r test` doesn't run it. To run it:

```bash
pnpm --filter @allure-station/e2e exec playwright install chromium  # once
pnpm --filter @allure-station/e2e test:e2e
```

### Trends

`GET /api/projects/:projectId/trends` returns the most recent ready runs (oldest-first) as a stats series — pass/fail/broken/skipped plus a **flaky** count (tests Allure flagged flaky via retries / `statusDetails.flaky`). The UI renders a per-run pass-rate bar chart with an orange cap marking runs that had flaky tests.

### Run comparison

`GET /api/projects/:projectId/compare?base=<runId>&target=<runId>` diffs two ready runs and returns tests bucketed as `newlyFailing`, `fixed`, `stillFailing`, `added`, `removed`, and `flaky`. Per-test results (`historyId`, `status`, `duration`, `flaky`) are persisted at generation time; tests are matched across runs by Allure's stable `historyId` (falling back to `fullName`/`name`). The UI exposes this as a compare panel on the project page.

### Live updates (SSE)

The UI subscribes to `GET /api/projects/:projectId/events` (Server-Sent Events) and updates run status in real time — no polling. Each message is a JSON `RunEvent` (`{ type: "run", projectId, run }`) emitted on every lifecycle transition (created → generating → ready/failed).

Events are delivered through a pluggable bus selected by `QUEUE_DRIVER`:
- `inprocess` (default): in-memory — single process, zero config.
- `bullmq`: Redis pub/sub on `REDIS_URL`, so the worker process and every API replica share one stream. No extra configuration beyond the Redis you already run for the queue.

The bus has an environment-gated conformance suite (`RedisBus`), run with `REDIS_TEST_URL` set (same Redis as the queue tests below).

### Running Redis conformance tests

The BullMQ driver has an environment-gated conformance suite that runs against a real Redis instance.

1. Start Redis:

```bash
docker compose -f docker/docker-compose.test.yml up -d redis
```

2. Run the queue conformance tests:

```bash
REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @allure-station/worker test
```

Without `REDIS_TEST_URL` set, the BullMQ suite is automatically skipped (the in-process queue tests always run).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
