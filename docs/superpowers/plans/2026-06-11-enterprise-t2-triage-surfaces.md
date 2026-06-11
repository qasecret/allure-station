# Enterprise T2: Triage Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily surfaces answer triage questions directly: home status strip + worst-first sorting on an enriched (N+1-free) project list, a re-hierarchized project page with a real trend chart, humanized + filterable audit log with CSV export, and sortable runs.

**Architecture:** Per `docs/superpowers/specs/2026-06-11-enterprise-t2-triage-surfaces-design.md` (read it first). Server: extend contracts in `@allure-station/shared`, add a one-pass enriched project listing (window-function query, both dialects support `ROW_NUMBER()`), an `/overview` counts endpoint, audit filter params (indexes already exist: `idx_audit_at`, `idx_audit_project_at` — NO audit migration), runs `?sort/order` (requires the tier's ONLY migration: a backfilled `duration_ms` column on runs, because sorting on JSON `statsJson` is not dialect-portable), trends `?limit=`. Web: status strip + sort on Projects, ProjectCard consumes embedded `latestRun` (delete its self-fetch), project-page stats row + collapsible Compare + new `TrendChart`, audit humanization/filters/CSV, sortable runs headers. Every route change goes through the OpenAPI registry (drift test).

**Tech Stack:** TypeScript ESM, Fastify 4, Drizzle (dual dialects), zod, React 18 + TanStack Query, Playwright e2e (shared `tests/helpers.ts`), axe gate.

**Verification commands:**
```bash
pnpm --filter @allure-station/server test src/routes/<file>.test.ts
pnpm --filter @allure-station/web test
pnpm test && pnpm typecheck
rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e
# dialect-sensitive queries (window fn, backfill migration) — run ONCE during Task 1 and Task 4:
docker compose -f docker/docker-compose.test.yml up -d postgres
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
```

**Key existing code facts** (verified): `ProjectRepository.list` currently calls `#withLatest` per row (the N+1 to delete, `repositories.ts:43-53,101-109`); `RunRepository.#selectRuns` is the runs query core (`:197-212`); `markReady` writes `statsJson` (`:158-162`); `AuditRepository.#where` takes `projectId`/`since` (`audit-repo.ts:38-43`); audit table HAS `idx_audit_at` + `idx_audit_project_at`; shared `evaluateGate(stats, config)` returns `{configured, passed, checks}`; trends route uses `const TREND_LIMIT = 30` (`routes/runs.ts:7`); `Projects.tsx` holds `q`/`page` in useState (not URL); `ProjectCard` self-fetches `["runs", p.id]`; e2e helpers live in `packages/e2e/tests/helpers.ts` (`visible()`, `createProject`, `createProjectWithRun`, `FIXTURE`).

---

### Task 1: Server — enriched project list + sort (contracts, repo, route)

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/server/src/db/repositories.ts` (ProjectRepository)
- Modify: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/projects.test.ts` (append)

- [ ] **Step 1: Failing tests** — append to `projects.test.ts`:

```ts
describe("enriched project list + sort", () => {
  async function seed(deps: Awaited<ReturnType<typeof makeTestDeps>>) {
    const app = buildApp(deps);
    for (const id of ["alpha", "beta", "gamma"]) {
      await app.inject({ method: "POST", url: "/api/projects", payload: { id } });
    }
    // beta: ready 8/8 (healthy). gamma: ready 5/8 + gate breach. alpha: no runs.
    await deps.runs.create("beta", "b1", "R", "2026-06-11T01:00:00.000Z");
    await deps.runs.claimPending("b1", "2026-06-11T01:00:01.000Z");
    await deps.runs.markReady("b1", { total: 8, passed: 8, failed: 0, broken: 0, skipped: 0, durationMs: 1000 }, "2026-06-11T01:00:02.000Z");
    await deps.projects.setQualityGate("gamma", { maxFailures: 0 });
    await deps.runs.create("gamma", "g1", "R", "2026-06-11T02:00:00.000Z");
    await deps.runs.claimPending("g1", "2026-06-11T02:00:01.000Z");
    await deps.runs.markReady("g1", { total: 8, passed: 5, failed: 3, broken: 0, skipped: 0, durationMs: 2000 }, "2026-06-11T02:00:02.000Z");
    return app;
  }

  it("embeds latestRun with stats and gatePassed", async () => {
    const deps = await makeTestDeps();
    const app = await seed(deps);
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const items = res.json() as Array<{ id: string; latestRun: null | { id: string; status: string; stats: { passed: number } | null; gatePassed: boolean | null } }>;
    const byId = Object.fromEntries(items.map((p) => [p.id, p]));
    expect(byId.alpha.latestRun).toBeNull();
    expect(byId.beta.latestRun?.stats?.passed).toBe(8);
    expect(byId.beta.latestRun?.gatePassed).toBeNull();     // no gate configured
    expect(byId.gamma.latestRun?.gatePassed).toBe(false);   // gate breach
    await app.close();
  });

  it("sort=worst puts gate-breached first, no-runs last; sort=active by recency", async () => {
    const deps = await makeTestDeps();
    const app = await seed(deps);
    const worst = (await app.inject({ method: "GET", url: "/api/projects?sort=worst" })).json() as Array<{ id: string }>;
    expect(worst.map((p) => p.id)).toEqual(["gamma", "beta", "alpha"]);
    const active = (await app.inject({ method: "GET", url: "/api/projects?sort=active" })).json() as Array<{ id: string }>;
    expect(active.map((p) => p.id)).toEqual(["gamma", "beta", "alpha"]); // gamma newest run
    expect((await app.inject({ method: "GET", url: "/api/projects?sort=bogus" })).statusCode).toBe(400);
    await app.close();
  });

  it("sort composes with q and pagination, X-Total-Count intact", async () => {
    const deps = await makeTestDeps();
    const app = await seed(deps);
    const res = await app.inject({ method: "GET", url: "/api/projects?sort=worst&limit=2&offset=0" });
    expect((res.json() as Array<{ id: string }>).map((p) => p.id)).toEqual(["gamma", "beta"]);
    expect(res.headers["x-total-count"]).toBe("3");
    await app.close();
  });
});
```
(Adapt `markReady` stats shape to the actual `RunStats` contract — check `runStatsSchema`; include `flaky` if required.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @allure-station/server test src/routes/projects.test.ts` → FAIL (`latestRun` undefined; 400 not raised).

- [ ] **Step 3: Contracts** — in `contracts.ts`, after `projectSchema`:

```ts
export const latestRunSummarySchema = z.object({
  id: z.string(),
  status: runStatusSchema,
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  stats: runStatsSchema.nullable(),
  gatePassed: z.boolean().nullable(), // null = no gate configured or no stats
});
export const projectListItemSchema = projectSchema.extend({ latestRun: latestRunSummarySchema.nullable() });
export const projectSortSchema = z.enum(["name", "worst", "active"]);
export type LatestRunSummary = z.infer<typeof latestRunSummarySchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type ProjectSort = z.infer<typeof projectSortSchema>;
```

- [ ] **Step 4: Repository** — replace `ProjectRepository.list` with an enriched one-pass implementation and keep `count` as is. Add to the class (imports: `sql` already imported; add `evaluateGate` from `@allure-station/shared` and `ProjectListItem, ProjectSort, RunStats, RunStatus` types):

```ts
  /** One-pass enriched listing: window-function picks each project's latest run (rn=1) — both
   *  SQLite (≥3.25) and Postgres support ROW_NUMBER. Sorting happens in JS over the full filtered
   *  set (instance project counts are small); pagination slices afterwards. */
  async listEnriched(opts: { q?: string; scope?: VisibilityScope; sort?: ProjectSort; limit?: number; offset?: number } = {}): Promise<{ items: ProjectListItem[]; total: number }> {
    const rows = await this.db.select().from(projects).where(this.#where(opts.q, opts.scope)).orderBy(projects.id);
    const latest = rows.length === 0 ? [] : await this.db.all<{
      project_id: string; id: string; status: string; created_at: string; finished_at: string | null; stats_json: string | null;
    }>(sql`
      SELECT project_id, id, status, created_at, finished_at, stats_json FROM (
        SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.project_id ORDER BY r.created_at DESC, r.id DESC) AS rn
        FROM runs r WHERE r.project_id IN ${rows.map((p) => p.id)}
      ) ranked WHERE rn = 1
    `);
    const latestByProject = new Map(latest.map((r) => [r.project_id, r]));
    const items: ProjectListItem[] = rows.map((p) => {
      const lr = latestByProject.get(p.id);
      const stats = lr?.stats_json ? (JSON.parse(lr.stats_json) as RunStats) : null;
      const gateCfg = p.qualityGate ? (JSON.parse(p.qualityGate) as QualityGateConfig) : null;
      const gatePassed = gateCfg && stats ? evaluateGate(stats, gateCfg).passed : null;
      return {
        id: p.id, displayName: p.displayName ?? null, createdAt: p.createdAt,
        visibility: p.visibility as ProjectVisibility, latestRunId: lr?.id ?? null,
        latestRun: lr ? { id: lr.id, status: lr.status as RunStatus, createdAt: lr.created_at, finishedAt: lr.finished_at, stats, gatePassed } : null,
      };
    });
    const passRate = (i: ProjectListItem) => i.latestRun?.stats ? i.latestRun.stats.passed / Math.max(1, i.latestRun.stats.total) : null;
    if (opts.sort === "worst") {
      items.sort((a, b) => {
        const breach = (i: ProjectListItem) => (i.latestRun?.gatePassed === false ? 0 : 1);
        if (breach(a) !== breach(b)) return breach(a) - breach(b);
        const ra = passRate(a), rb = passRate(b);
        if (ra === null && rb === null) return a.id.localeCompare(b.id);
        if (ra === null) return 1;            // no-runs last
        if (rb === null) return -1;
        if (ra !== rb) return ra - rb;        // lowest pass-rate first
        return a.id.localeCompare(b.id);
      });
    } else if (opts.sort === "active") {
      items.sort((a, b) => {
        const ca = a.latestRun?.createdAt, cb = b.latestRun?.createdAt;
        if (!ca && !cb) return a.id.localeCompare(b.id);
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.localeCompare(ca);          // newest first
      });
    } // "name"/default: already ordered by id
    const total = items.length;
    const offset = opts.offset ?? 0;
    const paged = opts.limit !== undefined ? items.slice(offset, offset + opts.limit) : items;
    return { items: paged, total };
  }
```
IMPORTANT adaptions while implementing: (a) `this.db.all<...>(sql...)` — check how raw SQL is executed on the `Db` type in this codebase (grep for `db.all` / `db.run` / `db.execute`; libsql drizzle exposes `.all()`, the pg cast may differ — if `.all` isn't portable, use `this.db.run`? Investigate `db/client.ts`; the pg handle is cast to the libsql-typed Db and `.all` must exist on both — verify by running the PG conformance suite in Step 7). (b) `IN ${array}` — drizzle `sql` needs `sql.join` or `inArray`-style interpolation for arrays; use `sql`...IN (${sql.join(rows.map((p) => sql`${p.id}`), sql`, `)})``` (exact drizzle 0.3x syntax — check the version's docs/usages).

- [ ] **Step 5: Route** — in `routes/projects.ts` GET /projects (imports add `projectSortSchema`):

```ts
  app.get("/projects", async (req, reply) => {
    const { q, sort } = req.query as { q?: string; sort?: string };
    const parsedSort = sort === undefined ? undefined : projectSortSchema.safeParse(sort);
    if (parsedSort && !parsedSort.success) return reply.code(400).send({ error: `invalid sort "${sort}"` });
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const scope = await visibilityScopeFor(deps, await authenticate(deps, req));
    const { items, total } = await deps.projects.listEnriched({ q, scope, sort: parsedSort?.data, ...page });
    reply.header("X-Total-Count", String(total));
    return items;
  });
```
Keep `deps.projects.list`/`count` for any other internal callers (grep; if none remain, delete them and their `#withLatest` N+1 helper IF `get()` no longer needs it — `get()` does; keep `#withLatest` for `get`).

- [ ] **Step 6: OpenAPI** — list response schema becomes `z.array(projectListItemSchema)`, query gains `sort: projectSortSchema.optional()` (import it; follow the existing declaration style).

- [ ] **Step 7: Verify both dialects + green**
```bash
pnpm --filter @allure-station/server test src/routes/projects.test.ts src/openapi
docker compose -f docker/docker-compose.test.yml up -d postgres
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
pnpm test && pnpm typecheck
```
If the repositories conformance suite doesn't already cover `listEnriched`, add a case there (seed two projects + runs, assert latestRun + worst order) so the PG path is genuinely exercised.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(server): enriched project list with latestRun + worst/active sort (one-pass, both dialects)"`

---

### Task 2: Server — overview endpoint

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Create: `packages/server/src/routes/overview.ts`
- Modify: `packages/server/src/app.ts` (register)
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/overview.test.ts` (new)

- [ ] **Step 1: Failing tests** — `overview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("GET /overview", () => {
  it("counts projects, failing, gate breaches, runs in 24h, generating — scoped by visibility", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "ok" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "bad" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "busy" } });
    // ok: healthy ready run
    await deps.runs.create("ok", "r-ok", "R", deps.now());
    await deps.runs.claimPending("r-ok", deps.now());
    await deps.runs.markReady("r-ok", { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 }, deps.now());
    // bad: latest run has failures + breaches its gate
    await deps.projects.setQualityGate("bad", { maxFailures: 0 });
    await deps.runs.create("bad", "r-bad", "R", deps.now());
    await deps.runs.claimPending("r-bad", deps.now());
    await deps.runs.markReady("r-bad", { total: 2, passed: 1, failed: 1, broken: 0, skipped: 0 }, deps.now());
    // busy: a run still generating
    await deps.runs.create("busy", "r-busy", "R", deps.now());
    await deps.runs.claimPending("r-busy", deps.now());

    const res = await app.inject({ method: "GET", url: "/api/overview" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: 3, failing: 1, gateBreached: 1, runsLast24h: 3, generating: 1 });
    await app.close();
  });

  it("anonymous overview excludes private projects", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "pub" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "priv" } });
    await deps.projects.setVisibility("priv", "private");
    // seed a user so security is on and anonymous is actually scoped
    await deps.users.create("a@example.com", "password123", "admin", deps.now());
    const res = await app.inject({ method: "GET", url: "/api/overview" });
    expect(res.json().projects).toBe(1);
    await app.close();
  });
});
```
(Adapt `deps.users.create` signature to the actual user repo — grep `users.create` in existing tests; same for `RunStats` shape.)

- [ ] **Step 2: verify failure** (404 route), then **Step 3: contract**:

```ts
export const overviewSchema = z.object({
  projects: z.number().int(),
  failing: z.number().int(),
  gateBreached: z.number().int(),
  runsLast24h: z.number().int(),
  generating: z.number().int(),
});
export type Overview = z.infer<typeof overviewSchema>;
```

- [ ] **Step 4: Route** — `routes/overview.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Overview } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, visibilityScopeFor } from "../auth.js";

