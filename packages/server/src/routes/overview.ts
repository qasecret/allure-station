import type { FastifyInstance } from "fastify";
import type { Overview } from "@allure-station/shared";
import type { AppDeps } from "../app.js";
import { authenticate, visibilityScopeFor } from "../auth.js";

/** Instance-wide triage counts, scoped to what the caller may see. Derives failing/gateBreached
 *  from the same enriched listing the projects grid uses, so the two never disagree. */
export function registerOverviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/overview", async (req): Promise<Overview> => {
    const scope = await visibilityScopeFor(deps, await authenticate(deps, req));
    const { items } = await deps.projects.listEnriched({ scope });
    const cutoff = new Date(Date.parse(deps.now()) - 24 * 60 * 60 * 1000).toISOString();
    let failing = 0, gateBreached = 0;
    for (const p of items) {
      const lr = p.latestRun;
      if (lr && (lr.stats != null && lr.stats.failed + lr.stats.broken > 0)) failing += 1;
      if (lr?.gatePassed === false) gateBreached += 1;
    }
    // run-level counts respect the same project set
    const visibleIds = items.map((p) => p.id);
    const runCounts = await deps.runs.countTriage(visibleIds, cutoff);
    return {
      projects: items.length,
      failing,
      gateBreached,
      runsLast24h: runCounts.last24h,
      generating: runCounts.generating,
    };
  });
}
