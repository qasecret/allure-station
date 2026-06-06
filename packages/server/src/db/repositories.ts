import { and, desc, eq } from "drizzle-orm";
import type { Project, Run, RunStats, RunStatus } from "@allure-station/shared";
import type { Db } from "./client.js";
import { projects, runs } from "./schema.js";

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, now: string): Promise<Project> {
    this.db.insert(projects).values({ id, createdAt: now }).run();
    return { id, createdAt: now, latestRunId: null };
  }

  async list(): Promise<Project[]> {
    const rows = this.db.select().from(projects).orderBy(projects.id).all();
    return Promise.all(rows.map((r) => this.#withLatest(r.id, r.createdAt)));
  }

  async get(id: string): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? this.#withLatest(row.id, row.createdAt) : null;
  }

  async remove(id: string): Promise<void> {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  async #withLatest(id: string, createdAt: string): Promise<Project> {
    const latest = this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, id))
      .orderBy(desc(runs.createdAt))
      .limit(1)
      .get();
    return { id, createdAt, latestRunId: latest?.id ?? null };
  }
}

export class RunRepository {
  constructor(private readonly db: Db) {}

  async create(projectId: string, id: string, reportName: string, now: string): Promise<Run> {
    this.db.insert(runs).values({
      id, projectId, status: "pending", reportName, createdAt: now, finishedAt: null, statsJson: null,
    }).run();
    return { id, projectId, status: "pending", reportName, createdAt: now, finishedAt: null, stats: null };
  }

  async setStatus(id: string, status: RunStatus): Promise<void> {
    this.db.update(runs).set({ status }).where(eq(runs.id, id)).run();
  }

  /** Atomically transition a run from 'pending' to 'generating'. Returns true if this caller won the claim. */
  async claimPending(id: string): Promise<boolean> {
    const res = this.db
      .update(runs)
      .set({ status: "generating" })
      .where(and(eq(runs.id, id), eq(runs.status, "pending")))
      .run();
    return res.changes === 1;
  }

  async markReady(id: string, stats: RunStats, finishedAt: string): Promise<void> {
    this.db.update(runs)
      .set({ status: "ready", statsJson: JSON.stringify(stats), finishedAt })
      .where(eq(runs.id, id)).run();
  }

  async markFailed(id: string, finishedAt: string): Promise<void> {
    this.db.update(runs).set({ status: "failed", finishedAt }).where(eq(runs.id, id)).run();
  }

  /** Mark all runs left mid-generation (e.g. after a crash) as failed. Returns how many were reset. */
  async failStaleGenerating(now: string): Promise<number> {
    const res = this.db
      .update(runs)
      .set({ status: "failed", finishedAt: now })
      .where(eq(runs.status, "generating"))
      .run();
    return res.changes;
  }

  async listByProject(projectId: string): Promise<Run[]> {
    return this.db.select().from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt)).all().map(this.#toRun);
  }

  async get(id: string): Promise<Run | null> {
    const row = this.db.select().from(runs).where(eq(runs.id, id)).get();
    return row ? this.#toRun(row) : null;
  }

  #toRun = (r: typeof runs.$inferSelect): Run => ({
    id: r.id,
    projectId: r.projectId,
    status: r.status as RunStatus,
    reportName: r.reportName,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    stats: r.statsJson ? (JSON.parse(r.statsJson) as RunStats) : null,
  });
}
