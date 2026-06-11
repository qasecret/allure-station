import type { FastifyInstance } from "fastify";
import { runStatusSchema, type RunStatus, type TrendPoint } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { parsePage } from "./pagination.js";
import { readGate } from "./read-gate.js";
import { authenticate, authorizeProjectWrite } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";

const TREND_LIMIT = 30;
const ERR_RUN_GENERATING = "run is generating; wait or let the reconciler fail it first";

export function registerRunRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/trends", async (req, reply): Promise<TrendPoint[] | undefined> => {
    const { projectId } = req.params as { projectId: string };
    if (!(await readGate(deps, req, projectId))) { reply.code(404).send({ error: "not found" }); return; }
    const ready = await deps.runs.listReadyByProject(projectId, TREND_LIMIT);
    return ready
      .filter((r): r is typeof r & { stats: NonNullable<typeof r.stats> } => r.stats !== null)
      .map((r) => ({ runId: r.id, createdAt: r.createdAt, stats: r.stats }));
  });

  app.get("/projects/:projectId/runs", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "not found" });
    const { status, branch } = req.query as { status?: string; branch?: string };
    if (status !== undefined && !runStatusSchema.safeParse(status).success) {
      return reply.code(400).send({ error: `invalid status "${status}"` });
    }
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    const typedStatus = status as RunStatus | undefined;
    const filter = { status: typedStatus, branch: branch || undefined };
    const [items, total] = await Promise.all([
      deps.runs.listByProject(projectId, { ...filter, ...page }),
      deps.runs.countByProject(projectId, filter),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  app.get("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "not found" });
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    return run;
  });

  // Hard-delete one run: DB row (test_results cascade) + staged results/report artifacts.
  // maintainer+/token/open-mode — same bar as creating runs.
  app.delete("/projects/:projectId/runs/:runId", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, projectId)) === "unauthorized") {
      const vis = await deps.projects.getVisibility(projectId);
      // Missing project (null) must be treated the same as private — both respond 404
      // so the response is indistinguishable and a missing project can't be fingerprinted
      // as "definitely doesn't exist" by the absence of a 404.
      const hide = !vis || vis.visibility === "private";
      return reply.code(hide ? 404 : 401).send({ error: hide ? "not found" : "unauthorized" });
    }
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "not found" });
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "not found" });
    if (!(await deps.runs.remove(runId))) {
      return reply.code(409).send({ error: ERR_RUN_GENERATING });
    }
    try {
      await deps.storage.remove(`${projectId}/runs/${runId}`); // best-effort; orphans are reapable later
    } catch {
      req.log.warn({ projectId, runId }, "run artifact cleanup failed");
    }
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "run_deleted", targetType: "run", targetId: runId, projectId, metadata: { status: run.status, stats: run.stats, branch: run.branch, commit: run.commit } });
    deps.bus.publish({ type: "run", projectId, run, deleted: true });
    return reply.code(204).send();
  });

  app.get("/projects/:projectId/runs/:runId/report/*", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    if (rel.split("/").some((seg) => seg === "..")) return reply.code(400).send({ error: "bad path" });
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "not found" });

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
