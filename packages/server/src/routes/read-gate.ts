import type { FastifyRequest } from "fastify";
import type { Project } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectRead } from "../auth.js";

/**
 * Read gate for every public-by-default read route. Loads the project and enforces read access.
 * Returns the project on success, or `null` when it's missing OR private-and-unauthorized — callers
 * return 404 in both cases, so a private project's existence is never disclosed (no 401 tell).
 */
export async function readGate(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<Project | null> {
  const project = await deps.projects.get(projectId);
  if (!project) return null;
  const principal = await authenticate(deps, req);
  if ((await authorizeProjectRead(deps, principal, project)) === "unauthorized") return null;
  return project;
}
