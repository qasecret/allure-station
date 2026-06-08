import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { readGate } from "./read-gate.js";

export function registerTestHistoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  // GET /projects/:projectId/tests/history?historyId=…|fullName=…&name=…&limit=50
  app.get("/projects/:projectId/tests/history", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { historyId, fullName, name, limit } = req.query as {
      historyId?: string; fullName?: string; name?: string; limit?: string;
    };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "project not found" });
    if (!historyId && !fullName) return reply.code(400).send({ error: "historyId or fullName is required" });

    const n = limit ? Number(limit) : 50;
    const cap = Number.isFinite(n) ? n : 50;
    const key = historyId ? { historyId } : { fullName: fullName! };
    const { entries, flakeRate, latestName } = await deps.testResults.historyByKey(projectId, key, cap);
    return {
      identity: { historyId: historyId ?? null, fullName: fullName ?? null, name: latestName ?? name ?? "" },
      window: entries.length,
      flakeRate,
      entries,
    };
  });
}
