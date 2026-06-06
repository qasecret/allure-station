# Allure Station — Slice 2b-ii (Postgres option + drizzle migrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add **Postgres** as a metadata backend option (for multi-instance deployments) while keeping **SQLite the zero-config default**, both behind one Drizzle repository, and adopt drizzle **`migrate()`** in place of the hand-written `ensureSchema` raw DDL (resolves code-review #9).

**Architecture:** Switch the SQLite driver from synchronous `better-sqlite3` to the **async `@libsql/client`** (`drizzle-orm/libsql`, local `file:`/`:memory:`). libsql exposes the *same async query builder* as `drizzle-orm/node-postgres`, so a **single async repository** serves both dialects — no per-dialect repo duplication. Schema is defined per dialect (`schema.sqlite.ts` + `schema.pg.ts`, structurally identical, all `TEXT`); the repository is typed against the sqlite dialect and the Postgres handle is cast once at the DB factory (the cross-dialect union type does not type-check — verified). Bootstrap and tests apply schema via `migrate(db, {migrationsFolder})` per dialect. A `DB_DRIVER=sqlite|postgres` config + `DATABASE_URL` selects the backend; an env-gated repository conformance suite runs the same behavior tests against SQLite (always, in-memory) and Postgres (when `PG_TEST_URL` set).

**Tech Stack changes:** add `@libsql/client`, `pg`, `@types/pg`; **remove `better-sqlite3` + `@types/better-sqlite3`**. Postgres as a docker-compose service for dev/CI. Drizzle stays `0.36.0`, drizzle-kit `0.28.0`.

**Spike findings (Task 1 — DONE 2026-06-06, verified live against `postgres:16`):**
- `drizzle-orm/libsql` runs against `file:` and `:memory:`, exposes the async builder (`await db.select()...`, `.returning()`, array results) **identical to node-postgres** — one repo impl ran byte-identically on both. better-sqlite3 is referenced only in `client.ts`; sync `.all/.get/.run/res.changes` only in `repositories.ts`; repo public methods are already `async` → converting internals is non-breaking at call sites.
- **`LibSQLDatabase<S> | NodePgDatabase<S>` does NOT type-check** ("none of those signatures are compatible") — so type the repo against `LibSQLDatabase<typeof sqliteSchema>` and pass the pg `(db, schema)` with a single `as unknown as RepoDb` cast **at the factory only**. Runtime is structurally identical (verified `tsc` clean + live pg).
- Keep `stats_json` as **TEXT on Postgres too** (repo already JSON.stringify/parse around it); `jsonb` would force a dialect branch in `#toRun`. TEXT-both = zero special-casing.
- `migrate()` works for libsql file + `:memory:` (tests) and pg. drizzle-kit generates per-dialect via two config files (separate `out` dirs). `ensureSchema` + the `(db as unknown).session.client` pierce are fully removable.
- libsql enables `foreign_keys` by default → the `ON DELETE CASCADE` works without an explicit pragma (better-sqlite3 needed one).
- Existing `drizzle/0000_*`/`0001_*` SQLite migrations are plain SQLite DDL → apply unchanged under libsql; relocate under the sqlite `out` dir, keep `meta/_journal.json` so they don't re-run.
- **Ripple:** `migrate()` is async ⇒ `createDb`/`makeTestDeps` become async ⇒ every `makeTestDeps()` call site needs `await` (mechanical).

---

