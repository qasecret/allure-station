import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { runGeneration } from "../generation.js";

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

  // Generate the most recent pending run (synchronous response; uses the job queue).
  app.post("/projects/:projectId/generate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const runs = await deps.runs.listByProject(projectId);
    const pending = runs.find((r) => r.status === "pending");
    if (!pending) return reply.code(409).send({ error: "no pending run to generate" });
    if (!(await deps.runs.claimPending(pending.id))) {
      return reply.code(409).send({ error: "run is already being generated" });
    }
    try {
      await deps.queue.add(() => runGeneration(deps, projectId, pending.id));
    } catch {
      // Generation failed; runGeneration has marked the run 'failed'. Fall through to return its state.
    }
    return reply.code(200).send(await deps.runs.get(pending.id));
  });
}
