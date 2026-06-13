import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodTypeAny } from "zod";
import {
  projectSchema, projectListItemSchema, projectSortSchema, createProjectSchema, setVisibilityRequestSchema, updateProjectRequestSchema,
  runSchema, runSortSchema, sortOrderSchema, trendPointSchema, compareResultSchema,
  qualityGateConfigSchema, runSummarySchema, retentionConfigSchema, retentionResponseSchema,
  testHistorySchema, testTraceSchema,
  apiTokenSchema, createdTokenSchema, createTokenRequestSchema,
  notificationSchema, createNotificationRequestSchema,
  loginRequestSchema, sessionUserSchema, sessionInfoSchema, changePasswordRequestSchema,
  userSchema, createUserRequestSchema,
  membershipSchema, membershipWithUserSchema, setMembershipRequestSchema,
  auditEntrySchema, auditActionSchema,
  overviewSchema,
} from "@allure-station/shared";

type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

extendZodWithOpenApi(z);

// Reused response/inline schemas not present in the shared contracts.
const errorSchema = z.object({ error: z.string() }).openapi("Error");
const okResponse = z.object({ ok: z.boolean() });
// Pagination query shared by list endpoints (handlers parse ?limit/?offset).
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const versionResponse = z.object({ version: z.string(), allure: z.string() });
const configResponse = z.object({
  securityEnabled: z.boolean(),
  oidc: z.object({ enabled: z.boolean(), label: z.string().optional() }),
  allure: z.string(),
  branding: z.object({
    name: z.string(),
    tagline: z.string(),
    logoUrl: z.string().nullable(),
  }),
});

export interface OpenapiOptions {
  version: string;
}

type Method = "get" | "post" | "put" | "delete" | "patch";
interface RouteDecl {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  security?: Array<"bearerToken" | "sessionCookie">;
  // Self-service routes gated only on "is a logged-in user" (the account routes) can never return
  // 403 — every non-user principal is 401. Set this so the spec doesn't advertise an impossible 403.
  selfAuth?: boolean;
  body?: ZodTypeAny;
  query?: z.AnyZodObject;
  ok?: { status: number; schema?: ZodTypeAny; contentType?: string };
}

