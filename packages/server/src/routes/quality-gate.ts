import type { FastifyInstance } from "fastify";
import { qualityGateConfigSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectWrite, denyAuth } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { readGate } from "./read-gate.js";
import { evaluateGate } from "../gate.js";

export function registerQualityGateRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/quality-gate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "not found" });
    return (await deps.projects.getQualityGate(projectId)) ?? {};
  });

  // Setting the gate is a write → auth-gated. An empty body / {} clears the gate.
  app.put("/projects/:projectId/quality-gate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const qgVerdict = await authorizeProjectWrite(deps, principal, projectId);
    if (qgVerdict !== "ok") return denyAuth(reply, qgVerdict);
    const parsed = qualityGateConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const config = Object.keys(parsed.data).length === 0 ? null : parsed.data;
    await deps.projects.setQualityGate(projectId, config);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "quality_gate_set", targetType: "quality_gate", targetId: projectId, projectId, metadata: { cleared: config === null } });
    return config ?? {};
  });

  // Run summary for CI / PR checks: run + report path + previous ready run + quality-gate verdict.
  app.get("/projects/:projectId/runs/:runId/summary", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "not found" });
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    const [gate, previous] = await Promise.all([
      deps.projects.getQualityGate(projectId),
      deps.runs.previousReadyBefore(projectId, run.createdAt),
    ]);
    const configured = !!gate && Object.keys(gate).length > 0;
    // Only ready runs have stats to evaluate. For a non-ready run, report the gate as not-yet-passed
    // (no fabricated checks) rather than evaluating over zeroes.
    const qualityGate = run.stats
      ? evaluateGate(run.stats, gate)
      : { configured, passed: !configured, checks: [] };
    return {
      run,
      reportPath: `/api/projects/${projectId}/runs/${runId}/report/index.html`,
      previousReadyRunId: previous?.id ?? null,
      qualityGate,
    };
  });
}