## File Structure (changes)
```
packages/server/package.json                  # +@libsql/client +pg +@types/pg ; -better-sqlite3 -@types/better-sqlite3
packages/server/src/db/schema.sqlite.ts       # NEW (was schema.ts): sqliteTable projects+runs+index
packages/server/src/db/schema.pg.ts           # NEW: pgTable equivalents (all TEXT)
packages/server/src/db/schema.ts              # REMOVE (split above) — or keep as re-export of sqlite for back-compat
packages/server/src/db/client.ts              # REWRITE: createDb(driver,url)->libsql|node-postgres; runMigrations(); drop ensureSchema + better-sqlite3 pierce
packages/server/src/db/repositories.ts        # MODIFY: async internals (await/.returning()); inject (db, schema); same public API
packages/server/src/db/repositories.test.ts   # MODIFY: parameterized conformance (sqlite always + pg when PG_TEST_URL)
packages/server/drizzle.config.ts             # REMOVE → drizzle.sqlite.config.ts + drizzle.pg.config.ts
packages/server/drizzle/sqlite/*              # relocate existing 0000_/0001_ + meta here
packages/server/drizzle/pg/*                  # NEW generated pg migrations
packages/server/src/config.ts                 # MODIFY: dbDriver (DB_DRIVER, default sqlite) + databaseUrl (DATABASE_URL); DB_FILE -> file: url
packages/server/src/main.ts                   # MODIFY: createDb(config.dbDriver,...) + await runMigrations()
packages/server/src/test-helpers.ts           # MODIFY: makeTestDeps() async -> in-memory libsql + await migrate
packages/server/src/**/*.test.ts              # MODIFY: await makeTestDeps()
docker/docker-compose.yml                      # MODIFY: optional postgres service (profile); app stays sqlite default
docker/docker-compose.test.yml                # MODIFY: add postgres:16 service (sibling to minio)
README.md                                      # MODIFY: DB config + PG_TEST_URL docs
```

---

## Task 1: Spike — DONE
See "Spike findings". No code committed. Proceed.

---

## Task 2: Split schema per dialect + dual drizzle-kit configs + migrations

**Files:** `schema.sqlite.ts`, `schema.pg.ts`, `drizzle.sqlite.config.ts`, `drizzle.pg.config.ts`, relocate `drizzle/` → `drizzle/sqlite/`, generate `drizzle/pg/`.

