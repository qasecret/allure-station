# End-User UX Fix Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six end-user fixes from `docs/superpowers/specs/2026-06-10-end-user-ux-fixes-design.md`: project display names, run delete, a runs tab, upload-dialog CI metadata, a trend empty state, and shareable run/test deep links.

**Architecture:** Monorepo (pnpm + Turborepo). Contracts live in `packages/shared/src/contracts.ts` (zod, single source of truth). Server is Fastify with everything injected through `AppDeps`; routes follow a `register*Routes(app, deps)` pattern with co-located `*.test.ts` using `makeTestDeps()` + `app.inject()`. **Two hand-maintained DB schemas** (`schema.sqlite.ts`, `schema.pg.ts`) must change together, then `db:generate:sqlite` + `db:generate:pg`. Web is React 18 + TanStack Query; API calls go through `packages/web/src/api/client.ts` (`ApiClient` interface + `createClient`). The OpenAPI registry (`packages/server/src/openapi/registry.ts`) must declare every route — `drift.test.ts` fails otherwise.

**Tech Stack:** TypeScript ESM, Fastify 4, Drizzle, zod, React 18, TanStack Query, react-router-dom, vitest, Playwright.

**Verification commands (used throughout):**
```bash
pnpm --filter @allure-station/server test src/routes/<file>.test.ts   # one server test file
pnpm --filter @allure-station/web test                                # web unit tests
pnpm test && pnpm typecheck                                           # full gate before each commit
```

---

### Task 1: Project display name — contracts, schema, repo, API

**Files:**
- Modify: `packages/shared/src/contracts.ts` (createProjectSchema ~line 10, projectSchema ~line 210, auditActionSchema ~line 276)
- Modify: `packages/server/src/db/schema.sqlite.ts` (projects table, ~line 3)
- Modify: `packages/server/src/db/schema.pg.ts` (projects table — same shape, pg column builders)
- Modify: `packages/server/src/db/repositories.ts` (ProjectRepository)
- Modify: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/projects.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `packages/server/src/routes/projects.test.ts`:

```ts
describe("project display name", () => {
  it("creates with a display name, trims it, and returns it on GET", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { id: "named", displayName: "  Demo Web App  " } });
    expect(created.statusCode).toBe(201);
    expect(created.json().displayName).toBe("Demo Web App");
    expect((await app.inject({ method: "GET", url: "/api/projects/named" })).json().displayName).toBe("Demo Web App");
    await app.close();
  });

  it("defaults displayName to null and PATCH updates + clears it (audited)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "GET", url: "/api/projects/p" })).json().displayName).toBeNull();

    const renamed = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "Payments" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().displayName).toBe("Payments");

    // empty string clears back to null
    const cleared = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "" } });
    expect(cleared.json().displayName).toBeNull();

    const audit = await deps.audit.list({ limit: 10 });
    expect(audit.some((e) => e.action === "project_renamed")).toBe(true);
    await app.close();
  });

  it("PATCH 404s unknown project and 400s an over-long name", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    expect((await app.inject({ method: "PATCH", url: "/api/projects/nope", payload: { displayName: "x" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "x".repeat(121) } })).statusCode).toBe(400);
    await app.close();
  });
});
```

If `deps.audit.list` has a different signature in `test-helpers.js` deps, mirror how `audit.test.ts` reads entries — do not invent a new accessor.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @allure-station/server test src/routes/projects.test.ts`
Expected: FAIL (`displayName` undefined / PATCH route 404s with "not found" route).

- [ ] **Step 3: Contracts** — in `packages/shared/src/contracts.ts`:

```ts
// line ~10, replace:
export const createProjectSchema = z.object({ id: projectIdSchema });
// with:
export const displayNameSchema = z.string().trim().min(1).max(120);
export const createProjectSchema = z.object({ id: projectIdSchema, displayName: displayNameSchema.optional() });
// PATCH body: empty string is allowed and means "clear" (normalized to null by the route).
export const updateProjectRequestSchema = z.object({ displayName: z.string().trim().max(120).nullable() });
```

In `projectSchema` (~line 210) add after `id`:

```ts
  displayName: z.string().nullable().default(null),
```

In `auditActionSchema` (~line 281) extend the projects line:

```ts
  "project_created", "project_deleted", "project_renamed",
```

Export the new type at the bottom alongside the others: `export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;`

- [ ] **Step 4: Schemas (BOTH dialects)** — add to the `projects` table in `schema.sqlite.ts`:

```ts
  displayName: text("display_name"),
