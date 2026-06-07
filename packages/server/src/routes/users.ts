import type { FastifyInstance } from "fastify";
import { createUserRequestSchema, type User } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, requireAdmin } from "../auth.js";
import { hashPassword } from "../password.js";

export function registerUserRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/users", async (req, reply) => {
    if (requireAdmin(await authenticate(deps, req)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const parsed = createUserRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (await deps.users.findByEmail(parsed.data.email)) return reply.code(409).send({ error: "email already in use" });
    const user: User = await deps.users.create(
      parsed.data.email,
      await hashPassword(parsed.data.password),
      parsed.data.role,
      deps.now(),
    );
    return reply.code(201).send(user);
  });

  app.get("/users", async (req, reply) => {
    if (requireAdmin(await authenticate(deps, req)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    return deps.users.list();
  });

  app.delete("/users/:id", async (req, reply) => {
    const principal = await authenticate(deps, req);
    if (requireAdmin(principal) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    // Block self-deletion: an admin removing their own account mid-session is an easy lockout.
    if (principal.kind === "user" && principal.userId === id) return reply.code(400).send({ error: "cannot delete your own account" });
    return (await deps.users.remove(id))
      ? reply.code(204).send()
      : reply.code(404).send({ error: "user not found" });
  });
}
