import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { authenticate, requireAdmin, requireProjectOwner, denyAuth } from "../auth.js";
import { parsePage, type PageParams } from "./pagination.js";
import { auditActionSchema, type AuditAction } from "@allure-station/shared";

// The audit log grows unbounded, so a request without ?limit must not serialize the whole table.
const DEFAULT_LIMIT = 100;
function pageWithDefault(query: Record<string, unknown>): PageParams {
  const page = parsePage(query);
  return { ...page, limit: page.limit ?? DEFAULT_LIMIT };
}

interface AuditFilters {
  action?: AuditAction;
  actor?: string;
  from?: string;
  to?: string;
}

/** Parse and validate the audit filter query params.
 *  Returns the parsed filters or returns an `{ error }` object on invalid input. */
function parseAuditFilters(query: Record<string, unknown>): AuditFilters | { error: string } {
  const raw = query as { action?: string; actor?: string; from?: string; to?: string };

  // Treat empty strings as absent, consistent with parsePage's convention.
  const action_raw = raw.action === "" ? undefined : raw.action;
  const actor_raw  = raw.actor  === "" ? undefined : raw.actor;
  const from_raw   = raw.from   === "" ? undefined : raw.from;
  const to_raw     = raw.to     === "" ? undefined : raw.to;

  let action: AuditAction | undefined;
  if (action_raw !== undefined) {
    const parsed = auditActionSchema.safeParse(action_raw);
    if (!parsed.success) return { error: `invalid action "${action_raw}"` };
    action = parsed.data;
  }

  const actor = typeof actor_raw === "string" ? actor_raw : undefined;

  let from: string | undefined;
  if (from_raw !== undefined) {
    if (Number.isNaN(Date.parse(from_raw))) return { error: `invalid from date "${from_raw}"` };
    from = new Date(from_raw).toISOString();
  }

  let to: string | undefined;
  if (to_raw !== undefined) {
    if (Number.isNaN(Date.parse(to_raw))) return { error: `invalid to date "${to_raw}"` };
    to = new Date(to_raw).toISOString();
  }

  return { action, actor, from, to };
}

export function registerAuditRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Global audit log — admin only.
  app.get("/audit", async (req, reply) => {
    const auditVerdict = requireAdmin(await authenticate(deps, req));
    if (auditVerdict !== "ok") return denyAuth(reply, auditVerdict);
    let page;
    try { page = pageWithDefault(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const filters = parseAuditFilters(req.query as Record<string, unknown>);
    if ("error" in filters) return reply.code(400).send({ error: filters.error });
    const opts = { ...filters, ...page };
    const [items, total] = await Promise.all([deps.audit.list(opts), deps.audit.count(filters)]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  // Per-project audit log — project owner or global admin.
  app.get("/projects/:projectId/audit", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await deps.projects.get(projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const projAuditVerdict = await requireProjectOwner(deps, req, projectId);
    if (projAuditVerdict !== "ok") return denyAuth(reply, projAuditVerdict);
    let page;
    try { page = pageWithDefault(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const filters = parseAuditFilters(req.query as Record<string, unknown>);
    if ("error" in filters) return reply.code(400).send({ error: filters.error });
    // since = this project's createdAt, so a reused (deleted-then-recreated) id can't reveal the
    // prior tenant's audit history.
    const scope = { projectId, since: project.createdAt };
    const fullOpts = { ...scope, ...filters, ...page };
    const countOpts = { ...scope, ...filters };
    const [items, total] = await Promise.all([
      deps.audit.list(fullOpts),
      deps.audit.count(countOpts),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });
}
