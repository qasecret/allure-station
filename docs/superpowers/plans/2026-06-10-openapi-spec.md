# OpenAPI spec + Swagger UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a live OpenAPI 3.1 document at `/api/openapi.json` plus an interactive Swagger UI at `/api/docs`, generated from the existing Zod contracts, without touching any route handler.

**Architecture:** A new `packages/server/src/openapi/` module builds an OpenAPI document with `@asteasolutions/zod-to-openapi`, referencing the Zod schemas exported by `@allure-station/shared`. A Fastify plugin (`@fastify/swagger` static mode + `@fastify/swagger-ui`) serves the document and UI inside the existing `/api` scope. A drift-guard test walks Fastify's route table and fails if any `/api` route is missing from the document. Handlers, error envelopes, and existing tests are untouched.

**Tech Stack:** TypeScript (ESM), Fastify 4, Zod 3.23.8, `@asteasolutions/zod-to-openapi`, `@fastify/swagger`, `@fastify/swagger-ui`, Vitest.

---

## Background the executor needs

- **Workspace:** pnpm + Turborepo. Server package is `@allure-station/server` at `packages/server`. Run a single test file with:
  `pnpm --filter @allure-station/server test src/openapi/registry.test.ts`
- **Routes are NOT declared with Fastify schemas.** Handlers manually call `schema.safeParse(...)` and return `{ error: string }` on failure. We do **not** change this. The OpenAPI document is built from a hand-written declaration table that references the same Zod schemas.
- **Route registration:** all routes are registered inside one `/api`-prefixed encapsulated scope in `packages/server/src/app.ts` (the `app.register(async (api) => { register*Routes(api, deps); ... }, { prefix: "/api" })` block, currently lines ~71–90).
- **Contracts:** Zod schemas are exported from `@allure-station/shared` (source: `packages/shared/src/contracts.ts`). Import them by name, e.g. `import { projectSchema, createProjectSchema } from "@allure-station/shared"`.
- **Test helper:** `import { buildApp } from "../app.js"` and `import { makeTestDeps } from "../test-helpers.js"`; build an app with `buildApp(await makeTestDeps())` and call it with `app.inject({ method, url })`. Always `await app.close()` at the end. See `packages/server/src/routes/meta.test.ts` for the pattern.
- **ESM import note:** intra-package imports use the `.js` extension on TS files (e.g. `import { buildOpenapiDocument } from "./registry.js"`).

### Complete route inventory (43 routes, all under the `/api` prefix)

The document paths below are written WITH the `/api` prefix because we author the document by hand (the encapsulated scope prefix is not applied to a static document).

