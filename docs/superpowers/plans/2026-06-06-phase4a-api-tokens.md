# Phase 4a — Scoped API tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Per-project, hashed API tokens that secure the CI write path (`send-results`, `generate`, project delete) — without breaking the zero-config open dev mode.

**Architecture:** A new `api_tokens` table stores `sha256(token)` + a display prefix (never the plaintext). Authorization is **opt-in by token existence**: a write to project P is allowed if P has no tokens (open) OR a valid `Authorization: Bearer <token>` scoped to P is presented. Reads stay open. The first token for a project can be created freely (bootstrap); afterwards token management is itself gated.

**Tech Stack:** node:crypto (randomBytes + sha256), drizzle (sqlite + pg), Fastify, zod.

## Design decisions
- **Token format:** `ast_` + `crypto.randomBytes(24).toString("base64url")` (36 chars). Stored as `sha256` hex; `prefix` = first 12 chars for display. Plaintext returned once at creation.
- **Enforcement:** `authorizeProjectWrite(deps, projectId, authHeader)` → `"ok" | "unauthorized"`. 0 tokens ⇒ ok. Else require a bearer token whose hash maps to a token row for that project.
- **Scope:** gate `POST send-results`, `POST generate`, `DELETE /projects/:id`, and the token-management routes. Reads/list/report/trends/compare/events stay open.
- **Known limitation (documented):** on an open project anyone can create the first token (and thus lock it). Acceptable pre-OIDC; Phase 5 adds ownership/RBAC.
- **lastUsedAt:** updated best-effort (fire-and-forget) on successful auth.

---

### Task 1: shared contracts

**Files:** Modify `packages/shared/src/contracts.ts`

- [ ] Add:

```ts
// API token as shown to clients (never includes the hash or plaintext).
export const apiTokenSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
// Returned ONCE on creation — includes the plaintext token.
export const createdTokenSchema = apiTokenSchema.extend({ token: z.string() });
export const createTokenRequestSchema = z.object({ name: z.string().min(1).max(64) });
```

Type exports: `ApiToken`, `CreatedToken`. Typecheck + commit `feat(shared): API token contracts`.

---

### Task 2: api_tokens schema + migrations

**Files:** `packages/server/src/db/schema.sqlite.ts`, `schema.pg.ts`

- [ ] sqlite:

```ts
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
}, (t) => ({
  byProject: index("idx_api_tokens_project").on(t.projectId),
  byHash: index("idx_api_tokens_hash").on(t.tokenHash),
}));
```

- [ ] pg: analogous `pgTable`. Generate migrations (`db:generate:sqlite` + `:pg`), commit SQL + meta. `feat(db): api_tokens table`.

---

### Task 3: ApiTokenRepository

**Files:** Create `packages/server/src/db/api-tokens-repo.ts`; tests in `repositories.test.ts` (single pg file).

- [ ] Repo:

```ts
import { and, eq } from "drizzle-orm";
import type { ApiToken } from "@allure-station/shared";
import type { Db } from "./client.js";
import { apiTokens } from "./schema.sqlite.js";

export class ApiTokenRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async create(projectId: string, name: string, tokenHash: string, prefix: string, now: string): Promise<ApiToken> {
    const id = this.newId();
    await this.db.insert(apiTokens).values({ id, projectId, name, tokenHash, prefix, createdAt: now, lastUsedAt: null });
    return { id, projectId, name, prefix, createdAt: now, lastUsedAt: null };
  }

  async listByProject(projectId: string): Promise<ApiToken[]> {
    const rows = await this.db.select().from(apiTokens).where(eq(apiTokens.projectId, projectId)).orderBy(apiTokens.createdAt);
    return rows.map((r) => ({ id: r.id, projectId: r.projectId, name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }));
  }

  async countByProject(projectId: string): Promise<number> {
    const [row] = await this.db.select({ c: count() }).from(apiTokens).where(eq(apiTokens.projectId, projectId));
    return Number(row?.c ?? 0);
  }

  /** Resolve a token by its hash (for auth). Returns projectId + id, or null. */
  async findByHash(tokenHash: string): Promise<{ id: string; projectId: string } | null> {
    const [row] = await this.db.select({ id: apiTokens.id, projectId: apiTokens.projectId }).from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  /** Returns true if a token with this id existed under the project (so the route can 404 vs 204). */
  async remove(projectId: string, id: string): Promise<boolean> {
    const deleted = await this.db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.projectId, projectId))).returning();
    return deleted.length > 0;
  }

  async touchLastUsed(id: string, now: string): Promise<void> {
    await this.db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, id));
  }
}
```

(Add `count` to the drizzle import.)

- [ ] Also: `ProjectRepository.remove` must delete `api_tokens` for the project (libsql no-cascade) — add `await this.db.delete(apiTokens)...` alongside the existing test_results/runs deletes (deepest-first; tokens reference project directly so delete before projects).