/** Instance-wide triage counts, scoped to what the caller may see. Derives failing/gateBreached
 *  from the same enriched listing the projects grid uses, so the two never disagree. */
export function registerOverviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/overview", async (req): Promise<Overview> => {
    const scope = await visibilityScopeFor(deps, await authenticate(deps, req));
    const { items } = await deps.projects.listEnriched({ scope });
    const cutoff = new Date(Date.parse(deps.now()) - 24 * 60 * 60 * 1000).toISOString();
    let failing = 0, gateBreached = 0, runsLast24h = 0, generating = 0;
    for (const p of items) {
      const lr = p.latestRun;
      if (lr && (lr.status === "failed" || (lr.stats != null && lr.stats.failed + lr.stats.broken > 0))) failing += 1;
      if (lr?.gatePassed === false) gateBreached += 1;
    }
    // run-level counts respect the same project set
    const visibleIds = new Set(items.map((p) => p.id));
    const runCounts = await deps.runs.countTriage([...visibleIds], cutoff);
    runsLast24h = runCounts.last24h;
    generating = runCounts.generating;
    return { projects: items.length, failing, gateBreached, runsLast24h, generating };
  });
}
```
Add to `RunRepository`:
```ts
  /** Triage counts for the overview: runs created in the window + currently generating, limited to
   *  the given (visibility-scoped) projects. */
  async countTriage(projectIds: string[], since: string): Promise<{ last24h: number; generating: number }> {
    if (projectIds.length === 0) return { last24h: 0, generating: 0 };
    const [a] = await this.db.select({ c: count() }).from(runs)
      .where(and(inArray(runs.projectId, projectIds), gte(runs.createdAt, since)));
    const [b] = await this.db.select({ c: count() }).from(runs)
      .where(and(inArray(runs.projectId, projectIds), eq(runs.status, "generating")));
    return { last24h: Number(a?.c ?? 0), generating: Number(b?.c ?? 0) };
  }
