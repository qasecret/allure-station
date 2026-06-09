import { basename } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runMetadataSchema } from "@allure-station/shared";
import type { Run } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { requireProjectWrite } from "../auth.js";

// Optional CI-metadata text fields accepted alongside the file parts.
const META_FIELDS = new Set(["branch", "commit", "environment", "ciUrl"]);

/** Shared tail of /generate and /retry: enqueue an already-claimed ('generating') run and publish the
 *  live transition. On enqueue failure, mark it failed WITH the reason and publish that exact state so
 *  SSE clients and the DB agree. `run` is the pre-claim row; the lifecycle fields are set explicitly. */
async function enqueueGeneration(deps: AppDeps, req: FastifyRequest, reply: FastifyReply, projectId: string, run: Run, failReason: string): Promise<FastifyReply> {
  try {
    await deps.queue.enqueue({ projectId, runId: run.id });
  } catch (err) {
    const failedAt = deps.now();
    await deps.runs.markFailed(run.id, failedAt, failReason);
    deps.bus.publish({ type: "run", projectId, run: { ...run, status: "failed", error: failReason, finishedAt: failedAt } });
    req.log?.error?.(err);
    return reply.code(503).send({ error: "failed to enqueue generation" });
  }
  const generating: Run = { ...run, status: "generating", error: null, finishedAt: null };
  deps.bus.publish({ type: "run", projectId, run: generating });
  return reply.code(202).send(generating); // 202 Accepted
}

export function registerResultRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Upload result files (+ optional branch/commit/environment/ciUrl text fields); stages them under a
  // new pending run. The run row is created AFTER streaming, so a 0-file upload leaves no orphan run.
  app.post("/projects/:projectId/send-results", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const runId = deps.newId(); // generated up front so files can stream before the row exists
    const parts = req.parts();
    let count = 0;
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === "file") {
        const safeName = basename(part.filename ?? "");
        if (!safeName || safeName === "." || safeName === "..") continue;
        const buf = await part.toBuffer();
        await deps.storage.putBuffer(`${projectId}/runs/${runId}/results/${safeName}`, buf);
        count += 1;
      } else if (META_FIELDS.has(part.fieldname)) {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (count === 0) return reply.code(400).send({ error: "no result files uploaded" });

    const meta = runMetadataSchema.safeParse(fields);
    if (!meta.success) {
      // Files were already streamed under this runId but no run row will reference them — clean up.
      await deps.storage.remove(`${projectId}/runs/${runId}`).catch(() => {});
      return reply.code(400).send({ error: meta.error.message });
    }

    const run = await deps.runs.create(projectId, runId, "Allure Report", deps.now(), meta.data);
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
    return enqueueGeneration(deps, req, reply, projectId, pending, "failed to enqueue generation");
  });

  // Re-run generation for a FAILED run, reusing its already-staged results (send-results' files
  // survive a failed generation — only the local work dir is cleaned). Returns 202; poll GET /runs/:id.
  app.post("/projects/:projectId/runs/:runId/retry", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId) return reply.code(404).send({ error: "run not found" });
    if (run.status !== "failed") return reply.code(409).send({ error: `run is not failed (status: ${run.status})` });
    if (!(await deps.storage.exists(`${projectId}/runs/${runId}/results`))) {
      return reply.code(409).send({ error: "no staged results to retry; re-upload via send-results" });
    }
    const startedAt = deps.now();
    if (!(await deps.runs.retryFailed(runId, startedAt))) return reply.code(409).send({ error: "run is no longer failed" });
    return enqueueGeneration(deps, req, reply, projectId, run, "failed to enqueue retry");
  });
}
