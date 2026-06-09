# OpenAPI spec + Swagger UI — design

**Date:** 2026-06-10
**Status:** Approved (design); pending implementation plan

## Goal

Expose a machine-readable OpenAPI 3.1 description of the Allure Station HTTP API,
served live from the running server alongside an interactive Swagger UI. The spec
is derived from the existing Zod contracts in `@allure-station/shared` so there is
one source of truth for request/response shapes.

## Context & constraints

- Zod is pinned to `3.23.8` across the workspace — compatible with the standard
  OpenAPI tooling (`@asteasolutions/zod-to-openapi`).
- Routes do **not** use Fastify's native `schema` option. Each handler manually
  calls `schema.safeParse(...)` and returns a deliberate error envelope
  `{ error: string }` (see `packages/server/src/routes/projects.ts`). There is no
  Fastify route schema to harvest, and the route→contract mapping is implicit in
  the handler code.
- Routes are registered via `register*Routes(api, deps)` functions inside a single
  `/api`-prefixed scope in `packages/server/src/app.ts`.
- Error shapes and the co-located `*.test.ts` convention must not be disturbed.

## Approach (chosen)

**Hybrid: a separate spec module + a drift-guard test.**

Rejected alternatives:
- *Full native Fastify+Zod refactor* — would change the error envelope across all
  ~15 route files and break the established convention and tests. Too large/risky
  for the goal.
- *Bare separate module* — fine, but drifts when a route is added without a spec
  entry. The drift-guard test closes that gap at near-zero cost, matching the
  codebase's strong test culture.

## Components

All new code lives under `packages/server/src/openapi/`.

### 1. `openapi/registry.ts` — the declaration table (single source of mapping)

- Builds an `OpenAPIRegistry` (from `@asteasolutions/zod-to-openapi`).
- For each route, declares `{ method, path, tag, summary, security, request, responses }`,
  referencing existing schema exports from `@allure-station/shared`
  (e.g. `createProjectSchema`, `projectIdSchema`, `projectSchema`).
- Declares reusable components once:
  - error body `{ error: string }` for 400/401/404/409,
  - the pagination query params + `X-Total-Count` response header pattern,
  - two security schemes: `bearerToken` (CI `Authorization: Bearer …`) and
    `sessionCookie` (httpOnly session cookie).
- Each route is tagged with the security scheme(s) it accepts, or none for public
  reads.
- Exports `buildOpenapiDocument(opts)` returning the OpenAPI 3.1 document via
  `OpenApiGeneratorV31`. Info block uses `deps.version` where available.

Non-JSON endpoints are documented as endpoints with their real content types
rather than omitted, so the spec is complete:
- `GET /api/projects/:id/events` → `text/event-stream` (SSE),
- the badge route → `image/svg+xml`,
- the report-serving static route → `text/html` / binary.

### 2. `openapi/plugin.ts` — `registerOpenapi(app, deps)`

- Registers `@fastify/swagger` in **static mode** with the document from
  `buildOpenapiDocument`.
- Registers `@fastify/swagger-ui`.
- Mounted inside the existing `/api` scope in `app.ts`:
  - JSON at **`/api/openapi.json`**,
  - interactive UI at **`/api/docs`**.
- Adds nothing to handler code; purely additive wiring.

### 3. `openapi/registry.test.ts` — drift guard

- Builds an app and collects every registered `/api` route via a Fastify
  `onRoute` hook (`{ method, url }`).
- Asserts each collected route appears in the OpenAPI document's `paths`
  (normalizing Fastify `:param` ↔ OpenAPI `{param}`).
- Excludes from deep checks the non-JSON routes (SSE, badge SVG, static report),
  but still requires them to be present as documented endpoints.
- Fails when a new route is added without a corresponding spec entry.

## Data flow

```
@allure-station/shared (Zod contracts)
        │  referenced by
        ▼
openapi/registry.ts  ──buildOpenapiDocument()──►  OpenAPI 3.1 document
        │                                                │
        │ (drift test asserts coverage)                  │ static mode
        ▼                                                ▼
Fastify route table  ◄──onRoute──  registry.test.ts   @fastify/swagger(-ui)
                                                         │
                                                         ▼
                                           GET /api/openapi.json  +  /api/docs
```

## New dependencies (server package only)

- `@asteasolutions/zod-to-openapi`
- `@fastify/swagger`
- `@fastify/swagger-ui`

## Out of scope

- No static committed spec file / client codegen (can be added later from the
  same `buildOpenapiDocument`).
- No refactor of handlers to native Fastify validation.
- No change to error envelopes, auth, or existing route behavior.

## Testing

- `openapi/registry.test.ts` — drift guard (above).
- A focused test that `buildOpenapiDocument()` produces a valid OpenAPI 3.1
  document (has `openapi`, `info`, non-empty `paths`) and that `/api/openapi.json`
  and `/api/docs` respond 200 on a built app.

## Documentation

- Add the `/api/openapi.json` and `/api/docs` endpoints to `README.md`.
- Document the three new dependencies in the server package.
