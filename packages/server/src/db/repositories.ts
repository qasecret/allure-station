import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Project, QualityGateConfig, Run, RunStats, RunStatus } from "@allure-station/shared";
import type { Db } from "./client.js";
import { apiTokens, projects, runs, testResults } from "./schema.sqlite.js";

// Case-sensitive substring LIKE with wildcards escaped, so user input like "a_b" matches literally
// rather than treating _/% as wildcards. Works on sqlite + pg via the ESCAPE clause.
function likeContains(column: AnySQLiteColumn, q: string) {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, now: string): Promise<Project> {
    await this.db.insert(projects).values({ id, createdAt: now });
    return { id, createdAt: now, latestRunId: null };
  }

  async list(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<Project[]> {
    const where = opts.q ? likeContains(projects.id, opts.q) : undefined;
    let query = this.db.select().from(projects).where(where).orderBy(projects.id).$dynamic();
    // SQLite/libsql rejects OFFSET without LIMIT (syntax error), and LIMIT -1 isn't valid on pg —
    // so offset only applies alongside a limit (which is how pagination is actually used).
    if (opts.limit !== undefined) {
      query = query.limit(opts.limit);
      if (opts.offset !== undefined) query = query.offset(opts.offset);
    }
    const rows = await query;
    return Promise.all(rows.map((r) => this.#withLatest(r.id, r.createdAt)));
  }

  async count(opts: { q?: string } = {}): Promise<number> {
    const where = opts.q ? likeContains(projects.id, opts.q) : undefined;
    const [row] = await this.db.select({ c: count() }).from(projects).where(where);
    return Number(row?.c ?? 0);
  }

  async get(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ? this.#withLatest(row.id, row.createdAt) : null;
  }

  async remove(id: string): Promise<void> {
    // libsql doesn't enforce FK ON DELETE CASCADE (pragma off), so delete children explicitly,
    // deepest first: test_results -> runs -> project. (Sequential, not a transaction: the libsql
    // `:memory:` driver opens a fresh connection per transaction; project removal is a rare,
    // operator-initiated action where a partial delete is recoverable by re-running.)
    await this.db.delete(testResults).where(
      inArray(testResults.runId, this.db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, id))),
    );
    await this.db.delete(apiTokens).where(eq(apiTokens.projectId, id));
    await this.db.delete(runs).where(eq(runs.projectId, id));
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async getQualityGate(id: string): Promise<QualityGateConfig | null> {
    const [row] = await this.db.select({ qg: projects.qualityGate }).from(projects).where(eq(projects.id, id));
    return row?.qg ? (JSON.parse(row.qg) as QualityGateConfig) : null;
  }

  async setQualityGate(id: string, config: QualityGateConfig | null): Promise<void> {
    await this.db.update(projects).set({ qualityGate: config ? JSON.stringify(config) : null }).where(eq(projects.id, id));
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

  async #selectRuns(opts: { projectId: string; readyOnly?: boolean; status?: RunStatus; order: "asc" | "desc"; limit?: number; offset?: number }): Promise<Run[]> {
    const conds = [eq(runs.projectId, opts.projectId)];
    if (opts.readyOnly) conds.push(eq(runs.status, "ready"));
    if (opts.status) conds.push(eq(runs.status, opts.status));
    const ord = opts.order === "asc"
      ? [asc(runs.createdAt), asc(runs.id)]
      : [desc(runs.createdAt), desc(runs.id)];
    let query = this.db.select().from(runs).where(and(...conds)).orderBy(...ord).$dynamic();
    // offset only with limit — SQLite rejects OFFSET without LIMIT (see ProjectRepository.list).
    if (opts.limit !== undefined) {
      query = query.limit(opts.limit);
      if (opts.offset !== undefined) query = query.offset(opts.offset);
    }
    return (await query).map(this.#toRun);
  }

  /** Ready runs for a project, OLDEST first (chronological) — trend series source.
   * Pass `limit` to cap to the most-recent N runs (still returned oldest-first). */
  async listReadyByProject(projectId: string, limit?: number): Promise<Run[]> {
    if (limit !== undefined) {
      return (await this.#selectRuns({ projectId, readyOnly: true, order: "desc", limit })).reverse(); // newest-N, oldest-first
    }
    return this.#selectRuns({ projectId, readyOnly: true, order: "asc" });
  }

  async listByProject(projectId: string, opts: { status?: RunStatus; limit?: number; offset?: number } = {}): Promise<Run[]> {
    return this.#selectRuns({ projectId, order: "desc", ...opts });
  }

  /** The newest ready run created strictly before `createdAt` (the run immediately prior). */
  async previousReadyBefore(projectId: string, createdAt: string): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.status, "ready"), lt(runs.createdAt, createdAt)))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    return row ? this.#toRun(row) : null;
  }

  async countByProject(projectId: string, opts: { status?: RunStatus } = {}): Promise<number> {
    const conds = [eq(runs.projectId, projectId)];
    if (opts.status) conds.push(eq(runs.status, opts.status));
    const [row] = await this.db.select({ c: count() }).from(runs).where(and(...conds));
    return Number(row?.c ?? 0);
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