```

and the equivalent in `schema.pg.ts` (same `text("display_name")` with the pg-core `text` import already used there).

- [ ] **Step 5: Regenerate migrations for both dialects**

```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
git status   # expect one new migration file under each of drizzle/sqlite and drizzle/pg
```

- [ ] **Step 6: Repository** — in `packages/server/src/db/repositories.ts`, `ProjectRepository`:

```ts
  async create(id: string, now: string, displayName: string | null = null): Promise<Project> {
    await this.db.insert(projects).values({ id, createdAt: now, visibility: "public", displayName });
    return { id, displayName, createdAt: now, latestRunId: null, visibility: "public" };
  }

  async setDisplayName(id: string, displayName: string | null): Promise<void> {
    await this.db.update(projects).set({ displayName }).where(eq(projects.id, id));
  }
```

Thread `displayName` through every read path: `#withLatest` (and its callers in `list`/`get`) must carry the row's `displayName` into the returned `Project`. Follow how `visibility` flows — `displayName` rides along identically (`r.displayName ?? null`).

- [ ] **Step 7: Routes** — in `packages/server/src/routes/projects.ts`:

In the POST handler replace the create call:

```ts
    const project = await deps.projects.create(parsed.data.id, deps.now(), parsed.data.displayName ?? null);
```

Add after the visibility route (imports: add `updateProjectRequestSchema` to the shared import):

```ts
  // Rename (presentation-only display name; id is the immutable handle). Maintainer+/token/open.
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.projects.get(id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, id)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = updateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const displayName = parsed.data.displayName || null; // "" → null (clear)
    await deps.projects.setDisplayName(id, displayName);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_renamed", targetType: "project", targetId: id, projectId: id, metadata: { from: existing.displayName, to: displayName } });
    return reply.send(await deps.projects.get(id));
  });
```

- [ ] **Step 8: OpenAPI** — in `registry.ts` import `updateProjectRequestSchema` and add next to the project declarations (~line 100):

```ts
  { method: "patch", path: "/api/projects/{id}", tag: "projects", summary: "Set the project display name", security: WRITE_AUTH, body: updateProjectRequestSchema, ok: { status: 200, schema: projectSchema } },
```

- [ ] **Step 9: Run tests until green**

Run: `pnpm --filter @allure-station/server test src/routes/projects.test.ts src/openapi`
Expected: PASS (including `drift.test.ts`). Then `pnpm test && pnpm typecheck` — fix any `Project` type fallout (places constructing a `Project` literal now need `displayName`).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(server): project display name (column in both dialects, PATCH route, audit)"
```

---

### Task 2: Project display name — web UI

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/components/NewProjectDialog.tsx`
- Modify: `packages/web/src/components/ProjectCard.tsx`
- Modify: `packages/web/src/pages/Project.tsx` (breadcrumb, ~line 110)
- Modify: `packages/web/src/pages/ProjectSettings.tsx`
- Test: `packages/web/src/api/client.test.ts` (append)

- [ ] **Step 1: Failing client test** — append to `client.test.ts`, mirroring its existing fetch-stub style (read the file first and copy its `mkFetch`/assertion helpers; the existing tests show the pattern):

```ts
it("createProject sends displayName and updateProject PATCHes it", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "p", displayName: "Demo", createdAt: "", latestRunId: null, visibility: "public" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const c = createClient("/api", f);
  await c.createProject("p", "Demo");
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ id: "p", displayName: "Demo" });
  await c.updateProject("p", { displayName: null });
  expect(calls[1].init.method).toBe("PATCH");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @allure-station/web test`
Expected: FAIL — `updateProject` is not a function.

- [ ] **Step 3: Client** — in `client.ts`:

Interface:
```ts
  createProject(id: string, displayName?: string): Promise<Project>;
  updateProject(id: string, body: { displayName: string | null }): Promise<Project>;
```
Implementation:
```ts
    createProject: (id, displayName) =>
      json<Project>("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(displayName ? { id, displayName } : { id }) }),
    updateProject: (id, body) =>
      json<Project>(`/projects/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
```

- [ ] **Step 4: NewProjectDialog** — add a second field below the id input (state `const [name, setName] = useState("");`, reset alongside `setId("")`, mutation `api.createProject(id, name.trim() || undefined)`):

```tsx
          <Label htmlFor="np-name">Display name <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo Web App" />
```

- [ ] **Step 5: ProjectCard** — replace the title line:

```tsx
              <span className="truncate font-semibold group-hover:text-primary">{p.displayName ?? p.id}</span>
              {p.displayName && <span className="truncate text-xs text-muted-foreground">{p.id}</span>}