| Method | Path (in document) | Tag | Security | Notes |
|---|---|---|---|---|
| GET | /api/version | meta | none | `versionResponse` |
| GET | /api/config | meta | none | `configResponse` |
| POST | /api/projects | projects | bearer, cookie | body `createProjectSchema` → 201 `projectSchema` |
| GET | /api/projects | projects | none | query page; 200 array of `projectSchema`, header `X-Total-Count` |
| GET | /api/projects/{id} | projects | none | 200 `projectSchema` |
| DELETE | /api/projects/{id} | projects | bearer, cookie | 204 |
| PUT | /api/projects/{id}/visibility | projects | cookie | body `setVisibilityRequestSchema` → 200 `projectSchema` |
| POST | /api/projects/{projectId}/send-results | results | bearer, cookie | multipart upload; 202 |
| POST | /api/projects/{projectId}/generate | results | bearer, cookie | 202 `runSchema` |
| POST | /api/projects/{projectId}/runs/{runId}/retry | results | bearer, cookie | 202 `runSchema` |
| GET | /api/projects/{projectId}/trends | runs | none | 200 array of `trendPointSchema` |
| GET | /api/projects/{projectId}/runs | runs | none | query page; 200 array of `runSchema`, header `X-Total-Count` |
| GET | /api/projects/{projectId}/runs/{runId} | runs | none | 200 `runSchema` |
| GET | /api/projects/{projectId}/runs/{runId}/report/{wildcard} | runs | none | non-JSON: serves report assets (text/html, binary) |
| GET | /api/projects/{projectId}/compare | compare | none | query `from`,`to`; 200 `compareResultSchema` |
| GET | /api/projects/{projectId}/events | events | none | non-JSON: `text/event-stream` (SSE) |
| GET | /api/projects/{projectId}/badge.svg | badge | none | non-JSON: `image/svg+xml` |
| GET | /api/projects/{projectId}/quality-gate | quality-gate | none | 200 `qualityGateConfigSchema` |
| PUT | /api/projects/{projectId}/quality-gate | quality-gate | bearer, cookie | body `qualityGateConfigSchema` → 200 `qualityGateConfigSchema` |
| GET | /api/projects/{projectId}/runs/{runId}/summary | quality-gate | none | 200 `runSummarySchema` |
| GET | /api/projects/{projectId}/tests/history | test-history | none | query; 200 `testHistorySchema` |
| GET | /api/projects/{projectId}/tests/history/trace | test-history | none | query; 200 `testTraceSchema` |
| POST | /api/projects/{projectId}/tokens | tokens | cookie | body `createTokenRequestSchema` → 201 `createdTokenSchema` |
| GET | /api/projects/{projectId}/tokens | tokens | cookie | 200 array of `apiTokenSchema` |
| DELETE | /api/projects/{projectId}/tokens/{tokenId} | tokens | cookie | 204 |
| POST | /api/projects/{projectId}/notifications | notifications | cookie | body `createNotificationRequestSchema` → 201 `notificationSchema` |
| GET | /api/projects/{projectId}/notifications | notifications | cookie | 200 array of `notificationSchema` |
| POST | /api/projects/{projectId}/notifications/{notificationId}/test | notifications | cookie | 200 `okResponse` |
| DELETE | /api/projects/{projectId}/notifications/{notificationId} | notifications | cookie | 204 |
| POST | /api/auth/login | auth | none | body `loginRequestSchema` → 200 `sessionUserSchema` |
| POST | /api/auth/logout | auth | cookie | 204 |
| GET | /api/auth/me | auth | cookie | 200 `sessionUserSchema` |
| GET | /api/auth/oidc/login | auth | none | 302 redirect (non-JSON) |
| GET | /api/auth/oidc/callback | auth | none | 302 redirect (non-JSON) |
| POST | /api/users | users | cookie | body `createUserRequestSchema` → 201 `userSchema` |
| GET | /api/users | users | cookie | 200 array of `userSchema` |
| DELETE | /api/users/{id} | users | cookie | 204 |
| GET | /api/projects/{projectId}/members | members | cookie | 200 array of `membershipWithUserSchema` |
| PUT | /api/projects/{projectId}/members | members | cookie | body `setMembershipRequestSchema` → 200 `membershipSchema` |
| DELETE | /api/projects/{projectId}/members/{userId} | members | cookie | 204 |
| GET | /api/audit | audit | cookie | 200 array of `auditEntrySchema`, header `X-Total-Count` |
| GET | /api/projects/{projectId}/audit | audit | cookie | 200 array of `auditEntrySchema`, header `X-Total-Count` |

> If, while implementing, a referenced schema name turns out not to exist in `@allure-station/shared`, open `packages/shared/src/contracts.ts`, find the closest exported schema, and use it. Do not invent local duplicates.

---

## Task 1: Scaffold the OpenAPI module (meta routes only)

**Files:**
- Modify: `packages/server/package.json` (add deps)
- Create: `packages/server/src/openapi/registry.ts`
- Test: `packages/server/src/openapi/registry.test.ts`

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm --filter @allure-station/server add @asteasolutions/zod-to-openapi @fastify/swagger @fastify/swagger-ui
```
Expected: the three packages appear under `dependencies` in `packages/server/package.json` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/openapi/registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildOpenapiDocument } from "./registry.js";

describe("buildOpenapiDocument", () => {
  it("produces a valid OpenAPI 3.1 document", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("9.9.9");
    expect(doc.info.title).toMatch(/allure/i);
  });

  it("documents the meta routes", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    expect(doc.paths?.["/api/version"]?.get).toBeDefined();
    expect(doc.paths?.["/api/config"]?.get).toBeDefined();
  });

  it("declares both security schemes", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    const schemes = doc.components?.securitySchemes ?? {};
    expect(schemes.bearerToken).toBeDefined();
    expect(schemes.sessionCookie).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/server test src/openapi/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js` / `buildOpenapiDocument is not a function`.

