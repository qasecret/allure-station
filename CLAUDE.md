# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Allure Station — a self-hosted, multi-project [Allure 3](https://allurereport.org/) report hub. CI pushes raw test results; the server ingests them, a worker embeds Allure 3 in-process to generate reports, and a React UI serves reports plus trends, run comparison, and access control. Single TypeScript codebase; scales from one container to multi-replica **by configuration, not rewrite**.

## Commands

Root scripts run across the workspace via Turborepo (`pnpm <script>`), or target one package with `pnpm --filter @allure-station/<pkg> <script>`.

```bash
pnpm install
pnpm build          # turbo run build (web only emits dist; others are tsx-run)
pnpm test           # turbo run test — all unit tests (vitest)
pnpm typecheck      # turbo run typecheck — tsc --noEmit per package
pnpm dev            # turbo run dev --parallel (server: tsx watch, web: vite)

# Run the server directly (dev)
pnpm --filter @allure-station/server dev          # API on :5050
pnpm --filter @allure-station/server start:worker # standalone BullMQ worker process

# Single test file / pattern
pnpm --filter @allure-station/server test src/auth.test.ts
pnpm --filter @allure-station/server exec vitest run -t "test name substring"
```

### Env-gated integration suites
Unit tests always run. Backend-conformance suites only activate when their service URL env var is set (use `docker/docker-compose.test.yml` to bring up the service):

```bash
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure \
  pnpm --filter @allure-station/server test src/db/repositories
S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_KEY=minio S3_TEST_SECRET=minio12345 \
  pnpm --filter @allure-station/server test src/storage/s3-driver
REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @allure-station/worker test
# e2e (Playwright, full stack)
pnpm --filter @allure-station/e2e exec playwright install chromium   # once
pnpm --filter @allure-station/e2e test:e2e
```

### After a DB schema change
Regenerate migrations for **both** dialects (they live in `packages/server/drizzle/{sqlite,pg}`):
```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```
Migrations apply automatically on startup.

## Monorepo layout

pnpm workspace (`packages/*`) + Turborepo. ESM throughout; packages are consumed as raw TS source via `workspace:*` (no build step between them — `main` points at `./src/*.ts`, run with `tsx`). The build dependency chain is `^build`, so anything importing a package waits for it.

- `packages/shared` — zod contracts + types, the single source of truth shared by server ↔ web. Change a contract here, not in two places.
- `packages/worker` — report-generation logic. `generate.ts` embeds `@allurereport/core`; `queue.ts` defines `JobQueue` with `InProcessQueue` and `BullMQQueue` implementations. Pure job-processing; imports nothing from server.
- `packages/server` — Fastify API: ingest, generate orchestration, serve reports, auth/RBAC/audit, storage, DB.
- `packages/web` — React 18 + Vite SPA, TanStack Query.
- `packages/e2e` — Playwright full-stack tests.

## Server architecture — the key seams

The whole server is built around a single **`AppDeps`** struct (`packages/server/src/app.ts`) — repositories, storage driver, queue, event bus, oidc provider, config values. Everything is dependency-injected through it, which is what makes the driver-swapping (SQLite↔Postgres, local↔S3, in-process↔BullMQ) work without touching call sites.

Construction layering (do not collapse these):
- `config.ts` — `loadConfig()` reads env, validates invariants (e.g. bullmq requires `REDIS_URL`, s3 requires `S3_BUCKET`).
- `runtime.ts` — `buildRuntime()`: the **single place** the queue/bus driver decision is made (bullmq ⇒ Redis queue + Redis pub/sub bus; else in-process). Opens & migrates the DB, seeds the admin, starts the stale-run reconciler. Shared by both entrypoints.
- `deps.ts` — `buildDeps()`: assembles `AppDeps` from config + queue + db + bus.
- `app.ts` — `buildApp(deps)`: pure Fastify wiring, all routes under `/api`. **Deliberately knows nothing about queue/worker construction** — keep it that way so BullMQ mode stays clean.
- `generation.ts` — `wireQueue(deps)` connects the queue processor to `runGeneration`. Called from `main.ts` and test helpers, **never from `buildApp`**.
- Entrypoints: `main.ts` (API) and `worker-main.ts` (standalone BullMQ worker) both call `buildRuntime`.

