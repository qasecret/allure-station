import type { FastifyInstance } from "fastify";
import { createProjectSchema, projectIdSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { parsePage } from "./pagination.js";
import { authenticate, authorizeProjectCreate, authorizeProjectWrite } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/projects", async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Creating a project is admin-only once accounts exist; open in zero-config mode (no users).
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectCreate(deps, principal)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (await deps.projects.get(parsed.data.id)) {
      return reply.code(409).send({ error: "project already exists" });
    }
    const project = await deps.projects.create(parsed.data.id, deps.now());
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_created", targetType: "project", targetId: project.id, projectId: project.id });
    return reply.code(201).send(project);
  });

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

  app.get("/projects/:id", async (req, reply) => {
    const id = projectIdSchema.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: id.error.message });
    const project = await deps.projects.get(id.data);
    return project ? project : reply.code(404).send({ error: "not found" });
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.projects.get(id))) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, id)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    await deps.projects.remove(id);
    try {
      await deps.storage.remove(`${id}`); // best-effort artifact cleanup
    } catch {
      // ignore: project metadata is already gone; orphaned artifacts are harmless
    }
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_deleted", targetType: "project", targetId: id, projectId: id });
    return reply.code(204).send();
  });
}