function declare(registry: OpenAPIRegistry, r: RouteDecl) {
  const okStatus = r.ok?.status ?? 200;
  const contentType = r.ok?.contentType ?? "application/json";
  const okContent = r.ok?.schema
    ? { content: { [contentType]: { schema: r.ok.schema } } }
    : {};
  const pathParamNames = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const paramsSchema = pathParamNames.length
    ? z.object(Object.fromEntries(pathParamNames.map((name) => [name, z.string()])))
    : undefined;
  registry.registerPath({
    method: r.method,
    path: r.path,
    tags: [r.tag],
    summary: r.summary,
    ...(r.security ? { security: r.security.map((s) => ({ [s]: [] })) } : {}),
    request: {
      ...(paramsSchema ? { params: paramsSchema } : {}),
      ...(r.body ? { body: { content: { "application/json": { schema: r.body } } } } : {}),
      ...(r.query ? { query: r.query } : {}),
    },
    responses: {
      [okStatus]: { description: "Success", ...okContent },
      400: { description: "Invalid request", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Unauthenticated — missing or expired session/token", content: { "application/json": { schema: errorSchema } } },
      ...(r.security && !r.selfAuth ? { 403: { description: "Forbidden — authenticated but insufficient role/scope", content: { "application/json": { schema: errorSchema } } } } : {}),
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
}

// CI token OR human session.
const WRITE_AUTH: Array<"bearerToken" | "sessionCookie"> = ["bearerToken", "sessionCookie"];
// Human session only.
const SESSION_ONLY: Array<"bearerToken" | "sessionCookie"> = ["sessionCookie"];

const metaRoutes: RouteDecl[] = [
  { method: "get", path: "/api/version", tag: "meta", summary: "Server and embedded Allure versions", ok: { status: 200, schema: versionResponse } },
  { method: "get", path: "/api/config", tag: "meta", summary: "Public runtime configuration", ok: { status: 200, schema: configResponse } },
  { method: "get", path: "/api/overview", tag: "meta", summary: "Instance triage counts", ok: { status: 200, schema: overviewSchema } },
];

const projectRoutes: RouteDecl[] = [
  { method: "post", path: "/api/projects", tag: "projects", summary: "Create a project", security: WRITE_AUTH, body: createProjectSchema, ok: { status: 201, schema: projectSchema } },
  { method: "get", path: "/api/projects", tag: "projects", summary: "List projects (enriched: each item embeds latestRun + gatePassed)", query: pageQuery.extend({ q: z.string().optional(), sort: projectSortSchema.optional() }), ok: { status: 200, schema: z.array(projectListItemSchema) } },
  { method: "get", path: "/api/projects/{id}", tag: "projects", summary: "Get a project", ok: { status: 200, schema: projectSchema } },
  { method: "delete", path: "/api/projects/{id}", tag: "projects", summary: "Delete a project", security: WRITE_AUTH, ok: { status: 204 } },
  { method: "patch", path: "/api/projects/{id}", tag: "projects", summary: "Set the project display name", security: WRITE_AUTH, body: updateProjectRequestSchema, ok: { status: 200, schema: projectSchema } },
  { method: "put", path: "/api/projects/{id}/visibility", tag: "projects", summary: "Set project visibility", security: SESSION_ONLY, body: setVisibilityRequestSchema, ok: { status: 200, schema: projectSchema } },
];

const resultsRoutes: RouteDecl[] = [
  { method: "post", path: "/api/projects/{projectId}/send-results", tag: "results", summary: "Upload raw Allure results (multipart)", security: WRITE_AUTH, ok: { status: 202, schema: z.object({ runId: z.string(), files: z.number() }) } },
  { method: "post", path: "/api/projects/{projectId}/generate", tag: "results", summary: "Enqueue report generation", security: WRITE_AUTH, query: z.object({ runId: z.string().optional() }), ok: { status: 202, schema: runSchema } },
  { method: "post", path: "/api/projects/{projectId}/runs/{runId}/retry", tag: "results", summary: "Retry a failed run", security: WRITE_AUTH, ok: { status: 202, schema: runSchema } },
];

const runRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/trends", tag: "runs", summary: "Run trend points (up to ?limit runs, 10–100, default 30)", query: z.object({ limit: z.coerce.number().int().min(10).max(100).optional() }), ok: { status: 200, schema: z.array(trendPointSchema) } },
  { method: "get", path: "/api/projects/{projectId}/runs", tag: "runs", summary: "List runs", query: pageQuery.extend({ status: z.string().optional(), branch: z.string().optional(), sort: runSortSchema.optional(), order: sortOrderSchema.optional() }), ok: { status: 200, schema: z.array(runSchema) } },
  { method: "get", path: "/api/projects/{projectId}/runs/{runId}", tag: "runs", summary: "Get a run", ok: { status: 200, schema: runSchema } },
  { method: "delete", path: "/api/projects/{projectId}/runs/{runId}", tag: "runs", summary: "Delete a run and its artifacts", security: WRITE_AUTH, ok: { status: 204 } },
];

const compareRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/compare", tag: "compare", summary: "Compare two runs", query: z.object({ base: z.string().optional(), target: z.string().optional() }), ok: { status: 200, schema: compareResultSchema } },
];

const qualityGateRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/quality-gate", tag: "quality-gate", summary: "Get quality gate config", ok: { status: 200, schema: qualityGateConfigSchema } },
  { method: "put", path: "/api/projects/{projectId}/quality-gate", tag: "quality-gate", summary: "Set quality gate config", security: WRITE_AUTH, body: qualityGateConfigSchema, ok: { status: 200, schema: qualityGateConfigSchema } },
  { method: "get", path: "/api/projects/{projectId}/runs/{runId}/summary", tag: "quality-gate", summary: "Run quality-gate summary", ok: { status: 200, schema: runSummarySchema } },
];

const testHistoryRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/tests/history", tag: "test-history", summary: "Per-test history", query: z.object({ historyId: z.string().optional(), fullName: z.string().optional(), name: z.string().optional(), limit: z.string().optional() }), ok: { status: 200, schema: testHistorySchema } },
  { method: "get", path: "/api/projects/{projectId}/tests/history/trace", tag: "test-history", summary: "Per-test trace", query: z.object({ runId: z.string().optional(), historyId: z.string().optional(), fullName: z.string().optional() }), ok: { status: 200, schema: testTraceSchema } },
];

