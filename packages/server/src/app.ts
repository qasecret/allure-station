import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { ProjectRepository, RunRepository } from "./db/repositories.js";
import type { TestResultRepository } from "./db/test-results-repo.js";
import type { ApiTokenRepository } from "./db/api-tokens-repo.js";
import type { NotificationRepository } from "./db/notifications-repo.js";
import type { UserRepository } from "./db/user-repo.js";
import type { SessionRepository } from "./db/session-repo.js";
import type { MembershipRepository } from "./db/membership-repo.js";
import type { AuditRepository } from "./db/audit-repo.js";
import type { OidcProvider } from "./oidc.js";
import type { OidcConfig } from "./config.js";
import type { StorageDriver } from "./storage/driver.js";
import type { JobQueue } from "@allure-station/worker";
import type { EventBus } from "./events/bus.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerResultRoutes } from "./routes/results.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerCompareRoutes } from "./routes/compare.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerBadgeRoutes } from "./routes/badge.js";
import { registerQualityGateRoutes } from "./routes/quality-gate.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerMemberRoutes } from "./routes/members.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerTestHistoryRoutes } from "./routes/test-history.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerOpenapi } from "./openapi/plugin.js";

export interface AppDeps {
  projects: ProjectRepository;
  runs: RunRepository;
  testResults: TestResultRepository;
  tokens: ApiTokenRepository;
  notifications: NotificationRepository;
  users: UserRepository;
  sessions: SessionRepository;
  memberships: MembershipRepository;
  audit: AuditRepository;
  oidc: OidcProvider | null;     // external SSO provider, or null when OIDC isn't configured
  oidcConfig: OidcConfig | null; // the validated OIDC config (domain allowlist etc.), or null
  storage: StorageDriver;
  queue: JobQueue;
  bus: EventBus;
  workDir: string;
  version: string;
  publicUrl: string | undefined; // absolute base for links in notifications (no trailing slash)
  sessionTtlMs: number;          // session cookie/row lifetime
  cookieSecure: boolean;         // mark the session cookie Secure (https-only) in prod
  trustProxy: boolean;           // trust X-Forwarded-For/Proto (set when behind a load balancer)
  now: () => string;
  newId: () => string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: deps.trustProxy });
  // fieldSize caps text fields (run metadata) so an oversized value can't buffer up to busboy's 1 MB default.
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 5000, fieldSize: 16 * 1024 } });
  app.register(cookie); // parses req.cookies; we set Set-Cookie manually with explicit attributes
  app.decorate("deps", deps);

  // Register @fastify/static once with serve:false so reply.sendFile is decorated
  // before the API scope registers the report route.
  app.register(fastifyStatic, { root: process.cwd(), serve: false });

  app.register(
    async (api) => {
      await registerOpenapi(api, deps);
      registerMetaRoutes(api, deps);
      registerProjectRoutes(api, deps);
      registerResultRoutes(api, deps);
      registerRunRoutes(api, deps);
      registerEventRoutes(api, deps);
      registerCompareRoutes(api, deps);
      registerTokenRoutes(api, deps);
      registerBadgeRoutes(api, deps);
      registerQualityGateRoutes(api, deps);
      registerNotificationRoutes(api, deps);
      registerAuthRoutes(api, deps);
      registerUserRoutes(api, deps);
      registerMemberRoutes(api, deps);
      registerAuditRoutes(api, deps);
      registerTestHistoryRoutes(api, deps);
      registerOverviewRoutes(api, deps);
    },
    { prefix: "/api" },
  );

  const webDist = process.env.WEB_DIST;
  if (webDist && existsSync(webDist)) {
    const root = resolve(webDist); // @fastify/static requires an absolute root
    // decorateReply:false because reply.sendFile is already decorated above
    app.register(fastifyStatic, { root, prefix: "/", wildcard: false, decorateReply: false });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      if (url.startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      // Pass the web root explicitly: reply.sendFile's default root is the
      // serve:false registration above (process.cwd()), not WEB_DIST.
      return reply.sendFile("index.html", root);
    });
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance { deps: AppDeps; }
}