```
(keep the `private` badge after these).

- [ ] **Step 6: Project page breadcrumb** — `Project.tsx` already queries the project (`["project", id]`, currently only `isError` is read, ~line 40). Take `data: project` from that query and change the breadcrumb span (~line 110) to `{project?.displayName ?? id}`.

- [ ] **Step 7: Settings card** — in `ProjectSettings.tsx`, add a self-contained card component and render it as the **first** settings card (above Visibility — read the file to match the existing Card/section markup and the mutation/toast conventions used by the quality-gate card):

```tsx
function ProjectNameCard({ projectId, current }: { projectId: string; current: string | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState(current ?? "");
  useEffect(() => setName(current ?? ""), [current]);
  const save = useMutation({
    mutationFn: () => api.updateProject(projectId, { displayName: name.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project name saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section /* match the wrapper markup of the existing settings cards */>
      <h2>Project name</h2>
      <div className="flex gap-2">
        <Input aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder={projectId} />
        <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      <p className="text-sm text-muted-foreground">Shown instead of the id. Leave blank to clear. The id <code>{projectId}</code> never changes.</p>
    </section>
  );
}
```
The `section`/heading wrapper above is intent, not literal markup — copy the exact card structure used by the neighboring settings cards so the page stays visually consistent.

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm typecheck`
Expected: PASS.

```bash
git add -A && git commit -m "feat(web): show and edit project display names"
```

---

### Task 3: Run delete — contract event flag, repo, route

**Files:**
- Modify: `packages/shared/src/contracts.ts` (runEvent schema, auditActionSchema)
- Modify: `packages/server/src/db/repositories.ts` (RunRepository)
- Modify: `packages/server/src/routes/runs.ts`
- Modify: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/routes/runs.test.ts` (append)

- [ ] **Step 1: Failing tests** — append to `runs.test.ts`:

```ts
describe("DELETE run", () => {
  it("hard-deletes a run: row gone, storage prefix removed, audited", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");
    await deps.storage.putBuffer("p/runs/r1/results/x-result.json", Buffer.from("{}"));

    const res = await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(res.statusCode).toBe(204);
    expect(await deps.runs.get("r1")).toBeNull();
    expect(await deps.storage.exists("p/runs/r1")).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/runs/r1" })).statusCode).toBe(404);
    await app.close();
  });

  it("409s while generating, 404s cross-project (IDOR) and unknown ids", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "other" } });
    await deps.runs.create("p", "busy", "R", "2026-06-10T00:00:01.000Z");
    await deps.runs.claimPending("busy", "2026-06-10T00:00:02.000Z"); // now 'generating'

    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/runs/busy" })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/other/runs/busy" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/p/runs/nope" })).statusCode).toBe(404);
    await app.close();
  });

  it("publishes a deleted run event", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await deps.runs.create("p", "r1", "R", "2026-06-10T00:00:01.000Z");
    const events: unknown[] = [];
    const unsub = deps.bus.subscribe("p", (e) => events.push(e));
    await app.inject({ method: "DELETE", url: "/api/projects/p/runs/r1" });
    expect(events.some((e) => (e as { deleted?: boolean }).deleted === true)).toBe(true);
    unsub();
    await app.close();
  });
});
```

Check `events/bus.ts` for the exact `subscribe` signature before running; mirror how `events.test.ts` subscribes if it differs.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @allure-station/server test src/routes/runs.test.ts`
Expected: FAIL — route not found (404 ≠ 204) on the happy path.

- [ ] **Step 3: Contract** — in `contracts.ts`:
- find the run-event schema (search `RunEvent`) and add `deleted: z.boolean().optional(),` to it;
- extend `auditActionSchema` with `"run_deleted",` (place after the project actions).

- [ ] **Step 4: Repository** — add to `RunRepository`:

```ts
  async remove(id: string): Promise<void> {
    await this.db.delete(runs).where(eq(runs.id, id)); // test_results rows cascade
  }
```

- [ ] **Step 5: Route** — in `routes/runs.ts` add imports (`requireProjectWrite` from `../auth.js`, `actorFromPrincipal, recordAudit` from `../audit.js` — and `authenticate` if needed for the audit actor, matching how `results.ts`/`projects.ts` pair auth + audit) and the route:

