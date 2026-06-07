import type { FastifyRequest } from "fastify";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectRead } from "../auth.js";

/**
 * Read gate for every public-by-default read route. Returns true when the caller may read the
 * project, false when it's missing OR private-and-unauthorized — callers 404 in both cases, so a
 * private project's existence is never disclosed (no 401 tell).
 *
 * Hot-path note: the report-asset route hits this once per asset, so the common case (a PUBLIC
 * project) must be cheap — we do a single id+visibility lookup and short-circuit WITHOUT resolving
 * the principal (no session/user lookup, no token last-used write). Only private projects authenticate.
 */
export async function readGate(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<boolean> {
  const project = await deps.projects.getVisibility(projectId);
  if (!project) return false;
  if (project.visibility !== "private") return true;
  const principal = await authenticate(deps, req);
  return (await authorizeProjectRead(deps, principal, project)) === "ok";
}