```
(`gte` import from drizzle-orm.) Register in `app.ts` next to the other `register*Routes` (read the file, match style). OpenAPI: `{ method: "get", path: "/api/overview", tag: "meta", summary: "Instance triage counts", ok: { status: 200, schema: overviewSchema } }`.

- [ ] **Step 5: green + commit** — route tests + openapi + `pnpm test && pnpm typecheck`; `git add -A && git commit -m "feat(server): GET /overview triage counts (visibility-scoped)"`

---

### Task 3: Server — audit filters

**Files:**
- Modify: `packages/server/src/db/audit-repo.ts`
- Modify: `packages/server/src/routes/audit.ts`
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/audit.test.ts` (append)

- [ ] **Step 1: Failing tests** — append (mirror existing audit.test.ts setup — it seeds an admin and authenticates; reuse its helper/session pattern EXACTLY):

```ts
it("filters by action, actor substring, and from/to window; total reflects filters", async () => {
  // ...use this file's existing authenticated-admin setup to obtain `app` + auth cookie...
  // seed: create a project (project_created), rename it (project_renamed), create a token (token_created)
  // then:
  const filtered = await app.inject({ method: "GET", url: "/api/audit?action=project_renamed", headers: authHeaders });
  expect(filtered.json()).toHaveLength(1);
  expect(filtered.headers["x-total-count"]).toBe("1");
  expect((await app.inject({ method: "GET", url: "/api/audit?action=bogus", headers: authHeaders })).statusCode).toBe(400);
  const byActor = await app.inject({ method: "GET", url: "/api/audit?actor=admin@", headers: authHeaders });
  expect((byActor.json() as unknown[]).length).toBeGreaterThan(0);
  const none = await app.inject({ method: "GET", url: `/api/audit?from=2030-01-01T00:00:00.000Z`, headers: authHeaders });
  expect(none.json()).toHaveLength(0);
});
```
Write it as REAL code against the file's existing fixtures (the snippet above states the contract; the implementer adapts the setup lines from the surrounding tests, not the assertions).