- [ ] **Step 4: Write the minimal implementation**

Create `packages/server/src/openapi/registry.ts`:
```ts
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// Reused response/inline schemas not present in the shared contracts.
const errorSchema = z.object({ error: z.string() }).openapi("Error");
const versionResponse = z.object({ version: z.string(), allure: z.string() });
const configResponse = z.object({
  securityEnabled: z.boolean(),
  oidc: z.object({ enabled: z.boolean(), label: z.string().optional() }),
  allure: z.string(),
});

export interface OpenapiOptions {
  version: string;
}

export function buildOpenapiDocument(opts: OpenapiOptions) {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "bearerToken", {
    type: "http",
    scheme: "bearer",
    description: "Per-project CI API token: `Authorization: Bearer <token>`.",
  });
  registry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "session",
    description: "Browser session cookie set by /api/auth/login.",
  });

  registry.registerPath({
    method: "get",
    path: "/api/version",
    tags: ["meta"],
    summary: "Server and embedded Allure versions",
    responses: {
      200: { description: "OK", content: { "application/json": { schema: versionResponse } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/config",
    tags: ["meta"],
    summary: "Public runtime configuration",
    responses: {
      200: { description: "OK", content: { "application/json": { schema: configResponse } } },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Allure Station API",
      version: opts.version,
      description: "Self-hosted multi-project Allure 3 report hub.",
    },
  });
}

// Exported for reuse by route-declaration helpers in later tasks.
export { errorSchema };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/openapi/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/openapi/registry.ts packages/server/src/openapi/registry.test.ts
git commit -m "feat(server): scaffold OpenAPI document builder (meta routes)"
```

---

## Task 2: Serve the document + Swagger UI

**Files:**
- Create: `packages/server/src/openapi/plugin.ts`
- Modify: `packages/server/src/app.ts` (inside the `/api` scope)
- Test: `packages/server/src/openapi/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/openapi/plugin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("openapi plugin", () => {
  it("serves the OpenAPI document at /api/openapi.json", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/version"]).toBeDefined();
    await app.close();
  });

  it("serves the Swagger UI at /api/docs", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    // swagger-ui redirects /docs -> /docs/ (or serves 200 HTML)
    expect([200, 302]).toContain(res.statusCode);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/server test src/openapi/plugin.test.ts`
Expected: FAIL — `/api/openapi.json` returns 404.

- [ ] **Step 3: Write the plugin**

Create `packages/server/src/openapi/plugin.ts`:
```ts
import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { AppDeps } from "../app.js";
import { buildOpenapiDocument } from "./registry.js";

// Registers Swagger UI + the raw document route. Call INSIDE the /api scope so the
// UI lands at /api/docs and the document at /api/openapi.json. The document itself
// is built statically from the Zod contracts (handlers carry no Fastify schemas).
export async function registerOpenapi(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const document = buildOpenapiDocument({ version: deps.version });

  await app.register(fastifySwagger, {
    mode: "static",
    specification: { document: document as Record<string, unknown> },
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", async () => document);
}
```

- [ ] **Step 4: Wire it into app.ts**

In `packages/server/src/app.ts`, add the import near the other route imports (after line 34):
```ts
import { registerOpenapi } from "./openapi/plugin.js";
```
Then, inside the `app.register(async (api) => { ... }, { prefix: "/api" })` block, make the callback `async` (it already is) and add as the FIRST line of the callback body, before `registerMetaRoutes(api, deps);`:
```ts
      await registerOpenapi(api, deps);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/openapi/plugin.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full server suite to confirm no regressions**

Run: `pnpm --filter @allure-station/server test`
Expected: all tests PASS (existing route/meta tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/openapi/plugin.ts packages/server/src/openapi/plugin.test.ts packages/server/src/app.ts
git commit -m "feat(server): serve OpenAPI document and Swagger UI under /api"
```

---

## Task 3: Add the route-declaration helper and the drift-guard test

This task adds the drift test FIRST (it will fail, listing undocumented routes), then Task 4 fills the table until it passes.

