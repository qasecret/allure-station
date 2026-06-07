import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { authenticate, requireAdmin, requireProjectOwner } from "../auth.js";
import { parsePage, type PageParams } from "./pagination.js";

// The audit log grows unbounded, so a request without ?limit must not serialize the whole table.
const DEFAULT_LIMIT = 100;
function pageWithDefault(query: Record<string, unknown>): PageParams {
  const page = parsePage(query);
  return { ...page, limit: page.limit ?? DEFAULT_LIMIT };
}

export function registerAuditRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Global audit log — admin only.
  app.get("/audit", async (req, reply) => {
    if (requireAdmin(await authenticate(deps, req)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    let page;
    try { page = pageWithDefault(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const [items, total] = await Promise.all([deps.audit.list(page), deps.audit.count()]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  // Per-project audit log — project owner or global admin.
  app.get("/projects/:projectId/audit", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await deps.projects.get(projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectOwner(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    let page;
    try { page = pageWithDefault(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    // since = this project's createdAt, so a reused (deleted-then-recreated) id can't reveal the
    // prior tenant's audit history.
    const scope = { projectId, since: project.createdAt };
    const [items, total] = await Promise.all([
      deps.audit.list({ ...scope, ...page }),
      deps.audit.count(scope),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });
}