- [ ] **Step 2: verify failure**, then **Step 3: repo** — extend `#where` and the public signatures:

```ts
  #where(opts: { projectId?: string; since?: string; action?: AuditAction; actor?: string; from?: string; to?: string }) {
    const clauses = [];
    if (opts.projectId !== undefined) clauses.push(eq(auditLog.projectId, opts.projectId));
    if (opts.since !== undefined) clauses.push(gte(auditLog.at, opts.since));
    if (opts.action !== undefined) clauses.push(eq(auditLog.action, opts.action));
    if (opts.actor !== undefined) clauses.push(likeContains(auditLog.actorLabel, opts.actor));
    if (opts.from !== undefined) clauses.push(gte(auditLog.at, opts.from));
    if (opts.to !== undefined) clauses.push(lte(auditLog.at, opts.to));
    return clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  }
```
`likeContains` lives in `repositories.ts` — EXPORT it from there and import here (don't duplicate). `lte` from drizzle-orm. Thread the new opts through `list`/`count` signatures.

- [ ] **Step 4: Route** — in `routes/audit.ts`, both handlers parse the new query params: `action` validated via `auditActionSchema.safeParse` (400 on invalid), `actor` plain string, `from`/`to` must parse as dates (`Number.isNaN(Date.parse(v))` → 400) and are passed through as-is (ISO strings compare lexicographically with the stored `at`). Pass to `deps.audit.list/count`.

- [ ] **Step 5: OpenAPI** — both audit declarations gain a query schema: `z.object({ action: auditActionSchema.optional(), actor: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).merge(pageQuery)` (match the registry's existing query style).

- [ ] **Step 6: green + commit** — `git add -A && git commit -m "feat(server): audit log filters (action, actor, from/to)"`

---

### Task 4: Server — runs sort + trends limit (with the duration_ms migration)

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts` + `schema.pg.ts` (runs: `durationMs` integer column)
- Generate+edit: new migration in `packages/server/drizzle/sqlite/` and `drizzle/pg/` (backfill statement appended)
- Modify: `packages/server/src/db/repositories.ts` (markReady writes durationMs; #selectRuns sort)
- Modify: `packages/server/src/routes/runs.ts` (sort/order + trends limit params)
- Modify: `packages/server/src/openapi/registry.ts`
- Modify: `packages/shared/src/contracts.ts` (runSortSchema)
- Test: `packages/server/src/routes/runs.test.ts` (append)

- [ ] **Step 1: Failing tests** — append to `runs.test.ts`:

```ts
describe("runs sorting + trends limit", () => {
  it("sorts by duration desc with nulls last, and by status; validates params", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "slow", "R", "2026-06-11T01:00:00.000Z");
    await deps.runs.claimPending("slow", "x"); await deps.runs.markReady("slow", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0, durationMs: 9000 }, "x");
    await deps.runs.create("p", "fast", "R", "2026-06-11T02:00:00.000Z");
    await deps.runs.claimPending("fast", "x"); await deps.runs.markReady("fast", { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0, durationMs: 1000 }, "x");
    await deps.runs.create("p", "pend", "R", "2026-06-11T03:00:00.000Z"); // no stats → null duration

    const dur = await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=duration&order=desc" });
    expect((dur.json() as Array<{ id: string }>).map((r) => r.id)).toEqual(["slow", "fast", "pend"]);
    const st = await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=status" });
    expect(st.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs?sort=nope" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs?order=sideways" })).statusCode).toBe(400);
    await app.close();
  });

  it("trends honors ?limit within 10..100", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    for (let i = 0; i < 12; i++) {
      const id = `r${String(i).padStart(2, "0")}`;
      await deps.runs.create("p", id, "R", `2026-06-11T0${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}:00.000Z`);
      await deps.runs.claimPending(id, "x");
      await deps.runs.markReady(id, { total: 1, passed: 1, failed: 0, broken: 0, skipped: 0 }, "x");
    }
    expect(((await app.inject({ method: "GET", url: "/api/projects/p/trends?limit=10" })).json() as unknown[])).toHaveLength(10);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/trends?limit=5" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/trends" })).json()).toHaveLength(12); // default 30 cap
    await app.close();
  });
});
```

- [ ] **Step 2: verify failure**, then **Step 3: schema + migration (BOTH dialects)** — add to the `runs` table in `schema.sqlite.ts`: `durationMs: integer("duration_ms"),` (import `integer` from drizzle sqlite-core; pg uses its own `integer`/`bigint` — match the pg schema's number-column convention). Regenerate:
```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```
Then APPEND a backfill statement to each generated migration file (migrations are plain SQL — appending is sanctioned):
- sqlite migration: `UPDATE runs SET duration_ms = CAST(json_extract(stats_json, '$.durationMs') AS INTEGER) WHERE stats_json IS NOT NULL;`
- pg migration: `UPDATE runs SET duration_ms = NULLIF((stats_json::jsonb ->> 'durationMs'), '')::bigint WHERE stats_json IS NOT NULL;`
(Statement separator: check how multi-statement migrations are formatted in existing files — drizzle uses `--> statement-breakpoint`.)

- [ ] **Step 4: Repo** — `markReady` also sets the column:
```ts
  async markReady(id: string, stats: RunStats, finishedAt: string): Promise<void> {
    await this.db.update(runs)
      .set({ status: "ready", statsJson: JSON.stringify(stats), durationMs: stats.durationMs ?? null, finishedAt, error: null })
      .where(eq(runs.id, id));
  }
