import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { LatestRunSummary, Project, ProjectListItem, ProjectSort, ProjectVisibility, QualityGateConfig, Run, RunMetadata, RunStats, RunStatus } from "@allure-station/shared";
import { evaluateGate } from "@allure-station/shared";

// Who may see which projects in a listing. admin → all; member → public ∪ their projects;
// public → public only (anonymous / token).
export type VisibilityScope = { mode: "all" } | { mode: "public" } | { mode: "member"; projectIds: string[] };
import type { Db } from "./client.js";
import { apiTokens, memberships, notifications, projects, runs, testResults } from "./schema.sqlite.js";

// Case-sensitive substring LIKE with wildcards escaped, so user input like "a_b" matches literally
// rather than treating _/% as wildcards. Works on sqlite + pg via the ESCAPE clause.
export function likeContains(column: AnySQLiteColumn, q: string) {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, now: string, displayName: string | null = null): Promise<Project> {
    await this.db.insert(projects).values({ id, createdAt: now, visibility: "public", displayName });
    return { id, displayName, createdAt: now, latestRunId: null, visibility: "public" };
  }

  async setDisplayName(id: string, displayName: string | null): Promise<void> {
    await this.db.update(projects).set({ displayName }).where(eq(projects.id, id));
  }

  // Combine the optional substring filter with the visibility scope into a single WHERE.
  #where(q: string | undefined, scope: VisibilityScope | undefined) {
    const clauses = [];
    if (q) clauses.push(likeContains(projects.id, q));
    if (scope?.mode === "public") clauses.push(eq(projects.visibility, "public"));
    if (scope?.mode === "member") {
      clauses.push(scope.projectIds.length > 0
        ? or(eq(projects.visibility, "public"), inArray(projects.id, scope.projectIds))!
        : eq(projects.visibility, "public"));
    }
    return clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  }

  async get(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ? this.#withLatest(row.id, row.createdAt, row.visibility as ProjectVisibility, row.displayName ?? null) : null;
  }

  async setVisibility(id: string, visibility: ProjectVisibility): Promise<void> {
    await this.db.update(projects).set({ visibility }).where(eq(projects.id, id));
  }

  /** Cheap id+visibility lookup for the read gate — avoids #withLatest's latest-run subquery on the
   *  hot report-asset path. Returns null if the project doesn't exist. */
  async getVisibility(id: string): Promise<{ id: string; visibility: ProjectVisibility } | null> {
    const [row] = await this.db.select({ id: projects.id, visibility: projects.visibility }).from(projects).where(eq(projects.id, id));
    return row ? { id: row.id, visibility: row.visibility as ProjectVisibility } : null;
  }

  async remove(id: string): Promise<void> {
    // FK ON DELETE CASCADE is enforced (foreign_keys pragma ON). The explicit child deletes below are
    // belt-and-braces — they keep the order deterministic and guard against any future schema that
    // adds a child table before its cascade is wired. (Sequential, not a transaction: the libsql
    // `:memory:` driver opens a fresh connection per transaction; project removal is a rare,
    // operator-initiated action where a partial delete is recoverable by re-running.)
    await this.db.delete(testResults).where(
      inArray(testResults.runId, this.db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, id))),
    );
    await this.db.delete(apiTokens).where(eq(apiTokens.projectId, id));
    await this.db.delete(notifications).where(eq(notifications.projectId, id));
    await this.db.delete(memberships).where(eq(memberships.projectId, id));
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

  /** One-pass enriched listing: a drizzle CTE with ROW_NUMBER() picks each project's latest run
   *  (rn=1) — both SQLite (≥3.25) and Postgres support ROW_NUMBER. A second CTE (ranked_ready)
   *  picks the most-recent ready run with stats. Sorting happens in JS over the full filtered set
   *  (instance project counts are small); pagination slices afterwards.
   *
   *  Judgment point resolution: instead of db.all() (libsql-only) we use drizzle's $with() CTE
   *  which generates portable SQL on both dialects via the query builder — no raw db.all() call. */
  async listEnriched(opts: { q?: string; scope?: VisibilityScope; sort?: ProjectSort; limit?: number; offset?: number } = {}): Promise<{ items: ProjectListItem[]; total: number }> {
    const rows = await this.db.select().from(projects).where(this.#where(opts.q, opts.scope)).orderBy(projects.id);
    if (rows.length === 0) return { items: [], total: 0 };

    const ids = rows.map((p) => p.id);

    // CTE: rank each run per project by (created_at DESC, id DESC) — rn=1 is the latest.
    // ROW_NUMBER() is supported by SQLite ≥3.25 and Postgres; drizzle generates the correct
    // SQL for each dialect from the same query builder call (no dialect-specific raw SQL).
    const ranked = this.db.$with("ranked").as(
      this.db.select({
        projectId: runs.projectId,
        id: runs.id,
        status: runs.status,
        createdAt: runs.createdAt,
        finishedAt: runs.finishedAt,
        statsJson: runs.statsJson,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${runs.projectId} ORDER BY ${runs.createdAt} DESC, ${runs.id} DESC)`.as("rn"),
      })
        .from(runs)
        .where(inArray(runs.projectId, ids)),
    );

    // CTE: rank only ready runs that have stats — rn=1 is the most-recent ready+stats run.
    // Used for lastReadyRun (the last run with a complete report, unaffected by in-flight runs).
    const rankedReady = this.db.$with("ranked_ready").as(
      this.db.select({
        projectId: runs.projectId,
        id: runs.id,
        status: runs.status,
        createdAt: runs.createdAt,
        finishedAt: runs.finishedAt,
        statsJson: runs.statsJson,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${runs.projectId} ORDER BY ${runs.createdAt} DESC, ${runs.id} DESC)`.as("rn"),
      })
        .from(runs)
        .where(and(inArray(runs.projectId, ids), eq(runs.status, "ready"), isNotNull(runs.statsJson))),
    );

    const [latest, lastReady] = await Promise.all([
      this.db.with(ranked).select().from(ranked).where(eq(ranked.rn, 1)),
      this.db.with(rankedReady).select().from(rankedReady).where(eq(rankedReady.rn, 1)),
    ]);

    const latestByProject = new Map(latest.map((r) => [r.projectId, r]));
    const lastReadyByProject = new Map(lastReady.map((r) => [r.projectId, r]));

    const makeRunSummary = (lr: typeof latest[0], gateCfg: QualityGateConfig | null): LatestRunSummary => {
      const stats = lr.statsJson ? (JSON.parse(lr.statsJson) as RunStats) : null;
      const verdict = gateCfg && stats ? evaluateGate(stats, gateCfg) : null;
      const gatePassed = verdict?.configured ? verdict.passed : null;
      return { id: lr.id, status: lr.status as RunStatus, createdAt: lr.createdAt, finishedAt: lr.finishedAt ?? null, stats, gatePassed };
    };

    const items: ProjectListItem[] = rows.map((p) => {
      const lr = latestByProject.get(p.id);
      const lrr = lastReadyByProject.get(p.id);
      const gateCfg = p.qualityGate ? (JSON.parse(p.qualityGate) as QualityGateConfig) : null;
      return {
        id: p.id,
        displayName: p.displayName ?? null,
        createdAt: p.createdAt,
        visibility: p.visibility as ProjectVisibility,
        latestRunId: lr?.id ?? null,
        latestRun: lr ? makeRunSummary(lr, gateCfg) : null,
        lastReadyRun: lrr ? makeRunSummary(lrr, gateCfg) : null,
      };
    });

    const passRate = (i: ProjectListItem) =>
      i.latestRun?.stats ? i.latestRun.stats.passed / Math.max(1, i.latestRun.stats.total) : null;

    if (opts.sort === "worst") {
      // Three tiers: 0 = gate breached, 1 = generation failed, 2 = everything else.
      // Within tier 2: lowest pass-rate first, then no-runs last, then id.
      const tier = (i: ProjectListItem) => {
        if (i.latestRun?.gatePassed === false) return 0;
        if (i.latestRun?.status === "failed") return 1;
        return 2;
      };
      items.sort((a, b) => {
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        if (ta < 2) return a.id.localeCompare(b.id); // within tier 0/1 sort by id
        // tier 2: pass-rate ascending, no-runs last, then id
        const ra = passRate(a), rb = passRate(b);
        if (ra === null && rb === null) return a.id.localeCompare(b.id);
        if (ra === null) return 1; // no-runs last
        if (rb === null) return -1;
        if (ra !== rb) return ra - rb; // lowest pass-rate first
        return a.id.localeCompare(b.id);
      });
    } else if (opts.sort === "active") {
      items.sort((a, b) => {
        const ca = a.latestRun?.createdAt, cb = b.latestRun?.createdAt;
        if (!ca && !cb) return a.id.localeCompare(b.id);
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.localeCompare(ca); // newest first
      });
    } // "name"/default: already ordered by id

    const total = items.length;
    const offset = opts.offset ?? 0;
    const paged = opts.limit !== undefined ? items.slice(offset, offset + opts.limit) : items;
    return { items: paged, total };
  }

  async listAllIds(): Promise<string[]> {
    const rows = await this.db.select({ id: projects.id }).from(projects);
    return rows.map((r) => r.id);
  }

  async getRetention(id: string): Promise<{ retentionDays: number | null; retentionMaxRuns: number | null }> {
    const [row] = await this.db.select({ retentionDays: projects.retentionDays, retentionMaxRuns: projects.retentionMaxRuns }).from(projects).where(eq(projects.id, id));
    return row ? { retentionDays: row.retentionDays, retentionMaxRuns: row.retentionMaxRuns } : { retentionDays: null, retentionMaxRuns: null };
  }

  async setRetention(id: string, retentionDays: number | null, retentionMaxRuns: number | null): Promise<void> {
    await this.db.update(projects).set({ retentionDays, retentionMaxRuns }).where(eq(projects.id, id));
  }

  async #withLatest(id: string, createdAt: string, visibility: ProjectVisibility, displayName: string | null): Promise<Project> {
    const [latest] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, id))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    return { id, displayName, createdAt, latestRunId: latest?.id ?? null, visibility };
  }
}