```ts
  // Hard-delete one run: DB row (test_results cascade) + staged results/report artifacts.
  // maintainer+/token/open-mode — same bar as creating runs.
  app.delete("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    if (run.status === "generating") {
      return reply.code(409).send({ error: "run is generating; wait or let the reconciler fail it first" });
    }
    await deps.runs.remove(runId);
    try {
      await deps.storage.remove(`${projectId}/runs/${runId}`); // best-effort; orphans are reapable later
    } catch {
      req.log?.warn?.({ projectId, runId }, "run artifact cleanup failed");
    }
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "run_deleted", targetType: "run", targetId: runId, projectId, metadata: { status: run.status, stats: run.stats, branch: run.branch, commit: run.commit } });
    deps.bus.publish({ type: "run", projectId, run, deleted: true });
    return reply.code(204).send();
  });
```
Note: `requireProjectWrite(deps, req, projectId)` (results.ts pattern) wraps authenticate+authorize; if it doesn't return the principal needed for `actorFromPrincipal`, call `authenticate(deps, req)` separately as shown (look at how `projects.ts` DELETE pairs them and copy that exact arrangement). Check `targetType` allowed values in the audit contract — if `"run"` isn't in an enum, add it where `targetType` is defined.

- [ ] **Step 6: OpenAPI** — add near the other run declarations:

```ts
  { method: "delete", path: "/api/projects/{projectId}/runs/{runId}", tag: "runs", summary: "Delete a run and its artifacts", security: WRITE_AUTH, ok: { status: 204 } },
```

- [ ] **Step 7: Green + full gate**

Run: `pnpm --filter @allure-station/server test src/routes/runs.test.ts src/openapi && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(server): DELETE /projects/:id/runs/:runId (hard delete, audited, live event)"
```

---

### Task 4: Runs tab on the project page

**Files:**
- Modify: `packages/web/src/lib/quality-gate-verdict.ts` (+ its test)
- Modify: `packages/web/src/api/client.ts`
- Create: `packages/web/src/components/RunsTable.tsx`
- Modify: `packages/web/src/pages/Project.tsx`

- [ ] **Step 1: Failing unit test for the client-side gate verdict** — append to `packages/web/src/lib/quality-gate-verdict.test.ts`:

```ts
import { evaluateGate } from "./quality-gate-verdict";

describe("evaluateGate (client-side, config × stats)", () => {
  const stats = { total: 8, passed: 7, failed: 1, broken: 0, skipped: 0, flaky: 0, durationMs: 65_000 };
  it("returns null when no rule is configured", () => {
    expect(evaluateGate({}, stats)).toBeNull();
  });
  it("fails on maxFailures and minPassRate, listing reasons", () => {
    const v = evaluateGate({ maxFailures: 0, minPassRate: 0.95 }, stats);
    expect(v).toEqual({ passed: false, reasons: ["failures 1 > 0", "pass rate 87.5% < 95%"] });
  });
  it("passes when all configured rules hold", () => {
    expect(evaluateGate({ maxFailures: 1, minTests: 1 }, stats)).toEqual({ passed: true, reasons: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement in `quality-gate-verdict.ts` (keep the existing `failedReasons` export untouched; match its reason phrasing — read it first and reuse its formatting helpers if present):

```ts
import type { QualityGateConfig, RunStats } from "@allure-station/shared";

