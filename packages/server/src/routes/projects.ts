import type { FastifyInstance } from "fastify";
import { createProjectSchema, projectIdSchema, projectSortSchema, setVisibilityRequestSchema, updateProjectRequestSchema } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { parsePage } from "./pagination.js";
import { authenticate, authorizeProjectCreate, authorizeProjectOwner, authorizeProjectWrite, visibilityScopeFor, denyAuth } from "../auth.js";
import { actorFromPrincipal, recordAudit } from "../audit.js";
import { readGate } from "./read-gate.js";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/projects", async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Creating a project is admin-only once accounts exist; open in zero-config mode (no users).
    const principal = await authenticate(deps, req);
    const createVerdict = await authorizeProjectCreate(deps, principal);
    if (createVerdict !== "ok") return denyAuth(reply, createVerdict);
    if (await deps.projects.get(parsed.data.id)) {
      return reply.code(409).send({ error: "project already exists" });
    }
    const project = await deps.projects.create(parsed.data.id, deps.now(), parsed.data.displayName ?? null);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_created", targetType: "project", targetId: project.id, projectId: project.id });
    return reply.code(201).send(project);
  });

  app.get("/projects", async (req, reply) => {
    const { q, sort } = req.query as { q?: string; sort?: string };
    const parsedSort = sort === undefined ? undefined : projectSortSchema.safeParse(sort);
    if (parsedSort && !parsedSort.success) return reply.code(400).send({ error: `invalid sort "${sort}"` });
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    // Filter to what the caller may see — private projects don't leak to non-members via the list.
    const scope = await visibilityScopeFor(deps, await authenticate(deps, req));
    const { items, total } = await deps.projects.listEnriched({ q, scope, sort: parsedSort?.data, ...page });
    reply.header("X-Total-Count", String(total));
    return items;
  });

  app.get("/projects/:id", async (req, reply) => {
    const id = projectIdSchema.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: id.error.message });
    if (!(await readGate(deps, req, id.data))) return reply.code(404).send({ error: "not found" });
    const project = await deps.projects.get(id.data);
    // Resolve the caller's effective write permission so the UI can show the correct affordances.
    // readGate may have already authenticated internally (private projects), but it doesn't surface
    // the principal — authenticating again is cheap (session cookie / token lookup is cached by
    // the DB, not re-hashed) and keeps the read-gate contract simple.
    const principal = await authenticate(deps, req);
    const canWrite = (await authorizeProjectWrite(deps, principal, id.data)) === "ok";
    return { ...project, canWrite };
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.projects.get(id))) return reply.code(404).send({ error: "not found" });
    const principal = await authenticate(deps, req);
    const delVerdict = await authorizeProjectWrite(deps, principal, id);
    if (delVerdict !== "ok") return denyAuth(reply, delVerdict);
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
    const principal = await authenticate(deps, req);
    const patchVerdict = await authorizeProjectWrite(deps, principal, id);
    if (patchVerdict !== "ok") {
      const vis = await deps.projects.getVisibility(id);
      // Missing project (null) must be treated the same as private — both respond 404
      // so the response is indistinguishable and a missing project can't be fingerprinted
      // as "definitely doesn't exist" by the absence of a 404.
      const hide = !vis || vis.visibility === "private";
      if (hide) return reply.code(404).send({ error: "not found" });
      return denyAuth(reply, patchVerdict);
    }
    const existing = await deps.projects.get(id);
    if (!existing) return reply.code(404).send({ error: "not found" });
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
    const visVerdict = await authorizeProjectOwner(deps, principal, id);
    if (visVerdict !== "ok") return denyAuth(reply, visVerdict);
    const parsed = setVisibilityRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    await deps.projects.setVisibility(id, parsed.data.visibility);
    await recordAudit(deps, { ...actorFromPrincipal(principal), action: "project_visibility_set", targetType: "project", targetId: id, projectId: id, metadata: { visibility: parsed.data.visibility } });
    return reply.send(await deps.projects.get(id));
  });
}
