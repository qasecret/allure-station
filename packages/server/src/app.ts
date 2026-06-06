import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { ProjectRepository, RunRepository } from "./db/repositories.js";
import type { TestResultRepository } from "./db/test-results-repo.js";
import type { ApiTokenRepository } from "./db/api-tokens-repo.js";
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

export interface AppDeps {
  projects: ProjectRepository;
  runs: RunRepository;
  testResults: TestResultRepository;
  tokens: ApiTokenRepository;
  storage: StorageDriver;
  queue: JobQueue;
  bus: EventBus;
  workDir: string;
  version: string;
  now: () => string;
  newId: () => string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 5000 } });
  app.decorate("deps", deps);

  // Register @fastify/static once with serve:false so reply.sendFile is decorated
  // before the API scope registers the report route.
  app.register(fastifyStatic, { root: process.cwd(), serve: false });

  app.register(
    async (api) => {
      registerMetaRoutes(api, deps);
      registerProjectRoutes(api, deps);
      registerResultRoutes(api, deps);
      registerRunRoutes(api, deps);
      registerEventRoutes(api, deps);
      registerCompareRoutes(api, deps);
      registerTokenRoutes(api, deps);
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