**Files:**
- Modify: `packages/server/src/openapi/registry.ts` (add a `route()` helper + export the route-path list)
- Create: `packages/server/src/openapi/drift.test.ts`

- [ ] **Step 1: Add a declaration helper to registry.ts**

In `packages/server/src/openapi/registry.ts`, add this helper function above `buildOpenapiDocument` (it centralizes the repetitive error responses):
```ts
import type { ZodTypeAny } from "zod";

type Method = "get" | "post" | "put" | "delete";
interface RouteDecl {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  security?: Array<"bearerToken" | "sessionCookie">;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  ok?: { status: number; schema?: ZodTypeAny; contentType?: string };
}

function declare(registry: OpenAPIRegistry, r: RouteDecl) {
  const okStatus = r.ok?.status ?? 200;
  const contentType = r.ok?.contentType ?? "application/json";
  const okContent = r.ok?.schema
    ? { content: { [contentType]: { schema: r.ok.schema } } }
    : {};
  registry.registerPath({
    method: r.method,
    path: r.path,
    tags: [r.tag],
    summary: r.summary,
    ...(r.security ? { security: r.security.map((s) => ({ [s]: [] })) } : {}),
    request: {
      ...(r.body ? { body: { content: { "application/json": { schema: r.body } } } } : {}),
      ...(r.query ? { query: r.query } : {}),
    },
    responses: {
      [okStatus]: { description: "Success", ...okContent },
      400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
}
```

Also export the set of documented paths for the drift test. At the end of `buildOpenapiDocument`, the returned `document.paths` already lists them, so no extra export is needed — the drift test reads `buildOpenapiDocument(...).paths`.

- [ ] **Step 2: Write the drift-guard test**

Create `packages/server/src/openapi/drift.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { buildOpenapiDocument } from "./registry.js";

// Normalize a Fastify route URL (":param", "*") to OpenAPI form ("{param}", "{wildcard}").
function toOpenapiPath(url: string): string {
  return url
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/\*$/, "/{wildcard}")
    .replace(/\*/g, "{wildcard}");
}

// Routes that are not part of the documented surface (infra/UI added by plugins).
const IGNORED = new Set<string>([
  "GET /api/openapi.json",
  "GET /api/docs",
  "GET /api/docs/",
  "GET /api/docs/*",
  "GET /api/docs/json",
  "GET /api/docs/yaml",
  "GET /api/docs/static/*",
]);

describe("openapi drift guard", () => {
  it("documents every /api route", async () => {
    const collected: Array<{ method: string; url: string }> = [];
    const app = buildApp(await makeTestDeps());
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const m of methods) collected.push({ method: m, url: route.url });
    });
    await app.ready();

    const doc = buildOpenapiDocument({ version: "test" });
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const method of Object.keys(item as object)) {
        documented.add(`${method.toUpperCase()} ${path}`);
      }
    }

    const missing = collected
      .filter((r) => r.url.startsWith("/api"))
      .filter((r) => ["GET", "POST", "PUT", "DELETE"].includes(r.method))
      .map((r) => `${r.method} ${toOpenapiPath(r.url)}`)
      .filter((key) => !IGNORED.has(key))
      .filter((key) => !documented.has(key));

    await app.close();
    expect(missing, `undocumented routes:\n${missing.join("\n")}`).toEqual([]);
  });
});
```

> Note: the `onRoute` hook must be added before `app.ready()`. Because routes are registered synchronously during `buildApp`, also collect already-registered routes if the hook misses them — if the test reports zero collected routes, switch to iterating `app.printRoutes({ commonPrefix: false })` output instead. Verify in Step 3 which path is needed.

- [ ] **Step 3: Run the drift test to verify it fails with the expected list**

