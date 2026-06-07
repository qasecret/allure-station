import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { requireProjectWrite } from "../auth.js";

export function registerResultRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Upload result files; stages them in storage under a new pending run.
  app.post("/projects/:projectId/send-results", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }

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
    deps.bus.publish({ type: "run", projectId, run });
    return reply.code(202).send({ runId: run.id, files: count });
  });

  // Claim and enqueue a pending run. With ?runId=<id> a SPECIFIC pending run is generated (CI passes
  // the id it got from send-results, so concurrent uploads to the same project don't claim each
  // other's run); without it, the most recent pending run. Returns 202; poll GET /runs/:id for status.
  app.post("/projects/:projectId/generate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { runId } = req.query as { runId?: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let pending;
    if (runId) {
      const run = await deps.runs.get(runId);
      if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "run not found" });
      if (run.status !== "pending") return reply.code(409).send({ error: `run is not pending (status: ${run.status})` });
      pending = run;
    } else {
      pending = await deps.runs.findPendingByProject(projectId);
      if (!pending) return reply.code(409).send({ error: "no pending run to generate" });
    }
    const startedAt = deps.now();
    if (!(await deps.runs.claimPending(pending.id, startedAt))) return reply.code(409).send({ error: "run is already being generated" });
    try {
      await deps.queue.enqueue({ projectId, runId: pending.id });
    } catch (err) {
      const failedAt = deps.now();
      await deps.runs.markFailed(pending.id, failedAt);
      // Publish the terminal state too — clients already saw this run as pending/generating.
      deps.bus.publish({ type: "run", projectId, run: { ...pending, status: "failed", finishedAt: failedAt } });
      req.log?.error?.(err);
      return reply.code(503).send({ error: "failed to enqueue generation" });
    }
    // We just claimed `pending` into 'generating' — reflect that without another round-trip.
    const generating = { ...pending, status: "generating" as const };
    deps.bus.publish({ type: "run", projectId, run: generating });
    return reply.code(202).send(generating); // 202 Accepted
  });
}
