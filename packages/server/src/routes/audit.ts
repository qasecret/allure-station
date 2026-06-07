import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { authenticate, requireAdmin, requireProjectOwner } from "../auth.js";
import { parsePage } from "./pagination.js";

export function registerAuditRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Global audit log — admin only.
  app.get("/audit", async (req, reply) => {
    if (requireAdmin(await authenticate(deps, req)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const [items, total] = await Promise.all([deps.audit.list(page), deps.audit.count()]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  // Per-project audit log — project owner or global admin.
  app.get("/projects/:projectId/audit", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectOwner(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const [items, total] = await Promise.all([
      deps.audit.list({ projectId, ...page }),
      deps.audit.count({ projectId }),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });
}
