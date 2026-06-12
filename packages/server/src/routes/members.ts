import type { FastifyInstance } from "fastify";
import { setMembershipRequestSchema, type MembershipWithUser } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, authorizeProjectOwner, requireProjectOwner, denyAuth } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";

export function registerMemberRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/projects/:projectId/members", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const verdict = await requireProjectOwner(deps, req, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    return deps.memberships.listByProject(projectId);
  });

  // Grant/update a member's role by email (idempotent upsert).
  app.put("/projects/:projectId/members", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectOwner(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    const parsed = setMembershipRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const user = await deps.users.findByEmail(parsed.data.email);
    if (!user) return reply.code(404).send({ error: "user not found" });
    // Don't let the last owner be demoted out of ownership — that orphans member management.
    if (parsed.data.role !== "owner" && (await deps.memberships.find(projectId, user.id))?.role === "owner"
        && (await deps.memberships.countOwners(projectId)) <= 1) {
      return reply.code(409).send({ error: "cannot demote the last owner" });
    }
    const membership = await deps.memberships.upsert(projectId, user.id, parsed.data.role, deps.now());
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "member_set", targetType: "member", targetId: user.id, projectId, metadata: { email: user.email, role: parsed.data.role } });
    const body: MembershipWithUser = { ...membership, email: user.email };
    return reply.code(200).send(body);
  });

  app.delete("/projects/:projectId/members/:userId", async (req, reply) => {
    const { projectId, userId } = req.params as { projectId: string; userId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const principal = await authenticate(deps, req);
    const verdict = await authorizeProjectOwner(deps, principal, projectId);
    if (verdict !== "ok") return denyAuth(reply, verdict);
    // Removing the last owner would orphan member management — block it.
    if ((await deps.memberships.find(projectId, userId))?.role === "owner" && (await deps.memberships.countOwners(projectId)) <= 1) {
      return reply.code(409).send({ error: "cannot remove the last owner" });
    }
    if (!(await deps.memberships.remove(projectId, userId))) return reply.code(404).send({ error: "member not found" });
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "member_removed", targetType: "member", targetId: userId, projectId });
    return reply.code(204).send();
  });
}
