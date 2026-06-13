import type { FastifyInstance } from "fastify";
import { retentionConfigSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import type { AppConfig } from "../config.js";
import { authenticate, authorizeProjectOwner, denyAuth } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";

export function registerRetentionRoutes(app: FastifyInstance, deps: AppDeps, config: Pick<AppConfig, "retentionDays" | "retentionMaxRuns">): void {
  app.get("/projects/:projectId/retention", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectOwner(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    const override = await deps.projects.getRetention(projectId);
    return {
      retentionDays: override.retentionDays,
      retentionMaxRuns: override.retentionMaxRuns,
      effectiveRetentionDays: override.retentionDays ?? config.retentionDays,
      effectiveRetentionMaxRuns: override.retentionMaxRuns ?? config.retentionMaxRuns,
    };
  });

  app.put("/projects/:projectId/retention", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectOwner(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    const parsed = retentionConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const current = await deps.projects.getRetention(projectId);
    const days = parsed.data.retentionDays !== undefined ? parsed.data.retentionDays : current.retentionDays;
    const maxRuns = parsed.data.retentionMaxRuns !== undefined ? parsed.data.retentionMaxRuns : current.retentionMaxRuns;
    await deps.projects.setRetention(projectId, days, maxRuns);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "retention_updated", targetType: "project", targetId: projectId, projectId, metadata: { retentionDays: days, retentionMaxRuns: maxRuns } });
    return {
      retentionDays: days,
      retentionMaxRuns: maxRuns,
      effectiveRetentionDays: days ?? config.retentionDays,
      effectiveRetentionMaxRuns: maxRuns ?? config.retentionMaxRuns,
    };
  });
}
