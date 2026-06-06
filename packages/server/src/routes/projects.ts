import type { FastifyInstance } from "fastify";
import { createProjectSchema, projectIdSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/projects", async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    if (await deps.projects.get(parsed.data.id)) {
      return reply.code(409).send({ error: "project already exists" });
    }
    const project = await deps.projects.create(parsed.data.id, deps.now());
    return reply.code(201).send(project);
  });

  app.get("/projects", async () => deps.projects.list());

  app.get("/projects/:id", async (req, reply) => {
    const id = projectIdSchema.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: id.error.message });
    const project = await deps.projects.get(id.data);
    return project ? project : reply.code(404).send({ error: "not found" });
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.projects.get(id))) return reply.code(404).send({ error: "not found" });
    await deps.projects.remove(id);
    try {
      await deps.storage.remove(`${id}`); // best-effort artifact cleanup
    } catch {
      // ignore: project metadata is already gone; orphaned artifacts are harmless
    }
    return reply.code(204).send();
  });
}
