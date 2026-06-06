import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { compareRuns } from "../compare.js";

export function registerCompareRoutes(app: FastifyInstance, deps: AppDeps): void {
  // GET /projects/:projectId/compare?base=<runId>&target=<runId>
  app.get("/projects/:projectId/compare", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { base, target } = req.query as { base?: string; target?: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if (!base || !target) return reply.code(400).send({ error: "base and target query params are required" });

    const [baseRun, targetRun] = await Promise.all([deps.runs.get(base), deps.runs.get(target)]);
    for (const [r, id] of [[baseRun, base], [targetRun, target]] as const) {
      if (!r || r.projectId !== projectId) return reply.code(404).send({ error: `run ${id} not found in project` });
      if (r.status !== "ready") return reply.code(409).send({ error: `run ${id} is not ready` });
    }

    const [baseTests, targetTests] = await Promise.all([
      deps.testResults.listByRun(base),
      deps.testResults.listByRun(target),
    ]);
    return compareRuns(
      { runId: base, createdAt: baseRun!.createdAt, tests: baseTests },
      { runId: target, createdAt: targetRun!.createdAt, tests: targetTests },
    );
  });
}