/** Cap a stored failure reason so a pathological stack trace can't bloat the row. */
const ERROR_MAX_LEN = 2000;

export class RunRepository {
  constructor(private readonly db: Db) {}

  async create(projectId: string, id: string, reportName: string, now: string, metadata: RunMetadata = {}): Promise<Run> {
    // Empty strings normalize to null so a blank CI field isn't stored as "".
    const meta = {
      branch: metadata.branch || null,
      commit: metadata.commit || null,
      environment: metadata.environment || null,
      ciUrl: metadata.ciUrl || null,
    };
    await this.db.insert(runs).values({
      id, projectId, status: "pending", reportName, createdAt: now, startedAt: null, finishedAt: null, statsJson: null, ...meta,
    });
    return { id, projectId, status: "pending", reportName, createdAt: now, finishedAt: null, stats: null, error: null, ...meta };
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
      .set({ status: "ready", statsJson: JSON.stringify(stats), durationMs: stats.durationMs ?? null, finishedAt, error: null }) // clear any prior failure (e.g. a retried run)
      .where(eq(runs.id, id));
  }

  async markFailed(id: string, finishedAt: string, error?: string): Promise<void> {
    // Faithfully store whatever reason was passed (even ""), only defaulting null when none is given.
    await this.db.update(runs)
      .set({ status: "failed", finishedAt, error: error == null ? null : error.slice(0, ERROR_MAX_LEN) })
      .where(eq(runs.id, id));
  }