/** Evaluate a gate config directly against run stats (client-side; mirrors the server's rules). */
export function evaluateGate(cfg: QualityGateConfig, stats: RunStats): { passed: boolean; reasons: string[] } | null {
  const reasons: string[] = [];
  let configured = false;
  const failures = stats.failed + stats.broken;
  if (cfg.maxFailures !== undefined && cfg.maxFailures !== null) {
    configured = true;
    if (failures > cfg.maxFailures) reasons.push(`failures ${failures} > ${cfg.maxFailures}`);
  }
  if (cfg.minTests !== undefined && cfg.minTests !== null) {
    configured = true;
    if (stats.total < cfg.minTests) reasons.push(`tests ${stats.total} < ${cfg.minTests}`);
  }
  if (cfg.minPassRate !== undefined && cfg.minPassRate !== null) {
    configured = true;
    const rate = stats.total ? stats.passed / stats.total : 0;
    if (rate < cfg.minPassRate) reasons.push(`pass rate ${(rate * 100).toFixed(1).replace(/\.0$/, "")}% < ${cfg.minPassRate * 100}%`);
  }
  if (cfg.maxDurationMs !== undefined && cfg.maxDurationMs !== null) {
    configured = true;
    if ((stats.durationMs ?? 0) > cfg.maxDurationMs) reasons.push(`duration ${stats.durationMs}ms > ${cfg.maxDurationMs}ms`);
  }
  return configured ? { passed: reasons.length === 0, reasons } : null;
}
```
Adjust field nullability to the actual `QualityGateConfig` contract (read it in `contracts.ts`) and make the reason strings byte-identical to the server's summary phrasing so the two surfaces agree.

- [ ] **Step 3: Client additions** — `client.ts` interface + impl:

```ts
  listRunsWithTotal(projectId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<{ items: Run[]; total: number }>;
  deleteRun(projectId: string, runId: string): Promise<void>;
```
```ts
    listRunsWithTotal: (projectId, opts = {}) => listWithTotal<Run>(`/projects/${projectId}/runs${qs(opts)}`),
    deleteRun: (projectId, runId) => noContent(`/projects/${projectId}/runs/${runId}`, { method: "DELETE" }),
```

- [ ] **Step 4: Create `RunsTable.tsx`** (complete component):

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Run, RunStatus } from "@allure-station/shared";
import { api } from "@/main";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { relativeTime, formatDurationSec } from "@/lib/format";
import { evaluateGate } from "@/lib/quality-gate-verdict";

const PAGE = 20;
const FILTERS: Array<{ label: string; value?: RunStatus }> = [
  { label: "all" }, { label: "ready", value: "ready" }, { label: "failed", value: "failed" }, { label: "generating", value: "generating" },
];

export function RunsTable({ projectId, canWrite, onOpenRun }: {
  projectId: string;
  canWrite: boolean;                    // hides destructive actions, mirroring settings-access gating
  onOpenRun: (runId: string) => void;   // switches to the Report tab with this run selected
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RunStatus | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<Run | null>(null);

  const { data } = useQuery({
    queryKey: ["runs-page", projectId, status ?? "all", page],
    queryFn: () => api.listRunsWithTotal(projectId, { status, limit: PAGE, offset: page * PAGE }),
  });
  const { data: gate } = useQuery({ queryKey: ["quality-gate", projectId], queryFn: () => api.getQualityGate(projectId) });

  const del = useMutation({
    mutationFn: (runId: string) => api.deleteRun(projectId, runId),
    onSuccess: () => {
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["runs-page", projectId] });
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
      qc.invalidateQueries({ queryKey: ["trends", projectId] });
      toast.success("Run deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const retry = useMutation({
    mutationFn: (runId: string) => api.retryRun(projectId, runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs-page", projectId] }); toast.success("Retrying generation…"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <Button key={f.label} size="sm" variant={status === f.value ? "default" : "outline"}
            onClick={() => { setStatus(f.value); setPage(0); }}>{f.label}</Button>
        ))}
      </div>
      <div className="overflow-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="p-2">Status</th><th className="p-2">Result</th><th className="p-2">Gate</th>
              <th className="p-2">Branch</th><th className="p-2">Env</th><th className="p-2">Duration</th>
              <th className="p-2">Age</th><th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const verdict = gate && r.stats ? evaluateGate(gate, r.stats) : null;
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-2"><StatusBadge status={r.status} /></td>
                  <td className="p-2">{r.stats ? <>{r.stats.passed}/{r.stats.total}{r.stats.failed ? <span className="text-status-fail"> · {r.stats.failed} failed</span> : null}</> : "—"}</td>
                  <td className="p-2" title={verdict?.reasons.join(", ") || undefined}>{verdict === null ? "—" : verdict.passed ? <span className="text-status-pass">✓</span> : <span className="text-status-fail">✗</span>}</td>
                  <td className="p-2">{r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : "—"}</td>
                  <td className="p-2">{r.environment ?? "—"}</td>
                  <td className="p-2">{r.stats?.durationMs ? formatDurationSec(r.stats.durationMs) : "—"}</td>
                  <td className="p-2"><span title={r.createdAt}>{relativeTime(r.createdAt)}</span></td>
                  <td className="p-2 text-right">
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => onOpenRun(r.id)}>Open</Button>
                      {r.status === "failed" && canWrite && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Retry</Button>}
                      {canWrite && <Button size="sm" variant="outline" className="text-status-fail" disabled={r.status === "generating"} onClick={() => setConfirming(r)}>Delete</Button>}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No runs{status ? ` with status ${status}` : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
        <span>{page + 1} / {pages} · {total} run{total === 1 ? "" : "s"}</span>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
      <Dialog open={!!confirming} onOpenChange={(o) => { if (!o) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete run?</DialogTitle>
            <DialogDescription>
              Permanently deletes the {confirming ? relativeTime(confirming.createdAt) : ""} run
              {confirming?.commit ? ` (${confirming.commit.slice(0, 7)})` : ""}, its report, and its history contribution. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button className="bg-status-fail text-white hover:bg-status-fail/90" disabled={del.isPending}
              onClick={() => confirming && del.mutate(confirming.id)}>{del.isPending ? "Deleting…" : "Delete run"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```
Check `StatusBadge`'s prop type and `getQualityGate`'s return shape against the code; align as needed. For `canWrite`, reuse the page's existing access signal (`user` is currently used to gate the settings link in `Project.tsx`; if `lib/settings-access.ts` exposes a more precise helper, use that instead).

- [ ] **Step 5: Wire tabs into `Project.tsx`:**
- Import `Tabs, TabsContent, TabsList, TabsTrigger` from `@/components/ui/tabs` and `RunsTable`.
- Add `const [tab, setTab] = useState<"report" | "runs">("report");` (reset to `"report"` in the existing `[id]`-change effect).
- Wrap the report area (the `{cur?.status === "failed" ? … : …}` block, ~line 161) in:

```tsx
        <Tabs value={tab} onValueChange={(v) => setTab(v as "report" | "runs")} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
          <TabsContent value="report" className="flex min-h-0 flex-1 flex-col">
            {/* existing failed-panel / iframe / empty-state block, unchanged */}
          </TabsContent>
          <TabsContent value="runs" className="flex min-h-0 flex-1 flex-col">
            <RunsTable projectId={id} canWrite={!!user /* refine per settings-access */} onOpenRun={(runId) => { setSelectedRun(runId); setTab("report"); }} />
          </TabsContent>
        </Tabs>
```
- In the SSE subscription handler (~line 60), handle deletion **before** the upsert logic:

```ts
      if (event.deleted) {
        qc.setQueryData<Run[]>(["runs", id], (prev = []) => prev.filter((r) => r.id !== event.run.id));
        qc.invalidateQueries({ queryKey: ["runs-page", id] });
        qc.invalidateQueries({ queryKey: ["trends", id] });
        return;
      }
```
Also invalidate `["runs-page", id]` on terminal statuses next to the existing trends invalidation, so the table reflects live transitions.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm test && pnpm typecheck`
Expected: PASS. Manually smoke if convenient: `pnpm dev`, open a project → Runs tab → filter, open, delete.

```bash
git add -A && git commit -m "feat(web): runs tab with filters, pagination, retry and delete"
```

---

### Task 5: Upload-dialog CI metadata

**Files:**
- Modify: `packages/web/src/api/client.ts` (sendResults)
- Modify: `packages/web/src/components/UploadDialog.tsx`
- Test: `packages/web/src/api/client.test.ts` (append)

- [ ] **Step 1: Failing client test:**

```ts
it("sendResults appends CI metadata fields when provided", async () => {
  let body: FormData | undefined;
  const f = (async (_url: string, init: RequestInit) => {
    body = init.body as FormData;
    return new Response(JSON.stringify({ runId: "r" }), { status: 202, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const c = createClient("/api", f);
  await c.sendResults("p", [new File(["{}"], "a-result.json")], { branch: "main", commit: "abc", environment: "", ciUrl: undefined });
  expect(body!.get("branch")).toBe("main");
  expect(body!.get("commit")).toBe("abc");
  expect(body!.get("environment")).toBeNull(); // empty/undefined fields are not appended
});
```

- [ ] **Step 2: Run to verify failure**, then update `sendResults`:

Interface: `sendResults(projectId: string, files: File[], meta?: { branch?: string; commit?: string; environment?: string; ciUrl?: string }): Promise<{ runId: string }>;`

```ts
    sendResults: (projectId, files, meta = {}) => {
      const fd = new FormData();
      for (const file of files) fd.append("files", file, file.name);
      for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, v);
      return json<{ runId: string }>(`/projects/${projectId}/send-results`, { method: "POST", body: fd });
    },
```

- [ ] **Step 3: UploadDialog** — add collapsed metadata inputs + per-project `localStorage` recall:

```tsx
const META_KEYS = ["branch", "commit", "environment", "ciUrl"] as const;
type Meta = Record<(typeof META_KEYS)[number], string>;
const emptyMeta: Meta = { branch: "", commit: "", environment: "", ciUrl: "" };
const storageKey = (projectId: string) => `upload-meta:${projectId}`;
const loadMeta = (projectId: string): Meta => {
  try { return { ...emptyMeta, ...JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "{}") }; }
  catch { return emptyMeta; }
};
```

Inside the component: `const [meta, setMeta] = useState<Meta>(() => loadMeta(projectId));` — pass `meta` to `api.sendResults(projectId, files, meta)` in the mutation and persist on success: `localStorage.setItem(storageKey(projectId), JSON.stringify(meta));`. Between the file `<Input>` and the footer add:

```tsx
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Add CI context (optional)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {META_KEYS.map((k) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {k === "ciUrl" ? "CI build URL" : k[0].toUpperCase() + k.slice(1)}
                <Input aria-label={k} value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))}
                  placeholder={k === "branch" ? "main" : k === "commit" ? "a1b2c3d" : k === "environment" ? "staging" : "https://ci.example.com/build/42"} />
              </label>
            ))}
          </div>
        </details>
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm typecheck`
Expected: PASS.

```bash
git add -A && git commit -m "feat(web): optional CI metadata fields on the upload dialog"
```

---

### Task 6: Trend card empty state

**Files:**
- Modify: `packages/web/src/pages/Project.tsx` (`TrendBar`, ~line 223)

- [ ] **Step 1: Replace the bare `<span>`** in `TrendBar` with an informative placeholder (the function already receives `points`; no new props needed):

```tsx
  if (points.length < 2) {
    return (
      <div className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="text-base">📈</span>
        <span>
          {points.length === 1
            ? "Trends appear after 2 runs — 1 more to go."
            : "Trends appear after 2 runs. Push results to start the series."}
        </span>
      </div>
    );
  }
