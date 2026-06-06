# Phase 3b — Search / filter / pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Server-side project search + pagination (replacing the client-side filter that loads every project), and a server-side run status-filter + pagination capability.

**Architecture:** Existing list endpoints keep returning a JSON array (so SSE cache updates, `/compare`, and existing tests are unaffected) and gain **opt-in** `?q=`/`?status=`/`?limit=`/`?offset=` query params plus an **`X-Total-Count`** response header. Repos gain matching `list/count` methods. The Projects page consumes search + pagination; the runs filter ships as a tested API capability.

**Tech Stack:** drizzle (sqlite + pg), Fastify, react-query.

## Design decisions
- **Non-breaking**: array responses unchanged; total exposed via `X-Total-Count` header. No params → current behavior (all rows).
- **LIKE search** escapes `%`/`_`/`\` and uses `ESCAPE '\'` (works on sqlite + pg).
- **limit/offset** validated as non-negative ints; limit capped at 200.
- Runs **dropdown** stays on the full SSE-driven `Run[]` cache (pagination/filter there fights live updates); server-side run filter/pagination is API+repo+tests only this slice.

---

### Task 1: repo search/filter/pagination + counts

**Files:** Modify `packages/server/src/db/repositories.ts`; Test `repositories.test.ts`

- [ ] **Step 1:** Add imports: `import { and, asc, desc, eq, inArray, isNull, like, lt, or, sql, count } from "drizzle-orm";` (add `like`, `sql`, `count`).

- [ ] **Step 2:** A LIKE-contains helper (module-scope in repositories.ts):

```ts
// Build a case-sensitive substring LIKE with wildcards escaped, so user input like "a_b" matches
// literally rather than treating _ as a wildcard. Works on sqlite + pg via ESCAPE.
function likeContains(column: AnySQLiteColumn, q: string) {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}
```

Import the column type: `import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";` (the pg path uses the same objects at runtime — consistent with the existing single-schema-import approach).

- [ ] **Step 3:** `ProjectRepository.list` gains options + `count`:

```ts
async list(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<Project[]> {
  const where = opts.q ? likeContains(projects.id, opts.q) : undefined;
  let query = this.db.select().from(projects).where(where).orderBy(projects.id).$dynamic();
  if (opts.limit !== undefined) query = query.limit(opts.limit);
  if (opts.offset !== undefined) query = query.offset(opts.offset);
  const rows = await query;
  return Promise.all(rows.map((r) => this.#withLatest(r.id, r.createdAt)));
}

async count(opts: { q?: string } = {}): Promise<number> {
  const where = opts.q ? likeContains(projects.id, opts.q) : undefined;
  const [row] = await this.db.select({ c: count() }).from(projects).where(where);
  return Number(row?.c ?? 0);
}
```

(`.$dynamic()` lets us conditionally chain limit/offset — confirm drizzle 0.36 supports it; if not, branch with explicit queries.)

- [ ] **Step 4:** `RunRepository`: extend `#selectRuns` with `status?` + `offset?`, and add public methods. Update `#selectRuns` signature/body:

```ts
async #selectRuns(opts: { projectId: string; readyOnly?: boolean; status?: RunStatus; order: "asc" | "desc"; limit?: number; offset?: number }): Promise<Run[]> {
  const conds = [eq(runs.projectId, opts.projectId)];
  if (opts.readyOnly) conds.push(eq(runs.status, "ready"));
  if (opts.status) conds.push(eq(runs.status, opts.status));
  const ord = opts.order === "asc" ? [asc(runs.createdAt), asc(runs.id)] : [desc(runs.createdAt), desc(runs.id)];
  let q = this.db.select().from(runs).where(and(...conds)).orderBy(...ord).$dynamic();
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  if (opts.offset !== undefined) q = q.offset(opts.offset);
  return (await q).map(this.#toRun);
}

async listByProject(projectId: string, opts: { status?: RunStatus; limit?: number; offset?: number } = {}): Promise<Run[]> {
  return this.#selectRuns({ projectId, order: "desc", ...opts });
}

async countByProject(projectId: string, opts: { status?: RunStatus } = {}): Promise<number> {
  const conds = [eq(runs.projectId, projectId)];
  if (opts.status) conds.push(eq(runs.status, opts.status));
  const [row] = await this.db.select({ c: count() }).from(runs).where(and(...conds));
  return Number(row?.c ?? 0);
}
```

(Keep `listReadyByProject` working — it calls `#selectRuns` with `readyOnly`; ensure the new optional fields default cleanly.)

- [ ] **Step 5:** Tests in `repositories.test.ts` (both backends via the harness): project `list({q})` substring match (and that `_` is escaped — create ids `a_b` and `axb`, search `a_b`, expect only `a_b`); `list({limit,offset})` windowing + `count({q})`; run `listByProject(p,{status})` filters; `countByProject`. 

- [ ] **Step 6:** typecheck + `test repositories`; commit `feat(db): search/filter/pagination + counts on repositories`.

---

### Task 2: route query params + X-Total-Count

**Files:** Modify `packages/server/src/routes/projects.ts`, `routes/runs.ts`; create `packages/server/src/routes/pagination.ts`; tests.

