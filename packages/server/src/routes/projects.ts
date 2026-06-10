import type { FastifyInstance } from "fastify";
import { createProjectSchema, projectIdSchema, setVisibilityRequestSchema, updateProjectRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { parsePage } from "./pagination.js";
import { authenticate, authorizeProjectCreate, authorizeProjectOwner, authorizeProjectWrite, visibilityScopeFor } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { readGate } from "./read-gate.js";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/projects", async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Creating a project is admin-only once accounts exist; open in zero-config mode (no users).
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectCreate(deps, principal)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (await deps.projects.get(parsed.data.id)) {
      return reply.code(409).send({ error: "project already exists" });
    }
    const project = await deps.projects.create(parsed.data.id, deps.now(), parsed.data.displayName ?? null);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_created", targetType: "project", targetId: project.id, projectId: project.id });
    return reply.code(201).send(project);
  });

  app.get("/projects", async (req, reply) => {
    const { q } = req.query as { q?: string };
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    // Filter to what the caller may see — private projects don't leak to non-members via the list.
    const scope = await visibilityScopeFor(deps, await authenticate(deps, req));
    const [items, total] = await Promise.all([
      deps.projects.list({ q, ...page, scope }),
      deps.projects.count({ q, scope }),
    ]);
    reply.header("X-Total-Count", String(total));
    return items;
  });

  app.get("/projects/:id", async (req, reply) => {
    const id = projectIdSchema.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: id.error.message });
    if (!(await readGate(deps, req, id.data))) return reply.code(404).send({ error: "not found" });
    return deps.projects.get(id.data);
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.projects.get(id))) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, id)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    await deps.projects.remove(id);
    try {
      await deps.storage.remove(`${id}`); // best-effort artifact cleanup
    } catch {
      // ignore: project metadata is already gone; orphaned artifacts are harmless
    }
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_deleted", targetType: "project", targetId: id, projectId: id });
    return reply.code(204).send();
  });

  // Rename (presentation-only display name; id is the immutable handle). Maintainer+/token/open.
  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.projects.get(id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectWrite(deps, principal, id)) === "unauthorized") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = updateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const displayName = parsed.data.displayName || null; // "" → null (clear)
    await deps.projects.setDisplayName(id, displayName);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_renamed", targetType: "project", targetId: id, projectId: id, metadata: { from: existing.displayName, to: displayName } });
    return reply.send(await deps.projects.get(id));
  });

  // Set project visibility (public/private) — owner or global admin.
  app.put("/projects/:id/visibility", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.projects.get(id))) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    if ((await authorizeProjectOwner(deps, principal, id)) === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    const parsed = setVisibilityRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await deps.projects.setVisibility(id, parsed.data.visibility);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_visibility_set", targetType: "project", targetId: id, projectId: id, metadata: { visibility: parsed.data.visibility } });
    return reply.send(await deps.projects.get(id));
  });
}
