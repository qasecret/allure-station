import type { FastifyInstance } from "fastify";
import { createNotificationRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authorizeProjectWrite } from "../auth.js";

export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  // All notification routes are auth-gated: they create/reveal webhook URLs (a write-equivalent).
  const authed = async (projectId: string, header: string | undefined): Promise<boolean> =>
    (await authorizeProjectWrite(deps, projectId, header)) === "ok";

  app.post("/projects/:projectId/notifications", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (!(await authed(projectId, req.headers.authorization))) return reply.code(401).send({ error: "unauthorized" });
    const parsed = createNotificationRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { kind, url, events } = parsed.data;
    return reply.code(201).send(await deps.notifications.create(projectId, kind, url, events, deps.now()));
  });

  app.get("/projects/:projectId/notifications", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (!(await authed(projectId, req.headers.authorization))) return reply.code(401).send({ error: "unauthorized" });
    return deps.notifications.listByProject(projectId);
  });

  app.delete("/projects/:projectId/notifications/:notificationId", async (req, reply) => {
    const { projectId, notificationId } = req.params as { projectId: string; notificationId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (!(await authed(projectId, req.headers.authorization))) return reply.code(401).send({ error: "unauthorized" });
    return (await deps.notifications.remove(projectId, notificationId))
      ? reply.code(204).send()
      : reply.code(404).send({ error: "notification not found" });
  });
}