```
`#selectRuns` gains `sort` (`"createdAt" | "duration" | "status"`, default createdAt): for `duration`, order by `runs.durationMs` with nulls last — drizzle: `sql`${runs.durationMs} IS NULL`` ASC first then the column with the requested direction; for `status`, order by `runs.status` (text) then createdAt desc as tie-break. Keep the existing id tie-break everywhere. `listByProject` passes `sort`/`order` through.

- [ ] **Step 5: Routes + contract + OpenAPI** — `contracts.ts`: `export const runSortSchema = z.enum(["createdAt", "duration", "status"]);` + `export const sortOrderSchema = z.enum(["asc", "desc"]);`. `routes/runs.ts` GET runs: parse+validate both (400 invalid), pass through. Trends route: replace `TREND_LIMIT` usage with a parsed `limit` (`z.coerce.number().int().min(10).max(100).default(30)` — validate manually consistent with the codebase's safeParse style; 400 out of range). OpenAPI query schemas updated for both routes.

- [ ] **Step 6: verify both dialects + green** — run the PG repositories conformance suite (migration + nulls-last ordering are dialect-sensitive):
```bash
pnpm --filter @allure-station/server test src/routes/runs.test.ts src/openapi
docker compose -f docker/docker-compose.test.yml up -d postgres
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure pnpm --filter @allure-station/server test src/db/repositories
pnpm test && pnpm typecheck
```

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(server): runs sort (duration_ms column, backfilled) + trends ?limit"`

---

### Task 5: Web — home page (strip, sort, N+1-free cards)

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/pages/Projects.tsx`
- Modify: `packages/web/src/components/ProjectCard.tsx`
- Test: `packages/web/src/api/client.test.ts` (append)

- [ ] **Step 1: Failing client test:**

```ts
it("listProjects passes sort; getOverview hits /overview", async () => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(url.includes("overview") ? { projects: 1, failing: 0, gateBreached: 0, runsLast24h: 2, generating: 0 } : []), { status: 200, headers: { "content-type": "application/json", "x-total-count": "0" } });
  }) as unknown as typeof fetch;
  const c = createClient("/api", f);
  await c.listProjects({ sort: "worst" });
  expect(calls[0]).toContain("sort=worst");
  const o = await c.getOverview();
  expect(o.runsLast24h).toBe(2);
});
```

- [ ] **Step 2: verify failure**, then **Step 3: client** — `listProjects` opts gain `sort?: ProjectSort`; return type becomes `Promise<{ items: ProjectListItem[]; total: number }>` (import types from shared); add `getOverview(): Promise<Overview>` → `json<Overview>("/overview", { method: "GET" })`. Update `listRuns`/`listRunsWithTotal` opts with `sort?: string; order?: string` (used in Task 8) and `listTrends(projectId, limit?: number)` appending `?limit=` when set.

- [ ] **Step 4: Status strip + sort control** — in `Projects.tsx`:
- Move `q` and add `sort` into URL search params (`useSearchParams`, mirroring Project.tsx's `?run=` pattern; `page` stays in state). `const sort = (searchParams.get("sort") as ProjectSort) ?? "name";`
- Overview query + strip ABOVE the search row:

```tsx
function OverviewStrip({ onTriage }: { onTriage: () => void }) {
  const { data } = useQuery({ queryKey: ["overview"], queryFn: () => api.getOverview(), refetchInterval: 30_000 });
  if (!data) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}</div>;
  const Tile = ({ label, value, accent, onClick }: { label: string; value: number; accent?: string; onClick?: () => void }) => (
    <button type="button" disabled={!onClick} onClick={onClick}
      className={cn("rounded-xl border bg-card p-3 text-left shadow-sm", onClick && "cursor-pointer hover:shadow-md")}>
      <div className={cn("text-2xl font-semibold tabular-nums", accent)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Instance status">
      <Tile label="Failing projects" value={data.failing} accent={data.failing > 0 ? "text-status-fail" : undefined} onClick={data.failing > 0 ? onTriage : undefined} />
      <Tile label="Gate breaches" value={data.gateBreached} accent={data.gateBreached > 0 ? "text-status-broken" : undefined} onClick={data.gateBreached > 0 ? onTriage : undefined} />
      <Tile label="Runs (24h)" value={data.runsLast24h} />
      <Tile label="Generating" value={data.generating} accent={data.generating > 0 ? "animate-pulse text-primary-text" : undefined} />
    </div>
  );
}
```
`onTriage` sets `sort=worst` in the URL. Sort `Select` beside the search input (options Name / Worst first / Recently active → `name|worst|active`), writing the URL param and resetting page. Query key becomes `["projects", q, page, sort]` and `listProjects({ q, sort, limit, offset })`.

- [ ] **Step 5: ProjectCard consumes latestRun** — rewrite (`p: ProjectListItem`): DELETE the `useQuery(["runs", p.id])`; donut/“passed · ago” derive from `p.latestRun`; add a gate chip `{p.latestRun?.gatePassed === false && <Badge variant="outline" className="border-status-fail/40 text-status-fail">gate ✗</Badge>}` (and a pass chip only when explicitly true). Sparkline: keep the component but fetch on demand:

```tsx
  const [hovered, setHovered] = useState(false);
  const { data: trendPts } = useQuery({
    queryKey: ["trends", p.id],
    queryFn: () => api.listTrends(p.id),
    enabled: hovered && !!p.latestRun,   // fetch only when the card is hovered/focused; omitted below sm by CSS
    staleTime: 60_000,
  });
