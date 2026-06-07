import { count, desc, eq } from "drizzle-orm";
import type { AuditAction, AuditActorType, AuditEntry } from "@allure-station/shared";
import type { Db } from "./client.js";
import { auditLog } from "./schema.sqlite.js";

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

  /** Recent-first. With projectId, only that project's events; otherwise the global log. */
  async list(opts: { projectId?: string; limit?: number; offset?: number } = {}): Promise<AuditEntry[]> {
    const where = opts.projectId !== undefined ? eq(auditLog.projectId, opts.projectId) : undefined;
    let query = this.db.select().from(auditLog).where(where).orderBy(desc(auditLog.at)).$dynamic();
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

  async count(opts: { projectId?: string } = {}): Promise<number> {
    const where = opts.projectId !== undefined ? eq(auditLog.projectId, opts.projectId) : undefined;
    const [row] = await this.db.select({ c: count() }).from(auditLog).where(where);
    return Number(row?.c ?? 0);
  }
}
