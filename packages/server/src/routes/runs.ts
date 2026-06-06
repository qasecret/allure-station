import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerRunRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/trends", async (req) => {
    const { projectId } = req.params as { projectId: string };
    const ready = await deps.runs.listReadyByProject(projectId);
    return ready.map((r) => ({ runId: r.id, createdAt: r.createdAt, stats: r.stats }));
  });

  app.get("/projects/:projectId/runs", async (req) => {
    const { projectId } = req.params as { projectId: string };
    return deps.runs.listByProject(projectId);
  });

  app.get("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    return run;
  });

  // Serve generated report assets straight from storage.
  // reply.sendFile handles MIME via @fastify/static's bundled mime package,
  // rejects path-traversal attempts itself, and 404s on missing files.
  app.get("/projects/:projectId/runs/:runId/report/*", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    const base = await deps.storage.resolveLocalPath(`${projectId}/runs/${runId}/report`);
    return reply.sendFile(rel, base);
  });
}
