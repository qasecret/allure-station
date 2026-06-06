import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerResultRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Upload result files; stages them in storage under a new pending run.
  app.post("/projects/:projectId/send-results", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });

    const runId = deps.newId();
    const run = await deps.runs.create(projectId, runId, "Allure Report", deps.now());

    const parts = req.parts();
    let count = 0;
    for await (const part of parts) {
      if (part.type === "file") {
        const safeName = basename(part.filename ?? "");
        if (!safeName || safeName === "." || safeName === "..") continue;
        const buf = await part.toBuffer();
        await deps.storage.putBuffer(`${projectId}/runs/${runId}/results/${safeName}`, buf);
        count += 1;
      }
    }
    if (count === 0) return reply.code(400).send({ error: "no result files uploaded" });
    return reply.code(202).send({ runId: run.id, files: count });
  });

  // Claim and enqueue the most recent pending run. Returns 202 with the generating run immediately.
  // Callers must poll GET /projects/:id/runs/:runId for terminal status (ready/failed).
  app.post("/projects/:projectId/generate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const pending = await deps.runs.findPendingByProject(projectId);
    if (!pending) return reply.code(409).send({ error: "no pending run to generate" });
    const startedAt = deps.now();
    if (!(await deps.runs.claimPending(pending.id, startedAt))) return reply.code(409).send({ error: "run is already being generated" });
    try {
      await deps.queue.enqueue({ projectId, runId: pending.id });
    } catch (err) {
      await deps.runs.markFailed(pending.id, deps.now());
      req.log?.error?.(err);
      return reply.code(503).send({ error: "failed to enqueue generation" });
    }
    // We just claimed `pending` into 'generating' — reflect that without another round-trip.
    return reply.code(202).send({ ...pending, status: "generating" }); // 202 Accepted
  });
}