Run: `pnpm --filter @allure-station/server test src/openapi/drift.test.ts`
Expected: FAIL — the assertion message lists ~41 undocumented routes (everything except `/api/version` and `/api/config`). Confirm the list looks like real routes (e.g. `POST /api/projects`, `GET /api/projects/{id}`). If the collected list is empty, apply the fallback noted in Step 2.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/openapi/registry.ts packages/server/src/openapi/drift.test.ts
git commit -m "test(server): add OpenAPI drift guard and declaration helper"
```

---

## Task 4: Declare all remaining routes

Fill the declaration table so the drift test passes. Do this in two commits (JSON routes, then non-JSON routes) to keep changes reviewable.

**Files:**
- Modify: `packages/server/src/openapi/registry.ts`

- [ ] **Step 1: Add the JSON-route declarations**

In `buildOpenapiDocument`, after the two `registry.registerPath(...)` meta calls and before `const generator = ...`, add the following block. Import the schemas at the top of the file:
```ts
import {
  projectSchema,
  createProjectSchema,
  setVisibilityRequestSchema,
  runSchema,
  trendPointSchema,
  compareResultSchema,
  qualityGateConfigSchema,
  runSummarySchema,
  testHistorySchema,
  testTraceSchema,
  apiTokenSchema,
  createdTokenSchema,
  createTokenRequestSchema,
  notificationSchema,
  createNotificationRequestSchema,
  loginRequestSchema,
  sessionUserSchema,
  userSchema,
  createUserRequestSchema,
  membershipSchema,
  membershipWithUserSchema,
  setMembershipRequestSchema,
  auditEntrySchema,
} from "@allure-station/shared";
```

Then the declarations:
```ts
  const okResponse = z.object({ ok: z.boolean() });
  const B: Array<"bearerToken" | "sessionCookie"> = ["bearerToken", "sessionCookie"];
  const C: Array<"bearerToken" | "sessionCookie"> = ["sessionCookie"];

  // projects
  declare(registry, { method: "post", path: "/api/projects", tag: "projects", summary: "Create a project", security: B, body: createProjectSchema, ok: { status: 201, schema: projectSchema } });
  declare(registry, { method: "get", path: "/api/projects", tag: "projects", summary: "List projects", ok: { status: 200, schema: z.array(projectSchema) } });
  declare(registry, { method: "get", path: "/api/projects/{id}", tag: "projects", summary: "Get a project", ok: { status: 200, schema: projectSchema } });
  declare(registry, { method: "delete", path: "/api/projects/{id}", tag: "projects", summary: "Delete a project", security: B, ok: { status: 204 } });
  declare(registry, { method: "put", path: "/api/projects/{id}/visibility", tag: "projects", summary: "Set project visibility", security: C, body: setVisibilityRequestSchema, ok: { status: 200, schema: projectSchema } });

  // results
  declare(registry, { method: "post", path: "/api/projects/{projectId}/send-results", tag: "results", summary: "Upload raw Allure results (multipart)", security: B, ok: { status: 202, schema: okResponse } });
  declare(registry, { method: "post", path: "/api/projects/{projectId}/generate", tag: "results", summary: "Enqueue report generation", security: B, ok: { status: 202, schema: runSchema } });
  declare(registry, { method: "post", path: "/api/projects/{projectId}/runs/{runId}/retry", tag: "results", summary: "Retry a failed run", security: B, ok: { status: 202, schema: runSchema } });

  // runs
  declare(registry, { method: "get", path: "/api/projects/{projectId}/trends", tag: "runs", summary: "Run trend points", ok: { status: 200, schema: z.array(trendPointSchema) } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/runs", tag: "runs", summary: "List runs", ok: { status: 200, schema: z.array(runSchema) } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/runs/{runId}", tag: "runs", summary: "Get a run", ok: { status: 200, schema: runSchema } });

  // compare
  declare(registry, { method: "get", path: "/api/projects/{projectId}/compare", tag: "compare", summary: "Compare two runs", ok: { status: 200, schema: compareResultSchema } });

  // quality-gate
  declare(registry, { method: "get", path: "/api/projects/{projectId}/quality-gate", tag: "quality-gate", summary: "Get quality gate config", ok: { status: 200, schema: qualityGateConfigSchema } });
  declare(registry, { method: "put", path: "/api/projects/{projectId}/quality-gate", tag: "quality-gate", summary: "Set quality gate config", security: B, body: qualityGateConfigSchema, ok: { status: 200, schema: qualityGateConfigSchema } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/runs/{runId}/summary", tag: "quality-gate", summary: "Run quality-gate summary", ok: { status: 200, schema: runSummarySchema } });

  // test-history
  declare(registry, { method: "get", path: "/api/projects/{projectId}/tests/history", tag: "test-history", summary: "Per-test history", ok: { status: 200, schema: testHistorySchema } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/tests/history/trace", tag: "test-history", summary: "Per-test trace", ok: { status: 200, schema: testTraceSchema } });

  // tokens
  declare(registry, { method: "post", path: "/api/projects/{projectId}/tokens", tag: "tokens", summary: "Create API token", security: C, body: createTokenRequestSchema, ok: { status: 201, schema: createdTokenSchema } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/tokens", tag: "tokens", summary: "List API tokens", security: C, ok: { status: 200, schema: z.array(apiTokenSchema) } });
  declare(registry, { method: "delete", path: "/api/projects/{projectId}/tokens/{tokenId}", tag: "tokens", summary: "Revoke an API token", security: C, ok: { status: 204 } });

  // notifications
  declare(registry, { method: "post", path: "/api/projects/{projectId}/notifications", tag: "notifications", summary: "Create a notification", security: C, body: createNotificationRequestSchema, ok: { status: 201, schema: notificationSchema } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/notifications", tag: "notifications", summary: "List notifications", security: C, ok: { status: 200, schema: z.array(notificationSchema) } });
  declare(registry, { method: "post", path: "/api/projects/{projectId}/notifications/{notificationId}/test", tag: "notifications", summary: "Send a test notification", security: C, ok: { status: 200, schema: okResponse } });
  declare(registry, { method: "delete", path: "/api/projects/{projectId}/notifications/{notificationId}", tag: "notifications", summary: "Delete a notification", security: C, ok: { status: 204 } });

  // auth
  declare(registry, { method: "post", path: "/api/auth/login", tag: "auth", summary: "Password login", body: loginRequestSchema, ok: { status: 200, schema: sessionUserSchema } });
  declare(registry, { method: "post", path: "/api/auth/logout", tag: "auth", summary: "Log out", security: C, ok: { status: 204 } });
  declare(registry, { method: "get", path: "/api/auth/me", tag: "auth", summary: "Current session user", security: C, ok: { status: 200, schema: sessionUserSchema } });

  // users
  declare(registry, { method: "post", path: "/api/users", tag: "users", summary: "Create a user", security: C, body: createUserRequestSchema, ok: { status: 201, schema: userSchema } });
  declare(registry, { method: "get", path: "/api/users", tag: "users", summary: "List users", security: C, ok: { status: 200, schema: z.array(userSchema) } });
  declare(registry, { method: "delete", path: "/api/users/{id}", tag: "users", summary: "Delete a user", security: C, ok: { status: 204 } });

  // members
  declare(registry, { method: "get", path: "/api/projects/{projectId}/members", tag: "members", summary: "List project members", security: C, ok: { status: 200, schema: z.array(membershipWithUserSchema) } });
  declare(registry, { method: "put", path: "/api/projects/{projectId}/members", tag: "members", summary: "Set a member role", security: C, body: setMembershipRequestSchema, ok: { status: 200, schema: membershipSchema } });
  declare(registry, { method: "delete", path: "/api/projects/{projectId}/members/{userId}", tag: "members", summary: "Remove a member", security: C, ok: { status: 204 } });

  // audit
  declare(registry, { method: "get", path: "/api/audit", tag: "audit", summary: "Global audit log", security: C, ok: { status: 200, schema: z.array(auditEntrySchema) } });
  declare(registry, { method: "get", path: "/api/projects/{projectId}/audit", tag: "audit", summary: "Project audit log", security: C, ok: { status: 200, schema: z.array(auditEntrySchema) } });
```

- [ ] **Step 2: Run the drift test — non-JSON routes still missing**

Run: `pnpm --filter @allure-station/server test src/openapi/drift.test.ts`
Expected: FAIL — only the non-JSON routes remain in the `missing` list:
```
GET /api/projects/{projectId}/runs/{runId}/report/{wildcard}
GET /api/projects/{projectId}/events
GET /api/projects/{projectId}/badge.svg
GET /api/auth/oidc/login
GET /api/auth/oidc/callback
```
(The two OIDC routes only register when OIDC is configured; if `makeTestDeps()` has no OIDC, they will NOT be collected and thus won't appear as missing. That's fine — document them anyway in Step 3 so the spec is complete.)

- [ ] **Step 3: Commit the JSON declarations**

```bash
git add packages/server/src/openapi/registry.ts
git commit -m "feat(server): document JSON API routes in OpenAPI spec"
```

- [ ] **Step 4: Add the non-JSON route declarations**

In `buildOpenapiDocument`, after the audit declarations, add direct `registry.registerPath` calls for the non-JSON endpoints (they don't fit the `declare()` helper's JSON-error shape cleanly, so declare them explicitly):
```ts
  // Non-JSON endpoints — documented with their real content types.
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/runs/{runId}/report/{wildcard}",
    tags: ["runs"], summary: "Serve a generated report asset",
    responses: {
      200: { description: "Report asset", content: { "text/html": { schema: z.string() } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/events",
    tags: ["events"], summary: "Server-Sent Events stream of run lifecycle events",
    responses: {
      200: { description: "SSE stream", content: { "text/event-stream": { schema: z.string() } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/badge.svg",
    tags: ["badge"], summary: "Status badge for the latest ready run (always 200)",
    responses: {
      200: { description: "SVG badge", content: { "image/svg+xml": { schema: z.string() } } },
    },
  });
  registry.registerPath({
    method: "get", path: "/api/auth/oidc/login",
    tags: ["auth"], summary: "Begin OIDC login (redirects to the provider)",
    responses: { 302: { description: "Redirect to identity provider" } },
  });
  registry.registerPath({
    method: "get", path: "/api/auth/oidc/callback",
    tags: ["auth"], summary: "OIDC callback (redirects back to the app)",
    responses: { 302: { description: "Redirect after auth" } },
  });
```

- [ ] **Step 5: Run the drift test to verify it passes**

Run: `pnpm --filter @allure-station/server test src/openapi/drift.test.ts`
Expected: PASS — `missing` is empty.

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter @allure-station/server test`
Expected: all PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @allure-station/server typecheck`
Expected: no errors. (If a schema name does not exist, fix the import per the note in the inventory section, then re-run.)

- [ ] **Step 8: Commit the non-JSON declarations**

```bash
git add packages/server/src/openapi/registry.ts
git commit -m "feat(server): document non-JSON endpoints (SSE, badge, reports, OIDC)"
```

---

## Task 5: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the endpoints in README**

In `README.md`, find the API reference section (search for an existing endpoint like `/send-results` or an "API" heading) and add a short subsection:
```markdown
### API documentation

A live OpenAPI 3.1 specification is generated from the server's Zod contracts:

- **Interactive docs (Swagger UI):** `GET /api/docs`
- **Raw document:** `GET /api/openapi.json`

The document is built at startup from `@allure-station/shared`; a drift-guard test
(`packages/server/src/openapi/drift.test.ts`) fails CI if a route is added without a
spec entry.
```

- [ ] **Step 2: Run the full workspace verification**

Run:
```bash
pnpm --filter @allure-station/server test && pnpm --filter @allure-station/server typecheck
```
Expected: all tests PASS, typecheck clean.

- [ ] **Step 3: Manual smoke check (optional but recommended)**

Run the server and curl the document:
```bash
pnpm --filter @allure-station/server dev &
sleep 3
curl -s http://localhost:5050/api/openapi.json | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5050/api/docs
kill %1
```
Expected: JSON beginning with `{"openapi":"3.1.0"...`, and a 200/302 for `/api/docs`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the OpenAPI spec and Swagger UI endpoints"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** registry builder (Task 1), live serving + UI (Task 2), drift guard (Task 3), full route coverage incl. non-JSON content types (Task 4), README + verification (Task 5) — all spec sections covered.
- **Security schemes:** `bearerToken` + `sessionCookie` declared in Task 1, applied per-route in Task 4.
- **Drift guard caveat:** OIDC routes register conditionally; they are documented unconditionally so the spec is complete and the test stays green whether or not OIDC is configured in test deps.
- **No handler changes:** confirm `git diff --stat` after Task 4 shows only files under `src/openapi/`, `app.ts`, `package.json`, `pnpm-lock.yaml` — never a `routes/*.ts` handler.
