import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { computeRegression } from "@allure-station/shared";
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

    // Non-positive / non-numeric limits fall back to the default 50; historyByKey clamps the upper bound.
    const parsed = Number(limit);
    const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
    const key = historyId ? { historyId } : { fullName: fullName! };
    const { entries, flakeRate, latestName, latestFullName, latestHistoryId } =
      await deps.testResults.historyByKey(projectId, key, cap);
    return {
      identity: {
        historyId: latestHistoryId ?? historyId ?? null,
        fullName: latestFullName ?? fullName ?? null,
        name: latestName ?? name ?? "",
      },
      window: entries.length,
      flakeRate,
      regression: computeRegression(entries),
      entries,
    };
  });

  // GET /projects/:projectId/tests/history/trace?runId=…&historyId=…|fullName=…
  // Lazily serves one (run, test) cell's stack trace, so the heavy blob is only fetched on expand.
  app.get("/projects/:projectId/tests/history/trace", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { runId, historyId, fullName } = req.query as { runId?: string; historyId?: string; fullName?: string };
    if (!(await readGate(deps, req, projectId))) return reply.code(404).send({ error: "project not found" });
    if (!runId || (!historyId && !fullName)) return reply.code(400).send({ error: "runId and historyId or fullName are required" });

    const key = historyId ? { historyId } : { fullName: fullName! };
    const trace = await deps.testResults.traceForRun(projectId, runId, key);
    return { trace };
  });
}