```
Use a `lucide-react` icon (e.g. `TrendingUp`, already imported in this file) instead of the emoji if it renders cleaner alongside the card's existing icon — pick one, don't show both.

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm typecheck` — PASS.

```bash
git add -A && git commit -m "fix(web): informative trend-card empty state below 2 runs"
```

---

### Task 7: Shareable deep links (run + test detail)

**Files:**
- Create: `packages/web/src/lib/report-deep-link.ts`
- Create: `packages/web/src/lib/report-deep-link.test.ts`
- Modify: `packages/web/src/pages/Project.tsx`

- [ ] **Step 1: Failing tests for the pure helpers** — `report-deep-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseReportFragment, buildReportFragment, withReportHash } from "./report-deep-link";

describe("report deep-link helpers", () => {
  it("round-trips a report hash through the parent fragment", () => {
    const frag = buildReportFragment("#/testresult/42");
    expect(frag).toBe("#report=%23%2Ftestresult%2F42");
    expect(parseReportFragment(frag)).toBe("#/testresult/42");
  });
  it("parse returns null for absent/foreign fragments", () => {
    expect(parseReportFragment("")).toBeNull();
    expect(parseReportFragment("#other=1")).toBeNull();
  });
  it("withReportHash appends the hash to the iframe src", () => {
    expect(withReportHash("/api/projects/p/runs/r/report/index.html", "#/testresult/42"))
      .toBe("/api/projects/p/runs/r/report/index.html#/testresult/42");
    expect(withReportHash("/api/projects/p/runs/r/report/index.html", null))
      .toBe("/api/projects/p/runs/r/report/index.html");
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `report-deep-link.ts`:

```ts
/** Mirror the embedded Allure report's internal hash into the parent URL fragment and back.
 *  Parent fragment shape: #report=<urlencoded allure hash>. */