```
Container gets `onMouseEnter/onFocus` → `setHovered(true)`; sparkline wrapper `hidden sm:block`. The "passed · ago" line uses `p.latestRun.stats` and `relativeTime(p.latestRun.createdAt)` with the existing fallbacks ("No runs yet").

- [ ] **Step 6: green + commit** — `pnpm --filter @allure-station/web test && pnpm typecheck`; e2e quick check (`pnpm --filter @allure-station/e2e exec playwright test smoke.spec.ts ux-fixes.spec.ts`). `git add -A && git commit -m "feat(web): home status strip, server-driven sort, N+1-free project cards"`

---

### Task 6: Web — project page hierarchy (stats row + compare disclosure)

**Files:**
- Modify: `packages/web/src/pages/Project.tsx`
- Test: `packages/web/src/lib/format.test.ts` (append: delta formatter)

- [ ] **Step 1: Failing unit test** — a tiny pure helper for deltas in `lib/format.ts`:

```ts
it("formatDelta renders signed deltas and omits zero", () => {
  expect(formatDelta(3)).toBe("+3");
  expect(formatDelta(-2)).toBe("-2");
  expect(formatDelta(0)).toBeNull();
});
```
Implement `export function formatDelta(n: number): string | null { return n === 0 ? null : n > 0 ? `+${n}` : String(n); }`.

- [ ] **Step 2: Stats row** — in `Project.tsx`, replace the Trend/Compare card pair (the `div.flex.flex-wrap.gap-3` containing the two Cards) with:

```tsx
        <div className={cn("space-y-3", focusReport && tab === "report" && "hidden")}>
          <StatsRow current={cur ?? null} previous={prevReady ?? null} />
          <TrendCard projectId={id} onSelectRun={setSelectedRun} compare={<ComparePanel projectId={id} readyRuns={runs.filter((r) => r.status === "ready")} />} />
        </div>
```
`prevReady` = the next ready run after `cur` in the already-loaded `runs` list (pure derivation: `runs.filter(r => r.status === "ready" && r.createdAt < (cur?.createdAt ?? "")).sort(desc)[0]`). `StatsRow` (local component): four tiles — Pass rate (reuse `PassRateDonut` size 40 + percent), Failures (`stats.failed + stats.broken`, delta vs previous via `formatDelta`, colored `text-status-fail` when positive delta / `text-status-pass` when negative), Duration (`formatDurationSec`, delta likewise), Flaky (count) — each `rounded-xl border bg-card p-3 shadow-sm`, grid `grid-cols-2 gap-3 sm:grid-cols-4`. Tiles render only when `cur?.stats` exists; otherwise keep the existing empty-state behavior.
`TrendCard` (local wrapper, full-width Card): header row = "Trend" title + window selector placeholder (wired in Task 7) + a disclosure (`<details>` house-style) labeled "Compare runs…" whose open state persists per project in sessionStorage (`compare-open:${id}`); body = `<TrendChart …/>` (Task 7; until then keep rendering the existing `TrendBar` inside the new layout so this task stays shippable). ComparePanel mounts INSIDE the disclosure unchanged.

- [ ] **Step 3: verify** — unit + typecheck + e2e ux-fixes/mobile specs still green (the trend empty-state copy and History buttons must remain reachable — ComparePanel inside an initially-closed details: the mobile.spec/ux-fixes tests that click History/compare need the disclosure OPEN; check those specs and have the e2e click the disclosure first OR default the disclosure open when 2+ ready runs exist — choose: DEFAULT OPEN when `readyRuns.length >= 2` and no stored preference; that preserves spec behavior).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): project stats row with deltas; trend card + collapsible compare"`

---

### Task 7: Web — TrendChart component

**Files:**
- Create: `packages/web/src/components/TrendChart.tsx`
- Create: `packages/web/src/lib/trend-geometry.ts` (+ `trend-geometry.test.ts`)
- Modify: `packages/web/src/pages/Project.tsx` (swap TrendBar → TrendChart; delete TrendBar)

- [ ] **Step 1: Failing geometry tests** — `trend-geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { barGeometry, xAxisLabels } from "./trend-geometry";

describe("trend geometry", () => {
  const pts = [
    { runId: "a", createdAt: "2026-06-10T10:00:00.000Z", stats: { total: 8, passed: 8, failed: 0, broken: 0, skipped: 0, durationMs: 1000 } },
    { runId: "b", createdAt: "2026-06-11T10:00:00.000Z", stats: { total: 8, passed: 4, failed: 4, broken: 0, skipped: 0, durationMs: 2000 } },
  ];
  it("scales bar heights by pass rate within the plot height", () => {
    const g = barGeometry(pts, { width: 300, height: 120 });
    expect(g.bars).toHaveLength(2);
    expect(g.bars[0].h).toBeGreaterThan(g.bars[1].h); // 100% vs 50%
    expect(g.bars[1].h / g.bars[0].h).toBeCloseTo(0.5, 1);
  });
  it("labels first and last points and day boundaries", () => {
    const labels = xAxisLabels(pts);
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(1);
  });
});
```

- [ ] **Step 2: implement `trend-geometry.ts`** — pure functions:

```ts
import type { TrendPoint } from "@allure-station/shared";

export interface BarGeom { x: number; y: number; w: number; h: number; rate: number; failed: boolean; flaky: boolean; durY: number | null }
export function barGeometry(points: TrendPoint[], plot: { width: number; height: number }): { bars: BarGeom[]; gridY: number[] } {
  const n = points.length;
  const gap = 4;
  const w = Math.max(6, Math.min(18, Math.floor(plot.width / Math.max(1, n)) - gap));
  const maxDur = Math.max(1, ...points.map((p) => p.stats.durationMs ?? 0));
  const bars = points.map((p, i) => {
    const rate = p.stats.total ? p.stats.passed / p.stats.total : 0;
    const h = Math.max(2, Math.round(rate * (plot.height - 4)));
    const dur = p.stats.durationMs ?? 0;
    return {
      x: i * (w + gap), y: plot.height - h, w, h, rate,
      failed: (p.stats.failed ?? 0) + (p.stats.broken ?? 0) > 0,
      flaky: (p.stats.flaky ?? 0) > 0,
      durY: dur ? plot.height - Math.round((dur / maxDur) * (plot.height - 8)) - 2 : null,
    };
  });
  return { bars, gridY: [0.25, 0.5, 0.75].map((f) => Math.round(plot.height * (1 - f))) };
}

export function xAxisLabels(points: TrendPoint[]): Array<{ index: number; text: string }> {
  if (points.length === 0) return [];
  const day = (iso: string) => iso.slice(0, 10);
  const labels: Array<{ index: number; text: string }> = [{ index: 0, text: day(points[0].createdAt) }];
  for (let i = 1; i < points.length; i++) {
    if (day(points[i].createdAt) !== day(points[i - 1].createdAt)) labels.push({ index: i, text: day(points[i].createdAt) });
  }
  const last = points.length - 1;
  if (labels[labels.length - 1].index !== last) labels.push({ index: last, text: day(points[last].createdAt) });
  return labels;
}
```

- [ ] **Step 3: `TrendChart.tsx`** — complete component contract: props `{ projectId: string; onSelectRun: (id: string) => void }`; internal state `limit` (10|30|100, default 30, persisted per project in sessionStorage `trend-window:${projectId}`) and `focusIndex`; query `["trends", projectId, limit]` → `api.listTrends(projectId, limit)`. Render: window selector (three `aria-pressed` chip Buttons, house style); empty state (<2 pts) reuses the existing copy verbatim; otherwise an SVG (`role="img"` with the data-bearing summary label, width responsive via viewBox) with: 3 gridlines (`stroke="hsl(var(--border))"`), y labels 25/50/75%, bars as `<g role="button" tabIndex={0} aria-label={…full datum…} onClick={() => onSelectRun(runId)} onKeyDown={Enter/Space → select; ArrowLeft/Right → move focus}` (refs array for roving focus), bar fill `#1DB980`/`#EF4444` per `failed` (existing semantics) + amber flaky topper, duration polyline (`stroke="hsl(var(--primary-text))"`), x-axis labels from `xAxisLabels` in `text-[10px] fill-muted-foreground font-mono`, and an HTML tooltip `<div role="tooltip">` positioned over the hovered/focused bar showing date · passed/total · failed · duration. Legend row under the chart (color not alone: "▮ pass-rate bar · ╱ duration"). Wire into `TrendCard` from Task 6 (replace the interim TrendBar; DELETE the old TrendBar function + its aria-label code from Project.tsx).

- [ ] **Step 4: verify** — unit (geometry + suite), typecheck, full e2e (`rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e`) — the axe gate now scans the chart; fix anything it raises (focusable `<g>` needs `focusable="true"` for some engines — verify axe is clean).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): accessible trend chart — axes, keyboard tooltips, window selector, click-to-select"`

---

### Task 8: Web — audit humanization, filters, CSV; sortable tables

**Files:**
- Create: `packages/web/src/lib/audit-format.ts` (+ `audit-format.test.ts`)
- Create: `packages/web/src/lib/csv.ts` (+ test)
- Modify: `packages/web/src/api/client.ts` (audit filter params)
- Modify: `packages/web/src/pages/Audit.tsx`
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (per-project audit card filter bar)
- Modify: `packages/web/src/components/RunsTable.tsx` (sortable headers)
- Modify: `packages/web/src/pages/Users.tsx` (client sort)

- [ ] **Step 1: Failing tests** — `audit-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auditActionSchema, type AuditEntry } from "@allure-station/shared";
import { describeAuditEntry } from "./audit-format";

const base: AuditEntry = { id: "1", at: "2026-06-11T00:00:00.000Z", actorType: "user", actorId: "u1", actorLabel: "admin@example.com", action: "project_created", targetType: "project", targetId: "demo-web", projectId: "demo-web", metadata: null };

describe("describeAuditEntry", () => {
  it("has a human sentence for EVERY audit action", () => {
    for (const action of auditActionSchema.options) {
      const s = describeAuditEntry({ ...base, action });
      expect(s, action).toBeTruthy();
      expect(s, action).not.toContain("{");          // no JSON leakage
      expect(s.toLowerCase(), action).toContain(" "); // a sentence, not a token
    }
  });
  it("includes salient metadata", () => {
    expect(describeAuditEntry({ ...base, action: "user_created", targetId: "u2", metadata: { email: "jane@example.com", role: "user" } }))
      .toBe("admin@example.com created user jane@example.com (user)");
    expect(describeAuditEntry({ ...base, action: "project_renamed", metadata: { from: null, to: "Demo Web App" } }))
      .toBe('admin@example.com renamed demo-web to "Demo Web App"');
  });
});
```
`csv.test.ts`: `toCsv([{a:1,b:"x,\"y\""}])` escapes quotes/commas/newlines per RFC4180 and emits a header row.

- [ ] **Step 2: implement** — `audit-format.ts`: a `const DESCRIBERS: Record<AuditAction, (e: AuditEntry) => string>` covering every enum value (login/logout/login_failed, user_created/deleted, token_created/deleted, member_set/removed, project_created/deleted/renamed, project_visibility_set, quality_gate_set, notification_created/deleted, run_deleted) composing `actorLabel`, a verb, target, and metadata fields; `describeAuditEntry` falls back for unknown actions to `` `${e.actorLabel} ${e.action.replace(/_/g, " ")}${e.targetId ? ` ${e.targetId}` : ""}` `` plus the route renders metadata chips. `csv.ts`: `toCsv(rows: Record<string, unknown>[]): string` (header from union of keys, RFC4180 escaping) + `downloadCsv(filename, rows)` using a Blob anchor click.

- [ ] **Step 3: client** — `listAudit`/`listProjectAudit` opts gain `action?, actor?, from?, to?` (qs already drops empty values).