- [ ] **Step 1:** Shared param parser `routes/pagination.ts`:

```ts
export interface PageParams { limit?: number; offset?: number; }
/** Parse + validate ?limit/?offset. Throws a message string on invalid input. */
export function parsePage(query: Record<string, unknown>): PageParams {
  const out: PageParams = {};
  for (const key of ["limit", "offset"] as const) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`);
    out[key] = key === "limit" ? Math.min(n, 200) : n;
  }
  return out;
}
```

- [ ] **Step 2:** `GET /projects` uses q + page + header:

```ts
app.get("/projects", async (req, reply) => {
  const { q } = req.query as { q?: string };
  let page;
  try { page = parsePage(req.query as Record<string, unknown>); }
  catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  const [items, total] = await Promise.all([
    deps.projects.list({ q, ...page }),
    deps.projects.count({ q }),
  ]);
  reply.header("X-Total-Count", String(total));
  return items;
});
```

- [ ] **Step 3:** `GET /projects/:projectId/runs` uses status + page + header. Validate `status` against `runStatusSchema` (import from shared); 400 on invalid.

```ts
app.get("/projects/:projectId/runs", async (req, reply) => {
  const { projectId } = req.params as { projectId: string };
  const { status } = req.query as { status?: string };
  if (status !== undefined && !runStatusSchema.safeParse(status).success) {
    return reply.code(400).send({ error: `invalid status "${status}"` });
  }
  let page;
  try { page = parsePage(req.query as Record<string, unknown>); }
  catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  const typedStatus = status as RunStatus | undefined;
  const [items, total] = await Promise.all([
    deps.runs.listByProject(projectId, { status: typedStatus, ...page }),
    deps.runs.countByProject(projectId, { status: typedStatus }),
  ]);
  reply.header("X-Total-Count", String(total));
  return items;
});
```

- [ ] **Step 4:** Tests (`routes/projects.test.ts`, `routes/runs.test.ts`): seed >N projects/runs; assert `?q=` filters + `X-Total-Count`; `?limit=&offset=` windows; `?status=` filters; invalid `limit`/`status` → 400; no-params → all (backward compat) with correct header.

- [ ] **Step 5:** typecheck + tests; commit `feat(api): search/filter/pagination query params + X-Total-Count`.

---

### Task 3: client + Projects UI

**Files:** Modify `packages/web/src/api/client.ts`, `pages/Projects.tsx`, `api/client.test.ts`

- [ ] **Step 1:** Client: a header-aware list fetch + new signatures.

```ts
// listProjects returns items + total (from X-Total-Count) for pagination UIs.
listProjects(opts?: { q?: string; limit?: number; offset?: number }): Promise<{ items: Project[]; total: number }>;
listRuns(projectId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<Run[]>;
```

Implementation — add a helper that surfaces the header:

```ts
async function listWithTotal<T>(path: string): Promise<{ items: T[]; total: number }> {
  const res = await f(`${base}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const items = (await res.json()) as T[];
  const total = Number(res.headers.get("X-Total-Count") ?? items.length);
  return { items, total };
}
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
// in returned object:
listProjects: (opts = {}) => listWithTotal<Project>(`/projects${qs(opts)}`),
listRuns: (projectId, opts = {}) => json<Run[]>(`/projects/${projectId}/runs${qs(opts)}`, { method: "GET" }),
```

- [ ] **Step 2:** `Projects.tsx`: server-side search (debounced `q`) + pagination. Replace the client-side `data.filter`. State: `q`, `page` (0-based), `PAGE_SIZE = 20`. Query key `["projects", q, page]`, `queryFn: () => api.listProjects({ q, limit: PAGE_SIZE, offset: page * PAGE_SIZE })`. Render `data.items`; Prev/Next buttons disabled at bounds using `data.total`. Reset `page` to 0 when `q` changes. The create-project `onSuccess` invalidates `["projects"]` (prefix) — keep working.

- [ ] **Step 3:** `client.test.ts`: assert `listProjects({ q, limit, offset })` requests `/projects?q=…&limit=…&offset=…` and returns `{ items, total }` from a mocked `X-Total-Count` header; assert `listRuns(p, { status })` hits `/projects/p/runs?status=…`.

- [ ] **Step 4:** typecheck + web test; commit `feat(web): server-side project search + pagination`.

---

### Task 4: README

- [ ] Document the query params + `X-Total-Count` on `GET /projects` and `GET /projects/:id/runs`. Commit `docs: list search/filter/pagination`.

---

## Final verification
- [ ] `pnpm -r typecheck` + `pnpm -r test` green; pagination repo tests pass vs `postgres:16` (parallel).
- [ ] Code-review; fix; push.

## Self-review notes
- `listProjects` return type changes to `{items,total}` — only `Projects.tsx` + client test consume it; update both. `listRuns` keeps `Run[]` (SSE/compare unaffected).
- `$dynamic()` must be supported by drizzle 0.36; if a chained `.limit()` type errors, fall back to building the full query per-branch.
- `likeContains` escaping: verify `a_b` vs `axb` in the repo test (the escape's whole point).
- Header name `X-Total-Count` is conventional; the client falls back to `items.length` if absent.