export function buildReportFragment(allureHash: string): string {
  return `#report=${encodeURIComponent(allureHash)}`;
}

export function parseReportFragment(fragment: string): string | null {
  const m = /^#report=(.+)$/.exec(fragment);
  return m ? decodeURIComponent(m[1]) : null;
}

export function withReportHash(src: string, allureHash: string | null): string {
  return allureHash ? `${src}${allureHash}` : src;
}
```

- [ ] **Step 3: Run selection → `?run=`** in `Project.tsx`:
- `import { useSearchParams } from "react-router-dom";`
- Replace `const [selectedRun, setSelectedRun] = useState<string | null>(null);` with:

```ts
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRun = searchParams.get("run");
  const setSelectedRun = (runId: string | null) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (runId) next.set("run", runId); else next.delete("run");
      return next;
    }, { replace: true });
  };
```
- Remove `setSelectedRun(null)` from the `[id]`-change effect (a navigation to another project starts with fresh params already; keep the branch-filter reset).
All existing `setSelectedRun(...)` call sites keep working unchanged.

- [ ] **Step 4: Report hash sync** — in `Project.tsx`, give the iframe a ref and add the sync effect (same-origin, so reading the frame's location is allowed):

```tsx
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Capture the initial #report= once; the iframe src restores it, then the poll takes over mirroring.
  const initialReportHash = useRef(parseReportFragment(window.location.hash));
  useEffect(() => {
    const t = setInterval(() => {
      const frame = frameRef.current;
      if (!frame?.contentWindow) return;
      try {
        const inner = frame.contentWindow.location.hash;
        const outer = buildReportFragment(inner);
        if (inner && window.location.hash !== outer) history.replaceState(null, "", outer);
        if (!inner && window.location.hash.startsWith("#report=")) history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch { /* cross-origin or detached frame — ignore */ }
    }, 500);
    return () => clearInterval(t);
  }, [current]);
```
And the iframe (~line 164):

```tsx
              <iframe ref={frameRef} title="report" className="min-h-0 flex-1 rounded-xl border bg-card shadow-sm"
                src={withReportHash(`/api/projects/${id}/runs/${current}/report/index.html`, initialReportHash.current)} />
```
Imports: `parseReportFragment, buildReportFragment, withReportHash` from `@/lib/report-deep-link`; `useRef` from react.

- [ ] **Step 5: Copy-link button** — in the status-chip row (next to `GateBadge`, ~line 147):

```tsx
          {current && (
            <Button variant="ghost" size="sm" className="text-muted-foreground"
              onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); }}>
              Copy link
            </Button>
          )}
