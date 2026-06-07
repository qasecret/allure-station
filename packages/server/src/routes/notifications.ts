import type { FastifyInstance } from "fastify";
import { createNotificationRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectWrite, requireProjectWrite } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { checkWebhookUrl } from "../safe-url.js";

export function registerNotificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/projects/:projectId/notifications", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const parsed = createNotificationRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { kind, url, events } = parsed.data;
    const safe = checkWebhookUrl(url);
    if (!safe.ok) return reply.code(400).send({ error: `webhook url rejected: ${safe.reason}` });
    const created = await deps.notifications.create(projectId, kind, url, events, deps.now());
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "notification_created", targetType: "notification", targetId: created.id, projectId, metadata: { kind } });
    return reply.code(201).send(created);
  });

  app.get("/projects/:projectId/notifications", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return deps.notifications.listByProject(projectId);
  });

  app.delete("/projects/:projectId/notifications/:notificationId", async (req, reply) => {
    const { projectId, notificationId } = req.params as { projectId: string; notificationId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    if (!(await deps.notifications.remove(projectId, notificationId))) return reply.code(404).send({ error: "notification not found" });
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "notification_deleted", targetType: "notification", targetId: notificationId, projectId });
    return reply.code(204).send();
  });
}