- [ ] **Step 1: `schema.sqlite.ts`** — move the current `schema.ts` content here verbatim (sqliteTable `projects`, `runs`, the `idx_runs_project` + `idx_runs_project_status_created` indexes). Export `* as` a namespace too if convenient. (Optionally keep `schema.ts` as `export * from "./schema.sqlite.js"` for any stragglers, but prefer updating imports.)
- [ ] **Step 2: `schema.pg.ts`** — structurally identical with `pgTable`/`text` from `drizzle-orm/pg-core`:
```ts
import { index, pgTable, text } from "drizzle-orm/pg-core";
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  reportName: text("report_name").notNull(),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  statsJson: text("stats_json"),
}, (t) => ({
  byProject: index("idx_runs_project").on(t.projectId),
  byProjectStatusCreated: index("idx_runs_project_status_created").on(t.projectId, t.status, t.createdAt),
}));
```
Keep column names/types identical to sqlite (all TEXT, incl. `stats_json`).
- [ ] **Step 3: dual drizzle-kit configs.**
`drizzle.sqlite.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.sqlite.ts", out: "./drizzle/sqlite", dialect: "sqlite" });
```
`drizzle.pg.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.pg.ts", out: "./drizzle/pg", dialect: "postgresql" });
```
Add package.json scripts: `"db:generate:sqlite": "drizzle-kit generate --config=drizzle.sqlite.config.ts"`, `"db:generate:pg": "drizzle-kit generate --config=drizzle.pg.config.ts"`.
- [ ] **Step 4: relocate existing sqlite migrations.** `git mv packages/server/drizzle/0000_*.sql packages/server/drizzle/0001_*.sql packages/server/drizzle/meta packages/server/drizzle/sqlite/` (create `drizzle/sqlite/`). Keep `meta/_journal.json` intact so applied migrations aren't re-run. Remove the old `drizzle.config.ts`.
- [ ] **Step 5: generate pg migrations.** `pnpm --filter @allure-station/server db:generate:pg` → creates `drizzle/pg/0000_*.sql` (CREATE TABLE projects/runs + indexes + FK). Run `db:generate:sqlite` too and confirm it reports **no changes** (schema already captured by relocated migrations) — if it emits a new file because the index migration history differs, inspect and keep history consistent.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "chore(db): split schema per dialect (sqlite+pg) + dual drizzle-kit configs + relocate migrations"` (no functional change yet; ensureSchema still in use).

---

## Task 3: Swap to libsql, adopt migrate(), make repos async, config-drive the driver

**Files:** `client.ts`, `repositories.ts`, `config.ts`, `main.ts`, `test-helpers.ts`, `package.json`, and all `*.test.ts` using `makeTestDeps`.

- [ ] **Step 1: Deps.** `pnpm --filter @allure-station/server add @libsql/client pg @types/pg` then `pnpm --filter @allure-station/server remove better-sqlite3 @types/better-sqlite3`. Pin exact versions (spike used `@libsql/client@0.14.0`, `pg@8.21.0`).

- [ ] **Step 2: Rewrite `client.ts`** — dialect dispatch + migrate, no raw DDL:
```ts
import { drizzle as drizzleLibsql, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

export type DbDriver = "sqlite" | "postgres";
/** Repo handle type — typed against the sqlite dialect; pg handle is cast to this at the factory. */
export type Db = LibSQLDatabase<typeof sqliteSchema>;

const sqliteMigrations = fileURLToPath(new URL("../../drizzle/sqlite", import.meta.url));
const pgMigrations = fileURLToPath(new URL("../../drizzle/pg", import.meta.url));

export interface DbHandle { db: Db; driver: DbDriver; migrate(): Promise<void>; }

export function createDb(driver: DbDriver, opts: { url: string }): DbHandle {
  if (driver === "postgres") {
    const pool = new Pool({ connectionString: opts.url });
    const pg = drizzlePg(pool, { schema: pgSchema });
    return {
      db: pg as unknown as Db, // cross-dialect union doesn't type-check; structurally identical at runtime (spike-verified)
      driver,
      migrate: () => migratePg(pg, { migrationsFolder: pgMigrations }),
    };
  }
  const client = createClient({ url: opts.url }); // "file:..." or ":memory:"
  const db = drizzleLibsql(client, { schema: sqliteSchema });
  return { db, driver, migrate: () => migrateLibsql(db, { migrationsFolder: sqliteMigrations }) };
}
```
Delete `ensureSchema` and the `(db as unknown as ...).session.client` pierce entirely.

- [ ] **Step 3: Convert `repositories.ts` to async internals.** Public method signatures are unchanged (already `async`); convert bodies from better-sqlite3 sync to the async builder. Pattern (apply to every method):
  - `this.db.select().from(t).where(...).all()` → `await this.db.select().from(t).where(...)` (returns array).
  - `...get()` (single row) → `const [row] = await this.db.select()...; ` then use `row`.
  - `this.db.insert(t).values(v).run()` → `await this.db.insert(t).values(v)`.
  - `this.db.update(t).set(s).where(w).run()` → `await this.db.update(t).set(s).where(w)`.
  - `res.changes === 1` (claimPending) → use `.returning()`: `const updated = await this.db.update(runs).set({status:"generating"}).where(and(eq(runs.id,id),eq(runs.status,"pending"))).returning(); return updated.length === 1;`
  - `res.changes` (failStaleGenerating) → `const reset = await ...returning(); return reset.length;`
  Constructor stays `constructor(private readonly db: Db)`. `#toRun`, `#selectRuns`, `#withLatest` adapt to `await`. Keep all behavior/ordering/tiebreakers identical.

- [ ] **Step 4: `config.ts`** — add DB config:
```ts
export type DbDriver = "sqlite" | "postgres";
// in AppConfig: db: { driver: DbDriver; url: string };
```
`loadConfig`: `DB_DRIVER` (default `"sqlite"`). When sqlite: `url = "file:" + (DB_FILE ?? `${dataDir}/allure-station.db`)`. When postgres: `url = DATABASE_URL` (required for pg). Drop the old `dbFile` top-level field (or keep mapping). Update any reader.

- [ ] **Step 5: `main.ts`** — `const { db, migrate } = createDb(config.db.driver, { url: config.db.url }); await migrate(); ` then build repos with `db`, then the existing reconciliation + listen. (main is already async-capable via the `.then()` listen; wrap the migrate in the async bootstrap.)

- [ ] **Step 6: `test-helpers.ts` — `makeTestDeps` becomes async.**
```ts
export async function makeTestDeps(): Promise<AppDeps> {
  const { db, migrate } = createDb("sqlite", { url: ":memory:" });
  await migrate();
  // ...rest unchanged (LocalDriver temp dir, InProcessQueue, now/newId)...
}
```
- [ ] **Step 7: Update all `makeTestDeps()` callers** to `await makeTestDeps()` (grep `makeTestDeps(` across `src/**/*.test.ts`; the test callbacks are already `async`). Also any test that called `ensureSchema`/`createDb(":memory:")` directly (e.g. `repositories.test.ts`) switches to `createDb("sqlite",{url:":memory:"})` + `await migrate()` (Task 4 refactors this file anyway).

- [ ] **Step 8: Verify (sqlite path).** `pnpm --filter @allure-station/server test` (no pg env) — ALL existing tests green via libsql `:memory:` + migrate. `pnpm --filter @allure-station/server typecheck` clean. Root `pnpm test` + `pnpm typecheck` green.
- [ ] **Step 9: Commit.** `git add -A && git commit -m "feat(db): libsql (async) sqlite driver + Postgres option behind one repo; adopt drizzle migrate(), drop ensureSchema (code-review #9)"`

---

## Task 4: Parameterized repository conformance (sqlite always + Postgres env-gated)

**Files:** `repositories.test.ts` (refactor), optionally a shared `db/conformance.ts`.

- [ ] **Step 1: Refactor `repositories.test.ts`** into a backend-parameterized suite. A `backends` array always includes sqlite `:memory:`; pushes postgres when `PG_TEST_URL` is set. Run the SAME behavior tests across both.
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "./client.js";
import { ProjectRepository, RunRepository } from "./repositories.js";

type Backend = { name: string; make: () => Promise<{ projects: ProjectRepository; runs: RunRepository; cleanup: () => Promise<void> }> };

const backends: Backend[] = [
  { name: "sqlite", make: async () => {
      const { db, migrate } = createDb("sqlite", { url: ":memory:" }); await migrate();
      return { projects: new ProjectRepository(db), runs: new RunRepository(db), cleanup: async () => {} };
  } },
];
if (process.env.PG_TEST_URL) {
  backends.push({ name: "postgres", make: async () => {
      const { db, migrate } = createDb("postgres", { url: process.env.PG_TEST_URL! }); await migrate();
      const p = new ProjectRepository(db); const r = new RunRepository(db);
      // reset state between tests
      await db.execute?.("TRUNCATE runs, projects CASCADE" as any).catch(() => {});
      return { projects: p, runs: r, cleanup: async () => {} };
  } });
}

for (const backend of backends) {
  describe(`repositories: ${backend.name}`, () => {
    let projects: ProjectRepository; let runs: RunRepository; let cleanup: () => Promise<void>;
    beforeEach(async () => { ({ projects, runs, cleanup } = await backend.make()); });
    // ...port the EXISTING tests verbatim: create/list/get, duplicate throws, run create→markReady+latestRunId,
    //    listReadyByProject (no-limit + limit), claimPending race (true then false), failStaleGenerating...
  });
}
```
(For the pg TRUNCATE-between-tests: simplest is a fresh schema per test via a unique pg `search_path`/schema, but TRUNCATE CASCADE in `beforeEach` is adequate; adapt to what works — the spike used TRUNCATE.)

- [ ] **Step 2: Verify sqlite path** (no env): `pnpm --filter @allure-station/server test src/db` green; pg suite absent.
- [ ] **Step 3: Verify Postgres LIVE.** Start pg: `docker run -d --name as-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=allure -p 5432:5432 postgres:16`; wait for `pg_isready`. Run `PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db` → BOTH backends pass. Then `docker rm -f as-pg`.
- [ ] **Step 4: Commit.** `git add packages/server && git commit -m "test(db): parameterized repository conformance — sqlite always, Postgres when PG_TEST_URL"`

---

## Task 5: Compose + config wiring + docs

**Files:** `docker/docker-compose.yml`, `docker/docker-compose.test.yml`, `README.md`.

- [ ] **Step 1: `docker-compose.test.yml`** — add a `postgres:16` service (sibling to `minio`): env `POSTGRES_PASSWORD`, `POSTGRES_DB=allure`, port 5432, a healthcheck (`pg_isready`). This is what CI uses for the env-gated conformance (`PG_TEST_URL`).
- [ ] **Step 2: `docker-compose.yml`** — add an OPTIONAL `postgres` service behind a compose `profiles: ["postgres"]` so default `docker compose up` stays SQLite/zero-config. Show (commented) the app env to switch to pg: `DB_DRIVER=postgres`, `DATABASE_URL=postgresql://allure:allure@postgres:5432/allure`. Add a `postgres-data` named volume.
- [ ] **Step 3: README** — add a "Database" section: `DB_DRIVER=sqlite|postgres` (+ `DB_FILE` for sqlite, `DATABASE_URL` for pg), the migration commands (`db:generate:sqlite`/`db:generate:pg`), and how to run the pg conformance (`docker compose -f docker/docker-compose.test.yml up -d postgres` + `PG_TEST_URL=...`).
- [ ] **Step 4: Verify + commit.** `pnpm test` + `pnpm typecheck` (root, no pg env) green; `docker compose -f docker/docker-compose.yml config` validates; a manual `DB_DRIVER=postgres DATABASE_URL=...` smoke against the pg container (create project → send-results → generate → trends) works. `git add -A && git commit -m "feat(db): Postgres compose service (profile) + config + docs"`

---

## Self-Review (spec coverage)
- **Postgres option, SQLite default:** Tasks 2–5 — one async repo over libsql|node-postgres, `DB_DRIVER` selects.
- **#9 resolved:** `migrate()` replaces `ensureSchema`; the `.session.client` pierce is gone (Task 3).
- **Parity:** dual conformance suite (Task 4), verified live vs Postgres.
- **Zero-config preserved:** sqlite/libsql default everywhere; pg behind a compose profile + env.

## Out of scope (later)
- BullMQ/Redis external queue — Slice 2b-iii.
- Live `watch` — Slice 2c.
- pg `jsonb` for stats, connection pooling tuning, read-replicas, pg-side SSL config — future.
- Content-addressed asset dedupe — deferred.

## Risks
1. **libsql swap touches the default path every user runs.** Mitigation: the sqlite conformance suite + the full existing server suite must stay green on libsql `:memory:`+migrate before committing Task 3.
2. **Async ripple to `makeTestDeps`** — broad but mechanical (`await`); a missed call site fails typecheck/tests loudly.
3. **One `as unknown as Db` cast at the pg factory** — unavoidable (drizzle per-dialect types); contained to one commented line, runtime-verified.
4. **Two migration trees can drift** — every schema change generates twice (sqlite+pg); the dual conformance suite catches divergence.
5. **Migration provenance** — keep `drizzle/sqlite/meta/_journal.json` intact when relocating so existing local DBs don't re-run 0000/0001.
6. **better-sqlite3 removal** — confirm nothing else imports it (spike: only `client.ts`). Native-module build pain in Docker also goes away (libsql ships prebuilt binaries).
