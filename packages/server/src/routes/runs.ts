import type { FastifyInstance } from "fastify";
import { runStatusSchema, type RunStatus, type TrendPoint } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { parsePage } from "./pagination.js";

const TREND_LIMIT = 30;

export function registerRunRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/trends", async (req): Promise<TrendPoint[]> => {
    const { projectId } = req.params as { projectId: string };
    const ready = await deps.runs.listReadyByProject(projectId, TREND_LIMIT);
    return ready
      .filter((r): r is typeof r & { stats: NonNullable<typeof r.stats> } => r.stats !== null)
      .map((r) => ({ runId: r.id, createdAt: r.createdAt, stats: r.stats }));
  });

  app.get("/projects/:projectId/runs", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { status } = req.query as { status?: string };
    if (status !== undefined && !runStatusSchema.safeParse(status).success) {
      return reply.code(400).send({ error: `invalid status "${status}"` });
    }
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const typedStatus = status as RunStatus | undefined;
    const [items, total] = await Promise.all([
      deps.runs.listByProject(projectId, { status: typedStatus, ...page }),
      deps.runs.countByProject(projectId, { status: typedStatus }),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  app.get("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    return run;
  });

  app.get("/projects/:projectId/runs/:runId/report/*", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    if (rel.split("/").some((seg) => seg === "..")) return reply.code(400).send({ error: "bad path" });

    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId || run.status !== "ready") {
      return reply.code(404).send({ error: "not found" });
    }
    try {
      const obj = await deps.storage.readStream(`${projectId}/runs/${runId}/report/${rel}`);
      if (obj.contentType) reply.header("content-type", obj.contentType);
      if (obj.contentLength != null) reply.header("content-length", String(obj.contentLength));
      return reply.send(obj.body);
    } catch (err) {
      const e = err as { code?: string; name?: string };
      if (e.code === "ENOENT" || e.name === "NoSuchKey") return reply.code(404).send({ error: "not found" });
      throw err;
    }
  });
}
