import { resolve } from "node:path";
import { nanoid } from "nanoid";
import type { Db } from "./db/client.js";
import { ProjectRepository, RunRepository } from "./db/repositories.js";
import { TestResultRepository } from "./db/test-results-repo.js";
import { ApiTokenRepository } from "./db/api-tokens-repo.js";
import { NotificationRepository } from "./db/notifications-repo.js";
import { UserRepository } from "./db/user-repo.js";
import { SessionRepository } from "./db/session-repo.js";
import { MembershipRepository } from "./db/membership-repo.js";
import { AuditRepository } from "./db/audit-repo.js";
import { createStorage } from "./storage/factory.js";
import type { AppDeps } from "./app.js";
import type { AppConfig } from "./config.js";
import type { JobQueue } from "@allure-station/worker";
import type { EventBus } from "./events/bus.js";

/**
 * Construct the shared AppDeps from config, a pre-built queue, an event bus, and an open db
 * connection. The caller is responsible for running migrations before calling this function.
 */
export function buildDeps(config: AppConfig, queue: JobQueue, db: Db, bus: EventBus): AppDeps {
  return {
    projects: new ProjectRepository(db),
    runs: new RunRepository(db),
    testResults: new TestResultRepository(db, () => nanoid(12)),
    tokens: new ApiTokenRepository(db, () => nanoid(12)),
    notifications: new NotificationRepository(db, () => nanoid(12)),
    users: new UserRepository(db, () => nanoid(12)),
    sessions: new SessionRepository(db, () => nanoid(12)),
    memberships: new MembershipRepository(db, () => nanoid(12)),
    audit: new AuditRepository(db, () => nanoid(12)),
    storage: createStorage(config.storage),
    queue,
    bus,
    workDir: resolve(config.workDir),
    version: config.version,
    publicUrl: config.publicUrl,
    sessionTtlMs: config.sessionTtlMs,
    cookieSecure: config.cookieSecure,
    now: () => new Date().toISOString(),
    newId: () => nanoid(12),
  };
}
