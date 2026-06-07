import type { FastifyInstance } from "fastify";
import { createTokenRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { requireProjectWrite, generateToken, hashToken, tokenPrefix } from "../auth.js";

export function registerTokenRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Create a token. Requires write access to the project: a maintainer+ session, an existing project
  // token, or — only in zero-config mode (no accounts and no tokens yet) — an anonymous bootstrap call.
  app.post("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const token = generateToken();
    const created = await deps.tokens.create(projectId, parsed.data.name, hashToken(token), tokenPrefix(token), deps.now());
    return reply.code(201).send({ ...created, token }); // plaintext returned ONCE
  });

  app.get("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return deps.tokens.listByProject(projectId);
  });

  app.delete("/projects/:projectId/tokens/:tokenId", async (req, reply) => {
    const { projectId, tokenId } = req.params as { projectId: string; tokenId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectWrite(deps, req, projectId)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return (await deps.tokens.remove(projectId, tokenId))
      ? reply.code(204).send()
      : reply.code(404).send({ error: "token not found" });
  });
}