```
(`toast` is already imported in this file.)

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm test && pnpm typecheck` — PASS.
Manual smoke: `pnpm dev` → open a test in the report → URL gains `#report=…` → reload restores the test view; switch runs → `?run=` updates.

```bash
git add -A && git commit -m "feat(web): shareable deep links to a run and a test inside the report"
```

---

### Task 8: e2e coverage + docs touch-up

**Files:**
- Create: `packages/e2e/tests/ux-fixes.spec.ts` (mirror the structure of the existing specs in `packages/e2e/tests/` — read one first for the base-URL/fixture conventions)
- Modify: `README.md` (Highlights), `docs/user-guide/README.md` (§4b upload, §5 project page, new runs-tab mention, Appendix D API table: add `PATCH /projects/:id`, `DELETE …/runs/:runId`)

- [ ] **Step 1: e2e spec** — one journey covering all six fixes (adapt selectors to the actual markup; the assertions are the contract):

```ts
import { test, expect } from "@playwright/test";

test("ux fix pack: name, metadata, runs tab, deep link, delete, trend hint", async ({ page }) => {
  await page.goto("/");
  // ① create with display name
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project id").fill("ux-e2e");
  await page.getByLabel(/Display name/).fill("UX E2E");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("UX E2E")).toBeVisible();

  await page.getByText("UX E2E").click();
  // ⑤ trend empty state before any runs
  await expect(page.getByText(/Trends appear after 2 runs/)).toBeVisible();

  // ④ upload with CI context (fixture file: reuse the results fixture the existing e2e specs upload)
  await page.getByRole("button", { name: "Upload & generate" }).click();
  await page.getByText("Add CI context (optional)").click();
  await page.getByLabel("branch").fill("main");
  await page.getByLabel("commit").fill("e2e1234");
  // …set the file input from the existing fixture path, submit, await ready…

  // ③ runs tab lists the run with its metadata
  await page.getByRole("tab", { name: "Runs" }).click();
  await expect(page.getByRole("cell", { name: /main@e2e1234/ })).toBeVisible();

  // ⑥ deep link: select the run, copy link → URL carries ?run=
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/run=/);

  // ② delete the run from the runs tab
  await page.getByRole("tab", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("button", { name: "Delete run" }).click();
  await expect(page.getByText(/No runs/)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e suite** (full stack; see CLAUDE.md):

```bash
rm -rf packages/e2e/.e2e-data   # known test-isolation gap — stale projects break specs
pnpm --filter @allure-station/e2e test:e2e
```
Expected: PASS.

- [ ] **Step 3: Docs** — update `README.md` Highlights (add display names, runs tab, run delete, deep links to the relevant rows) and the user guide sections/API table listed above. Screenshot refresh of `03-project-overview.png` and `11-upload-dialog.png` happens after merge via the same capture flow as the 2026-06-10 refresh — note it in the PR description rather than blocking this task.

- [ ] **Step 4: Final gate + commit**

```bash
pnpm test && pnpm typecheck
git add -A && git commit -m "test(e2e)+docs: cover the UX fix pack end-to-end and document it"
```

---

## Self-review notes (already applied)

- **Spec coverage:** ① Tasks 1–2 · ② Task 3 · ③ Task 4 · ④ Task 5 · ⑤ Task 6 · ⑥ Task 7 · testing/rollout Task 8. The spec's "repoint latestRunId" step is intentionally absent: `latestRunId` is **derived** in `ProjectRepository#withLatest`, not stored — deletion self-heals.
- **Event contract:** run deletion reuses `RunEvent` with an optional `deleted` flag (Task 3 Step 3) and the UI removes instead of upserting (Task 4 Step 5) — without this the existing SSE handler would resurrect deleted runs.
- **Gate column:** computed client-side from config × stats (one extra request total) instead of N per-run summary fetches.