const tokenRoutes: RouteDecl[] = [
  { method: "post", path: "/api/projects/{projectId}/tokens", tag: "tokens", summary: "Create API token", security: SESSION_ONLY, body: createTokenRequestSchema, ok: { status: 201, schema: createdTokenSchema } },
  { method: "get", path: "/api/projects/{projectId}/tokens", tag: "tokens", summary: "List API tokens", security: SESSION_ONLY, ok: { status: 200, schema: z.array(apiTokenSchema) } },
  { method: "delete", path: "/api/projects/{projectId}/tokens/{tokenId}", tag: "tokens", summary: "Revoke an API token", security: SESSION_ONLY, ok: { status: 204 } },
];

const notificationRoutes: RouteDecl[] = [
  { method: "post", path: "/api/projects/{projectId}/notifications", tag: "notifications", summary: "Create a notification", security: SESSION_ONLY, body: createNotificationRequestSchema, ok: { status: 201, schema: notificationSchema } },
  { method: "get", path: "/api/projects/{projectId}/notifications", tag: "notifications", summary: "List notifications", security: SESSION_ONLY, ok: { status: 200, schema: z.array(notificationSchema) } },
  { method: "post", path: "/api/projects/{projectId}/notifications/{notificationId}/test", tag: "notifications", summary: "Send a test notification", security: SESSION_ONLY, ok: { status: 200, schema: okResponse } },
  { method: "delete", path: "/api/projects/{projectId}/notifications/{notificationId}", tag: "notifications", summary: "Delete a notification", security: SESSION_ONLY, ok: { status: 204 } },
];

const authRoutes: RouteDecl[] = [
  { method: "post", path: "/api/auth/login", tag: "auth", summary: "Password login", body: loginRequestSchema, ok: { status: 200, schema: sessionUserSchema } },
  { method: "post", path: "/api/auth/logout", tag: "auth", summary: "Log out", security: SESSION_ONLY, selfAuth: true, ok: { status: 204 } },
  { method: "get", path: "/api/auth/me", tag: "auth", summary: "Current session user", security: SESSION_ONLY, selfAuth: true, ok: { status: 200, schema: sessionUserSchema } },
  { method: "get", path: "/api/auth/sessions", tag: "auth", summary: "List own sessions with device info and current flag", security: SESSION_ONLY, selfAuth: true, ok: { status: 200, schema: z.array(sessionInfoSchema) } },
  { method: "delete", path: "/api/auth/sessions/{id}", tag: "auth", summary: "Revoke a specific session (own only)", security: SESSION_ONLY, selfAuth: true, ok: { status: 204 } },
  { method: "delete", path: "/api/auth/sessions", tag: "auth", summary: "Revoke all sessions except the current one", security: SESSION_ONLY, selfAuth: true, ok: { status: 200, schema: z.object({ revoked: z.number() }) } },
  { method: "post", path: "/api/auth/password", tag: "auth", summary: "Change password (revokes other sessions)", security: SESSION_ONLY, selfAuth: true, body: changePasswordRequestSchema, ok: { status: 204 } },
];

