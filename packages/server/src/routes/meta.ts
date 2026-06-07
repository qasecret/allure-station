import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

const ALLURE_VERSION = "3.9.0";

export function registerMetaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/version", async () => ({ version: deps.version, allure: ALLURE_VERSION }));
  app.get("/config", async () => ({
    // securityEnabled = at least one account exists (writes then require auth; see authorizeProjectWrite).
    securityEnabled: (await deps.users.count()) > 0,
    oidc: deps.oidc ? { enabled: true, label: deps.oidc.label } : { enabled: false },
    allure: ALLURE_VERSION,
  }));
}
