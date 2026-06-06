import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { ProjectRepository, RunRepository } from "./db/repositories.js";
import type { StorageDriver } from "./storage/driver.js";
import type { JobQueue } from "@allure-station/worker";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerResultRoutes } from "./routes/results.js";
import { registerRunRoutes } from "./routes/runs.js";

export interface AppDeps {
  projects: ProjectRepository;
  runs: RunRepository;
  storage: StorageDriver;
  queue: JobQueue;
  workDir: string;
  version: string;
  now: () => string;
  newId: () => string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 5000 } });
  app.decorate("deps", deps);
  app.register(
    async (api) => {
      registerMetaRoutes(api, deps);
      registerProjectRoutes(api, deps);
      registerResultRoutes(api, deps);
      registerRunRoutes(api, deps);
    },
    { prefix: "/api" },
  );

  const webDist = process.env.WEB_DIST;
  if (webDist && existsSync(webDist)) {
    const root = resolve(webDist); // @fastify/static requires an absolute root
    app.register(fastifyStatic, { root, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      if (url.startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance { deps: AppDeps; }
}
