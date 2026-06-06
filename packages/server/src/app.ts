import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
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
  registerMetaRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerResultRoutes(app, deps);
  registerRunRoutes(app, deps);
  return app;
}

declare module "fastify" {
  interface FastifyInstance { deps: AppDeps; }
}
