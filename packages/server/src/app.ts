import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectRepository, RunRepository } from "./db/repositories.js";
import type { StorageDriver } from "./storage/driver.js";
import type { JobQueue } from "@allure-station/worker";
import { registerMetaRoutes } from "./routes/meta.js";

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
  app.decorate("deps", deps);
  registerMetaRoutes(app, deps);
  return app;
}

declare module "fastify" {
  interface FastifyInstance { deps: AppDeps; }
}
