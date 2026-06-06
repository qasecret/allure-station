import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Project, Run, RunStats, RunStatus } from "@allure-station/shared";
import type { Db } from "./client.js";
import { projects, runs, testResults } from "./schema.sqlite.js";

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, now: string): Promise<Project> {
    await this.db.insert(projects).values({ id, createdAt: now });
    return { id, createdAt: now, latestRunId: null };
  }

  async list(): Promise<Project[]> {
    const rows = await this.db.select().from(projects).orderBy(projects.id);
    return Promise.all(rows.map((r) => this.#withLatest(r.id, r.createdAt)));
  }

  async get(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ? this.#withLatest(row.id, row.createdAt) : null;
  }

  async remove(id: string): Promise<void> {
    // libsql doesn't enforce FK ON DELETE CASCADE (pragma off), so delete children explicitly,
    // deepest first: test_results -> runs -> project.
    await this.db.delete(testResults).where(
      inArray(testResults.runId, this.db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, id))),
    );
    await this.db.delete(runs).where(eq(runs.projectId, id));
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async #withLatest(id: string, createdAt: string): Promise<Project> {
    const [latest] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, id))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    return { id, createdAt, latestRunId: latest?.id ?? null };
  }
}

export class RunRepository {
  constructor(private readonly db: Db) {}

  async create(projectId: string, id: string, reportName: string, now: string): Promise<Run> {
    await this.db.insert(runs).values({
      id, projectId, status: "pending", reportName, createdAt: now, startedAt: null, finishedAt: null, statsJson: null,
    });
    return { id, projectId, status: "pending", reportName, createdAt: now, finishedAt: null, stats: null };
  }

  async setStatus(id: string, status: RunStatus): Promise<void> {
    await this.db.update(runs).set({ status }).where(eq(runs.id, id));
  }

  /** Atomically transition a run from 'pending' to 'generating', stamping startedAt.
   * Returns true if this caller won the claim. startedAt is what age-bounded reconciliation reads. */
  async claimPending(id: string, startedAt: string): Promise<boolean> {
    const updated = await this.db
      .update(runs)
      .set({ status: "generating", startedAt })
      .where(and(eq(runs.id, id), eq(runs.status, "pending")))
      .returning();
    return updated.length === 1;
  }

  /** Most recent pending run for a project, or null. Uses the (project, status, created) index. */
  async findPendingByProject(projectId: string): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.status, "pending")))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    return row ? this.#toRun(row) : null;
  }

  async markReady(id: string, stats: RunStats, finishedAt: string): Promise<void> {
    await this.db.update(runs)
      .set({ status: "ready", statsJson: JSON.stringify(stats), finishedAt })
      .where(eq(runs.id, id));
  }

  async markFailed(id: string, finishedAt: string): Promise<void> {
    await this.db.update(runs).set({ status: "failed", finishedAt }).where(eq(runs.id, id));
  }

  /**
   * Fail runs stuck in 'generating' that started before `cutoff` (or have no startedAt — legacy/crashed
   * rows). Age-bounding is essential: in bullmq mode the API and N worker replicas share one DB, so a
   * blanket reset would fail runs another process is actively generating. Only runs older than the
   * staleness window are abandoned. Returns how many were reset.
   */
  async failStaleGenerating(cutoff: string, finishedAt: string): Promise<number> {
    const reset = await this.db
      .update(runs)
      .set({ status: "failed", finishedAt })
      .where(and(eq(runs.status, "generating"), or(lt(runs.startedAt, cutoff), isNull(runs.startedAt))))
      .returning();
    return reset.length;
  }

  async #selectRuns(opts: { projectId: string; readyOnly?: boolean; order: "asc" | "desc"; limit?: number }): Promise<Run[]> {
    const where = opts.readyOnly
      ? and(eq(runs.projectId, opts.projectId), eq(runs.status, "ready"))
      : eq(runs.projectId, opts.projectId);
    const ord = opts.order === "asc"
      ? [asc(runs.createdAt), asc(runs.id)]
      : [desc(runs.createdAt), desc(runs.id)];
    const base = this.db.select().from(runs).where(where).orderBy(...ord);
    const rows = opts.limit !== undefined ? await base.limit(opts.limit) : await base;
    return rows.map(this.#toRun);
  }

  /** Ready runs for a project, OLDEST first (chronological) — trend series source.
   * Pass `limit` to cap to the most-recent N runs (still returned oldest-first). */
  async listReadyByProject(projectId: string, limit?: number): Promise<Run[]> {
    if (limit !== undefined) {
      return (await this.#selectRuns({ projectId, readyOnly: true, order: "desc", limit })).reverse(); // newest-N, oldest-first
    }
    return this.#selectRuns({ projectId, readyOnly: true, order: "asc" });
  }

  async listByProject(projectId: string): Promise<Run[]> {
    return this.#selectRuns({ projectId, order: "desc" });
  }

  async get(id: string): Promise<Run | null> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
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