- [ ] **Step 4: Audit page** — filter bar above the table (Select for action fed by `auditActionSchema.options`, debounced actor Input, two `<Input type="date">` mapped to ISO start/end-of-day), all mirrored in URL params; query key includes the filters; desktop columns Time · Event (`describeAuditEntry`) · Project with a per-row `<details>` (house style) revealing the raw metadata `<pre>`; mobile card list uses the sentence + same details. Export button: pages `api.listAudit` at limit 200 until exhausted or 10_000 rows (toast.warning when truncated), `downloadCsv(`audit-${new Date().toISOString().slice(0,10)}.csv`, rows.map(e => ({...raw fields..., event: describeAuditEntry(e)})))`. Per-project audit card in `ProjectSettings.tsx` gets the same bar minus project (reuse — extract the filter bar as `components/AuditFilterBar.tsx` consumed by both).

- [ ] **Step 5: Sortable runs headers** — `RunsTable.tsx`: state `{ sortKey: "createdAt"|"duration"|"status"; order: "asc"|"desc" }` default createdAt/desc; the runs-page query passes `sort/order`; Age, Duration, Status `<th>`s become buttons cycling desc → asc → default, with `aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}` and a chevron. Mobile card list shows the same ordering (same query). `Users.tsx`: client-side sort state on email/role with the same header-button pattern (no server change).

- [ ] **Step 6: green + commit** — unit + typecheck + full e2e. `git add -A && git commit -m "feat(web): humanized filterable audit log with CSV export; sortable runs/users tables"`

---

### Task 9: e2e journey, a11y populated-page scan, docs

**Files:**
- Modify: `packages/e2e/tests/a11y.spec.ts` (fixture project gains a run)
- Create: `packages/e2e/tests/triage.spec.ts`
- Modify: `README.md`, `docs/user-guide/README.md`
- Create: `design-system/allure-station/pages/project.md`

- [ ] **Step 1: a11y scan on populated pages** — in `a11y.spec.ts`, replace the bare project creation with the shared `createProjectWithRun` helper so `project:report` and `project:runs` scans cover stat tiles, trend chart, populated runs table, and the (now token-safe) links. Scans must stay green — if the new chart/tiles violate, fix the component (not the spec).

- [ ] **Step 2: triage journey** — `triage.spec.ts` (desktop viewport; reuse helpers):

```ts
import { test, expect } from "@playwright/test";
import { createProjectWithRun, visible } from "./helpers";

test("triage: strip → worst-first → stats deltas → chart → sorted runs → filtered audit + CSV", async ({ page }) => {
  await createProjectWithRun(page); // healthy baseline project exists
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Instance status" })).toBeVisible();
  await page.getByLabel(/Sort projects/).click();           // adapt to the Select's accessible name
  await page.getByRole("option", { name: "Worst first" }).click();
  await expect(page).toHaveURL(/sort=worst/);

  // open the project → stats row visible
  await visible(page.getByRole("link").filter({ hasText: /passed/ })).click();
  await expect(page.getByText(/Pass rate/)).toBeVisible();

  // trend chart keyboard interaction (needs 2+ runs — upload a second via the helper's upload step if required)
  // runs table duration sort
  await page.getByRole("tab", { name: "Runs" }).click();
  await page.getByRole("button", { name: /Duration/ }).click();
  await expect(page.getByRole("columnheader", { name: /Duration/ })).toHaveAttribute("aria-sort", "descending");

  // audit: filter + humanized sentence + CSV download
  await page.goto("/audit"); // NOTE: audit needs an admin session — if the suite has no auth fixture, scope this part to the per-project audit card in open mode instead (settings page shows it gated; in OPEN mode members/audit are gated → use the GLOBAL audit only if reachable; otherwise assert the humanized sentence via the project settings audit card IF visible in open mode — VERIFY which surface is reachable open-mode and target that one; the describeAuditEntry rendering is the assertion target).
});
```
This spec needs adapting to reality while implementing (auth-gated audit in open mode): the implementer MUST verify which audit surface renders without a session and assert there; if none does, split the audit assertions into a unit-level rendering test (React Testing Library is not in the stack — then cover via the existing route tests + audit-format unit tests and SKIP the e2e audit leg with a comment). The strip/sort/stats/chart/runs-sort legs are unconditional.

- [ ] **Step 3: docs** — README Highlights: extend the "Trends & comparison" row (status overview, worst-first sort, sortable runs, filterable audit + CSV). User guide: §2 (strip + sort), §5 (stats row, trend chart, compare disclosure), §8 (trend windows), §14 (filters + CSV + humanized log). New `design-system/allure-station/pages/project.md` documenting the page hierarchy (stats row → trend card → tabs → report) and chart conventions (tokens, keyboard pattern). Screenshot refresh stays post-merge (note in PR).

- [ ] **Step 4: Final gates**
```bash
pnpm test && pnpm typecheck
rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e
pnpm --filter @allure-station/e2e test:e2e   # un-wiped re-run (isolation)
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "test(e2e)+docs: triage journey, populated a11y scans, T2 documentation"`

---

## Self-review notes (already applied)

- **Spec coverage:** §1 server → Tasks 1–4 (enriched list+sort, overview, audit filters, runs sort + trends limit); §2 home → Task 5; §3 hierarchy+chart → Tasks 6–7; §4 audit/tables → Task 8; §5 testing/docs → Task 9 + per-task TDD. Audit index check resolved: indexes exist, NO audit migration; the tier's only migration is `duration_ms` (Task 4) with hand-appended backfill per dialect.
- **Known judgment points left to the implementer, explicitly marked:** drizzle raw-SQL array interpolation + `.all()` portability (Task 1 Step 4 — verified against the PG conformance suite), compare-disclosure default-open rule (Task 6 Step 3), audit e2e leg auth reality (Task 9 Step 2).
- **Type consistency:** `ProjectListItem`/`latestRun` shape identical across contracts (T1), client (T5), card (T5); `runSortSchema` values match repo keys (T4) and RunsTable state (T8); `formatDelta` defined T6 before use; `visible()`/`createProjectWithRun` come from the existing e2e helpers module.
