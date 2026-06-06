import type { FastifyInstance } from "fastify";
import { qualityGateConfigSchema, type RunStats } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authorizeProjectWrite } from "../auth.js";
import { evaluateGate } from "../gate.js";

const ZERO_STATS: RunStats = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };

export function registerQualityGateRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/quality-gate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    return (await deps.projects.getQualityGate(projectId)) ?? {};
  });

  // Setting the gate is a write → auth-gated. An empty body / {} clears the gate.
  app.put("/projects/:projectId/quality-gate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await authorizeProjectWrite(deps, projectId, req.headers.authorization)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = qualityGateConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const config = Object.keys(parsed.data).length === 0 ? null : parsed.data;
    await deps.projects.setQualityGate(projectId, config);
    return config ?? {};
  });

  // Run summary for CI / PR checks: run + report path + previous ready run + quality-gate verdict.
  app.get("/projects/:projectId/runs/:runId/summary", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    const [gate, previous] = await Promise.all([
      deps.projects.getQualityGate(projectId),
      deps.runs.previousReadyBefore(projectId, run.createdAt),
    ]);
    return {
      run,
      reportPath: `/api/projects/${projectId}/runs/${runId}/report/index.html`,
      previousReadyRunId: previous?.id ?? null,
      qualityGate: evaluateGate(run.stats ?? ZERO_STATS, gate),
    };
  });
}
