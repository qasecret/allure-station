import type { FastifyInstance } from "fastify";
import { setMembershipRequestSchema, type MembershipWithUser } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { requireProjectOwner } from "../auth.js";

export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/members", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectOwner(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return deps.memberships.listByProject(projectId);
  });

  // Grant/update a member's role by email (idempotent upsert).
  app.put("/projects/:projectId/members", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectOwner(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const parsed = setMembershipRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const user = await deps.users.findByEmail(parsed.data.email);
    if (!user) return reply.code(404).send({ error: "user not found" });
    const membership = await deps.memberships.upsert(projectId, user.id, parsed.data.role, deps.now());
    const body: MembershipWithUser = { ...membership, email: user.email };
    return reply.code(200).send(body);
  });

  app.delete("/projects/:projectId/members/:userId", async (req, reply) => {
    const { projectId, userId } = req.params as { projectId: string; userId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    if ((await requireProjectOwner(deps, req, projectId)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return (await deps.memberships.remove(projectId, userId))
      ? reply.code(204).send()
      : reply.code(404).send({ error: "member not found" });
  });
}
