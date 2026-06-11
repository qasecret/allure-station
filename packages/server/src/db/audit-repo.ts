import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import type { AuditAction, AuditActorType, AuditEntry } from "@allure-station/shared";
import type { Db } from "./client.js";
import { auditLog } from "./schema.sqlite.js";
import { likeContains } from "./repositories.js";

export interface AuditInput {
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async record(entry: AuditInput, at: string): Promise<void> {
    await this.db.insert(auditLog).values({
      id: this.newId(),
      at,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorLabel: entry.actorLabel,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      projectId: entry.projectId ?? null,
      metadata: entry.metadata == null ? null : JSON.stringify(entry.metadata),
    });
  }

  // Combine filters: projectId/since scope the query to a project; action/actor/from/to are the
  // user-facing filter params. `since` is the project-lifetime lower bound (not exposed to users);
  // `from`/`to` are the user-provided ISO-string time window — they lexicographically compare against
  // the stored `at` ISO strings (which is correct since all are UTC ISO 8601).
  #where(opts: { projectId?: string; since?: string; action?: AuditAction; actor?: string; from?: string; to?: string }) {
    const clauses = [];
    if (opts.projectId !== undefined) clauses.push(eq(auditLog.projectId, opts.projectId));
    if (opts.since !== undefined) clauses.push(gte(auditLog.at, opts.since));
    if (opts.action !== undefined) clauses.push(eq(auditLog.action, opts.action));
    if (opts.actor !== undefined) clauses.push(likeContains(auditLog.actorLabel, opts.actor));
    if (opts.from !== undefined) clauses.push(gte(auditLog.at, opts.from));
    if (opts.to !== undefined) clauses.push(lte(auditLog.at, opts.to));
    return clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  }

  /** Recent-first. With projectId, only that project's events; `since` bounds to a start time.
   *  Additional filter params: action (exact), actor (substring), from/to (ISO time window). */
  async list(opts: { projectId?: string; since?: string; action?: AuditAction; actor?: string; from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<AuditEntry[]> {
    // Tiebreaker on id so pagination is stable when several rows share a millisecond `at`.
    let query = this.db.select().from(auditLog).where(this.#where(opts)).orderBy(desc(auditLog.at), desc(auditLog.id)).$dynamic();
    // SQLite/libsql rejects OFFSET without LIMIT — offset only applies alongside a limit.
    if (opts.limit !== undefined) {
      query = query.limit(opts.limit);
      if (opts.offset !== undefined) query = query.offset(opts.offset);
    }
    const rows = await query;
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorType: r.actorType as AuditActorType,
      actorId: r.actorId,
      actorLabel: r.actorLabel,
      action: r.action as AuditAction,
      targetType: r.targetType,
      targetId: r.targetId,
      projectId: r.projectId,
      metadata: r.metadata == null ? null : (JSON.parse(r.metadata) as Record<string, unknown>),
    }));
  }

  async count(opts: { projectId?: string; since?: string; action?: AuditAction; actor?: string; from?: string; to?: string } = {}): Promise<number> {
    const [row] = await this.db.select({ c: count() }).from(auditLog).where(this.#where(opts));
    return Number(row?.c ?? 0);
  }
}