const userRoutes: RouteDecl[] = [
  { method: "post", path: "/api/users", tag: "users", summary: "Create a user", security: SESSION_ONLY, body: createUserRequestSchema, ok: { status: 201, schema: userSchema } },
  { method: "get", path: "/api/users", tag: "users", summary: "List users", security: SESSION_ONLY, ok: { status: 200, schema: z.array(userSchema) } },
  { method: "delete", path: "/api/users/{id}", tag: "users", summary: "Delete a user", security: SESSION_ONLY, ok: { status: 204 } },
];

const memberRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/members", tag: "members", summary: "List project members", security: SESSION_ONLY, ok: { status: 200, schema: z.array(membershipWithUserSchema) } },
  { method: "put", path: "/api/projects/{projectId}/members", tag: "members", summary: "Set a member role", security: SESSION_ONLY, body: setMembershipRequestSchema, ok: { status: 200, schema: membershipSchema } },
  { method: "delete", path: "/api/projects/{projectId}/members/{userId}", tag: "members", summary: "Remove a member", security: SESSION_ONLY, ok: { status: 204 } },
];

const auditFilterQuery = z.object({
  action: auditActionSchema.optional(),
  actor: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).merge(pageQuery);

const auditRoutes: RouteDecl[] = [
  { method: "get", path: "/api/audit", tag: "audit", summary: "Global audit log", security: SESSION_ONLY, query: auditFilterQuery, ok: { status: 200, schema: z.array(auditEntrySchema) } },
  { method: "get", path: "/api/projects/{projectId}/audit", tag: "audit", summary: "Project audit log", security: SESSION_ONLY, query: auditFilterQuery, ok: { status: 200, schema: z.array(auditEntrySchema) } },
];

const retentionRoutes: RouteDecl[] = [
  { method: "get", path: "/api/projects/{projectId}/retention", tag: "retention", summary: "Get retention config", security: SESSION_ONLY, ok: { status: 200, schema: retentionResponseSchema } },
  { method: "put", path: "/api/projects/{projectId}/retention", tag: "retention", summary: "Set retention config", security: SESSION_ONLY, body: retentionConfigSchema, ok: { status: 200, schema: retentionResponseSchema } },
];

const allRoutes: RouteDecl[] = [
  ...metaRoutes,
  ...projectRoutes,
  ...resultsRoutes,
  ...runRoutes,
  ...compareRoutes,
  ...qualityGateRoutes,
  ...retentionRoutes,
  ...testHistoryRoutes,
  ...tokenRoutes,
  ...notificationRoutes,
  ...authRoutes,
  ...userRoutes,
  ...memberRoutes,
  ...auditRoutes,
];

// Routes whose responses are not JSON (assets, streams, redirects) and so don't
// fit the declare() JSON-error shape — registered directly.
function registerNonJsonRoutes(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/runs/{runId}/report/{wildcard}",
    tags: ["runs"], summary: "Serve a generated report asset",
    request: { params: z.object({ projectId: z.string(), runId: z.string(), wildcard: z.string() }) },
    responses: {
      200: { description: "Report asset", content: { "text/html": { schema: z.string() } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/events",
    tags: ["events"], summary: "Server-Sent Events stream of run lifecycle events",
    request: { params: z.object({ projectId: z.string() }) },
    responses: {
      200: { description: "SSE stream", content: { "text/event-stream": { schema: z.string() } } },
      404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    },
  });
  registry.registerPath({
    method: "get", path: "/api/projects/{projectId}/badge.svg",
    tags: ["badge"], summary: "Status badge for the latest ready run (always 200)",
    request: { params: z.object({ projectId: z.string() }) },
    responses: { 200: { description: "SVG badge", content: { "image/svg+xml": { schema: z.string() } } } },
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
}

export function buildOpenapiDocument(opts: OpenapiOptions): OpenApiDocument {
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

  for (const route of allRoutes) declare(registry, route);
  registerNonJsonRoutes(registry);

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