- [ ] Tests in repositories.test.ts harness (add `tokens` to the BackendHandle + pg TRUNCATE list `api_tokens`): create→listByProject (no hash leaked), countByProject, findByHash (hit + miss), remove (true/false), cascade on project remove. Commit `feat(db): ApiTokenRepository`.

---

### Task 4: auth module

**Files:** Create `packages/server/src/auth.ts`, `auth.test.ts`

```ts
import { createHash, randomBytes } from "node:crypto";
import type { AppDeps } from "./app.js";

export function generateToken(): string {
  return `ast_${randomBytes(24).toString("base64url")}`;
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}
function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/**
 * Opt-in per-project authorization. A project with no tokens is open (dev mode); once it has any
 * token, writes require a valid bearer token scoped to that project.
 */
export async function authorizeProjectWrite(deps: AppDeps, projectId: string, header: string | undefined): Promise<"ok" | "unauthorized"> {
  if ((await deps.tokens.countByProject(projectId)) === 0) return "ok";
  const presented = parseBearer(header);
  if (!presented) return "unauthorized";
  const found = await deps.tokens.findByHash(hashToken(presented));
  if (!found || found.projectId !== projectId) return "unauthorized";
  void deps.tokens.touchLastUsed(found.id, deps.now()).catch(() => {});
  return "ok";
}
```

- [ ] Unit-test `auth.test.ts` with a fake deps (`tokens` stub): open when count 0; unauthorized when count>0 and no/invalid/wrong-project token; ok with a valid token (hash matches). Also test generate/hash/prefix shapes. Commit `feat(auth): token generation + per-project authorization`.

---

### Task 5: token routes + gate writes + deps wiring

**Files:** Create `packages/server/src/routes/tokens.ts`; modify `routes/results.ts`, `routes/projects.ts`, `app.ts`, `deps.ts`, `test-helpers.ts`; tests.

- [ ] **deps:** add `tokens: ApiTokenRepository` to `AppDeps` (app.ts), construct in `buildDeps` (`new ApiTokenRepository(db, () => nanoid(12))`) and test-helpers literal.

- [ ] **tokens.ts** routes (registered under `/api`):

```ts
export function registerTokenRoutes(app, deps) {
  // create — gated (bootstrap allowed when project has no tokens)
  app.post("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (await authorizeProjectWrite(deps, projectId, req.headers.authorization) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const parsed = createTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const token = generateToken();
    const created = await deps.tokens.create(projectId, parsed.data.name, hashToken(token), tokenPrefix(token), deps.now());
    return reply.code(201).send({ ...created, token }); // plaintext shown once
  });

  app.get("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (await authorizeProjectWrite(deps, projectId, req.headers.authorization) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return deps.tokens.listByProject(projectId);
  });

  app.delete("/projects/:projectId/tokens/:tokenId", async (req, reply) => {
    const { projectId, tokenId } = req.params as { projectId: string; tokenId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (await authorizeProjectWrite(deps, projectId, req.headers.authorization) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return (await deps.tokens.remove(projectId, tokenId)) ? reply.code(204).send() : reply.code(404).send({ error: "token not found" });
  });
}
```

- [ ] **Gate write routes:** in `results.ts` (`send-results` and `generate`) and `projects.ts` (`DELETE`), after the existing project-existence (404) check add:

```ts
if (await authorizeProjectWrite(deps, projectId, req.headers.authorization) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
```

- [ ] Register `registerTokenRoutes(api, deps)` in app.ts.

- [ ] **Tests** (`routes/tokens.test.ts`): create token (201, returns plaintext once, prefix matches); list (no hash/plaintext); after a token exists, `send-results`/`generate` without a token → 401, with the valid token → 202, with a wrong/foreign token → 401; an open project (no token) → writes still 202; delete token → 204 then writes open again; token for project A rejected on project B. Also confirm existing results/e2e tests still pass (open projects). Commit `feat(api): token management routes + bearer auth on writes`.

---

### Task 6: README

- [ ] Auth section: the opt-in model, token format, `Authorization: Bearer`, the three endpoints, the bootstrap/lock-out caveat, and a curl example (create token → push with it). Commit `docs: scoped API tokens`.

---

## Final verification
- [ ] `pnpm -r typecheck` + `pnpm -r test` green; repo conformance vs `postgres:16` (api_tokens migration + cascade); e2e still green (open projects).
- [ ] Code-review; fix; push.

## Self-review notes
- `AppDeps` gains `tokens` — update buildDeps + test-helpers (grep to confirm).
- Auth check goes AFTER the 404 project-existence check in each route (consistent ordering).
- `ProjectRepository.remove` now deletes api_tokens too (libsql no-cascade) — add + cover with the cascade test.
- Constant-time compare isn't needed: lookup is by sha256 hash equality in the DB (not a string compare of secrets), and tokens are high-entropy.
- Existing tests/e2e create token-less projects → open → unaffected. The one new behavior gate is "tokens exist ⇒ required".