### Generation flow
CI `POST /send-results` → results staged to storage → `POST /generate` enqueues a job and returns **202** with run at `generating` → worker `runGeneration` (`generation.ts`): materialize results from storage → `generateReport` (embeds Allure 3) → push report to storage → `replaceForRun` test summaries → `markReady`/`markFailed` → publish `RunEvent` to bus → best-effort notifications. Progress streams to the UI via SSE (`routes/events.ts`, backed by the event bus).

### Pluggable drivers (each behind one interface, with a conformance test suite)
- **Storage** (`storage/driver.ts`, `StorageDriver`): `local-driver` or `s3-driver`, chosen by `storage/factory.ts`. Shared behavioral contract in `storage/conformance.ts`.
- **DB** (`db/client.ts`, `createDb`): SQLite/libsql or Postgres. The pg handle is cast to the libsql-typed `Db` (structurally identical at runtime). Repositories (`db/*-repo.ts`) take a `Db` and are dialect-agnostic.
- **Queue / event bus** (`worker/queue.ts`, `events/bus.ts`): in-process or BullMQ+Redis.

> **BullMQ mode requires shared Postgres + shared storage (S3 or shared volume)** — API and worker(s) are separate processes over the same data. SQLite + local FS are single-process only. Postgres migrations are serialized with an advisory lock since API + N workers boot together.

### Dual-dialect schema gotcha
`db/schema.ts` re-exports `schema.sqlite.ts`. There are **two** hand-maintained schema files — `schema.sqlite.ts` and `schema.pg.ts` — kept structurally identical. A column change must be made in **both**, then migrations regenerated for both (see above).

## Auth & access model

Secure-by-default through progressive disclosure: fully open in zero-config dev, tightens the moment credentials/accounts exist.
- **API tokens** (CI, per-project): sha256-hashed, plaintext shown once. A project with no tokens is open for writes; once it has one, writes need a token scoped to that project. Cross-project writes are impossible.
- **RBAC** (humans): global `admin`, per-project `owner`/`maintainer`/`viewer`. Writes need `maintainer+` or a token; member/token management needs `owner`/admin. Sessions are httpOnly cookies, DB-backed, cookie value hashed at rest.
- **OIDC/SSO**: auth-code + PKCE, first-time users auto-provisioned by verified email.
- **Reads are public by default** — tokens/RBAC protect integrity, not confidentiality (private-report read-gating is the `read-gate.ts` / `visibility.test.ts` work in progress).
- **Audit log**: append-only, `GET /api/audit` (admin) / `GET /api/projects/:id/audit` (owner).
- **SSRF guard** (`safe-url.ts`): configured webhook URLs must be http(s) and may not target loopback/private/link-local IP literals or `localhost`.

## Conventions

- Routes live in `routes/*.ts`, each a `register*Routes(api, deps)` function registered in `app.ts`. Co-located `*.test.ts`.
- Validate request/response shapes against the zod contracts in `@allure-station/shared` — don't redefine types locally.
- Notifications and event publishing are **best-effort**: they must never throw into (or mask the error of) the generation path. Follow the existing try/catch pattern in `generation.ts`.
- New env vars: add to `config.ts` with a sensible zero-config default and document in `README.md`.

## Reference docs

- `README.md` — full feature/config/API reference and deployment topologies.
- `design-system/allure-station/MASTER.md` — **UI source of truth** (Geist + teal `#1db980` + cool-slate tokens, shadcn/Tailwind conventions, a11y rules). Read it before any `packages/web` UI work; check `design-system/allure-station/pages/<page>.md` for per-page overrides.
- `docs/FUTURE-WORK.md` — roadmap, gap analysis, and slice plans.
- `docker/` — `Dockerfile` + compose files (`postgres`/`bullmq`/`minio` profiles; `docker-compose.test.yml` for integration suites).
- `github-action/` — reusable upload → generate → gate Action (+ GitLab/Jenkins recipes).
