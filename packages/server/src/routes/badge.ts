import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { renderBadge, BADGE_GREEN, BADGE_RED, BADGE_GREY } from "../badge.js";

export function registerBadgeRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Public SVG badge for the latest ready run — always renders (200) so README embeds never break.
  app.get("/projects/:projectId/badge.svg", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    let message = "no data";
    let color = BADGE_GREY;
    if (await deps.projects.get(projectId)) {
      const [latest] = await deps.runs.listReadyByProject(projectId, 1); // newest ready run
      if (latest?.stats) {
        const s = latest.stats;
        message = `${s.passed}/${s.total}`;
        color = s.failed + s.broken > 0 ? BADGE_RED : BADGE_GREEN;
      }
    }
    reply.header("content-type", "image/svg+xml; charset=utf-8");
    reply.header("cache-control", "no-cache, max-age=60");
    return renderBadge("tests", message, color);
  });
}
