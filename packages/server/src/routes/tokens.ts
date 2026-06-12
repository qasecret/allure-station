import type { FastifyInstance } from "fastify";
import { createTokenRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectWrite, requireProjectWrite, denyAuth, generateToken, hashToken, tokenPrefix } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";

export function registerTokenRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Create a token. Requires write access to the project: a maintainer+ session, an existing project
  // token, or — only in zero-config mode (no accounts and no tokens yet) — an anonymous bootstrap call.
  app.post("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectWrite(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    const parsed = createTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const token = generateToken();
    const created = await deps.tokens.create(projectId, parsed.data.name, hashToken(token), tokenPrefix(token), deps.now());
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "token_created", targetType: "token", targetId: created.id, projectId, metadata: { name: created.name, prefix: created.prefix } });
    return reply.code(201).send({ ...created, token }); // plaintext returned ONCE
  });

  app.get("/projects/:projectId/tokens", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const verdict = await requireProjectWrite(deps, req, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    return deps.tokens.listByProject(projectId);
  });

  app.delete("/projects/:projectId/tokens/:tokenId", async (req, reply) => {
    const { projectId, tokenId } = req.params as { projectId: string; tokenId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectWrite(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    if (!(await deps.tokens.remove(projectId, tokenId))) return reply.code(404).send({ error: "token not found" });
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "token_deleted", targetType: "token", targetId: tokenId, projectId });
    return reply.code(204).send();
  });
}