  /** Atomically transition a 'failed' run back to 'generating' for a retry, clearing the prior error
   * and finishedAt. Returns true if this caller won the claim (mirrors claimPending for pending runs). */
  async retryFailed(id: string, startedAt: string): Promise<boolean> {
    const updated = await this.db
      .update(runs)
      .set({ status: "generating", startedAt, finishedAt: null, error: null })
      .where(and(eq(runs.id, id), eq(runs.status, "failed")))
      .returning();
    return updated.length === 1;
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

  async #selectRuns(opts: { projectId: string; readyOnly?: boolean; status?: RunStatus; branch?: string; sort?: "createdAt" | "duration" | "status"; order: "asc" | "desc"; limit?: number; offset?: number }): Promise<Run[]> {
    const conds = [eq(runs.projectId, opts.projectId)];
    if (opts.readyOnly) conds.push(eq(runs.status, "ready"));
    if (opts.status) conds.push(eq(runs.status, opts.status));
    if (opts.branch) conds.push(eq(runs.branch, opts.branch));

    let ord: ReturnType<typeof asc>[];
    if (opts.sort === "duration") {
      // Nulls-last: `(duration_ms IS NULL)` evaluates to 0 for non-null, 1 for null — always sorted
      // ascending (nulls go last), regardless of the requested direction for the value column.
      // Works identically on SQLite and Postgres.
      const nullLast = sql<number>`(${runs.durationMs} IS NULL)`;
      const durCol = opts.order === "asc" ? asc(runs.durationMs) : desc(runs.durationMs);
      ord = [asc(nullLast), durCol, desc(runs.createdAt), desc(runs.id)];
    } else if (opts.sort === "status") {
      const statusCol = opts.order === "asc" ? asc(runs.status) : desc(runs.status);
      ord = [statusCol, desc(runs.createdAt), desc(runs.id)];
    } else {
      // default: createdAt
      ord = opts.order === "asc"
        ? [asc(runs.createdAt), asc(runs.id)]
        : [desc(runs.createdAt), desc(runs.id)];
    }

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

  async listByProject(projectId: string, opts: { status?: RunStatus; branch?: string; sort?: "createdAt" | "duration" | "status"; order?: "asc" | "desc"; limit?: number; offset?: number } = {}): Promise<Run[]> {
    return this.#selectRuns({ ...opts, projectId, order: opts.order ?? "desc" });
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

  async countByProject(projectId: string, opts: { status?: RunStatus; branch?: string } = {}): Promise<number> {
    const conds = [eq(runs.projectId, projectId)];
    if (opts.status) conds.push(eq(runs.status, opts.status));
    if (opts.branch) conds.push(eq(runs.branch, opts.branch));
    const [row] = await this.db.select({ c: count() }).from(runs).where(and(...conds));
    return Number(row?.c ?? 0);
  }

  async get(id: string): Promise<Run | null> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
    return row ? this.#toRun(row) : null;
  }

  /** Atomic guard against a concurrent claim: refuses to delete a run that is generating. */
  async remove(id: string): Promise<boolean> {
    const res = await this.db.delete(runs).where(and(eq(runs.id, id), ne(runs.status, "generating"))).returning({ id: runs.id });
    return res.length > 0;
  }

  async findExpiredByAge(projectId: string, cutoff: string): Promise<Run[]> {
    const rows = await this.db.select().from(runs)
      .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, cutoff), ne(runs.status, "generating")))
      .orderBy(asc(runs.createdAt));
    return rows.map(this.#toRun);
  }

  async findExcessByCount(projectId: string, maxRuns: number): Promise<Run[]> {
    const rows = await this.db.select().from(runs)
      .where(and(eq(runs.projectId, projectId), ne(runs.status, "generating")))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1_000_000).offset(maxRuns);
    return rows.map(this.#toRun);
  }

  /** Triage counts for the overview: runs created in the window + currently generating, limited to
   *  the given (visibility-scoped) projects. */
  async countTriage(projectIds: string[], since: string): Promise<{ last24h: number; generating: number }> {
    if (projectIds.length === 0) return { last24h: 0, generating: 0 };
    const [a] = await this.db.select({ c: count() }).from(runs)
      .where(and(inArray(runs.projectId, projectIds), gte(runs.createdAt, since)));
    const [b] = await this.db.select({ c: count() }).from(runs)
      .where(and(inArray(runs.projectId, projectIds), eq(runs.status, "generating")));
    return { last24h: Number(a?.c ?? 0), generating: Number(b?.c ?? 0) };
  }

  #toRun = (r: typeof runs.$inferSelect): Run => ({
    id: r.id,
    projectId: r.projectId,
    status: r.status as RunStatus,
    reportName: r.reportName,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    stats: r.statsJson ? (JSON.parse(r.statsJson) as RunStats) : null,
    branch: r.branch,
    commit: r.commit,
    environment: r.environment,
    ciUrl: r.ciUrl,
    error: r.error ?? null,
  });
}
