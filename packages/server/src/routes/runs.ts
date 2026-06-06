import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export function registerRunRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/runs", async (req) => {
    const { projectId } = req.params as { projectId: string };
    return deps.runs.listByProject(projectId);
  });

  app.get("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await deps.runs.get(runId);
    return run ? run : reply.code(404).send({ error: "not found" });
  });

  // Serve generated report assets straight from storage.
  app.get("/projects/:projectId/runs/:runId/report/*", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    const base = await deps.storage.resolveLocalPath(`${projectId}/runs/${runId}/report`);
    const file = join(base, rel);
    if (!file.startsWith(base)) return reply.code(400).send({ error: "bad path" });
    try {
      await stat(file);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
    reply.header("content-type", MIME[extname(file)] ?? "application/octet-stream");
    return reply.send(createReadStream(file));
  });
}
