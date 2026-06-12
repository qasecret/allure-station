import { and, count, eq, gt, isNull, or } from "drizzle-orm";
import type { ApiToken } from "@allure-station/shared";
import type { Db } from "./client.js";
import { apiTokens } from "./schema.sqlite.js";

export class ApiTokenRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async create(projectId: string, name: string, tokenHash: string, prefix: string, now: string, expiresAt: string | null = null): Promise<ApiToken> {
    const id = this.newId();
    await this.db.insert(apiTokens).values({ id, projectId, name, tokenHash, prefix, createdAt: now, lastUsedAt: null, expiresAt });
    return { id, projectId, name, prefix, createdAt: now, lastUsedAt: null, expiresAt };
  }

  async listByProject(projectId: string): Promise<ApiToken[]> {
    const rows = await this.db.select().from(apiTokens).where(eq(apiTokens.projectId, projectId)).orderBy(apiTokens.createdAt);
    return rows.map((r) => ({
      id: r.id, projectId: r.projectId, name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt ?? null,
    }));
  }

  /**
   * Count tokens for a project. When `now` is provided, only live tokens are counted (expired
   * tokens excluded) so a project whose only token expired reopens to anonymous writes in
   * zero-config mode — consistent with the no-token state.
   */
  async countByProject(projectId: string, now?: string): Promise<number> {
    const projectFilter = eq(apiTokens.projectId, projectId);
    const expiryFilter = now
      ? or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now))
      : undefined;
    const where = expiryFilter ? and(projectFilter, expiryFilter) : projectFilter;
    const [row] = await this.db.select({ c: count() }).from(apiTokens).where(where);
    return Number(row?.c ?? 0);
  }

  /** Resolve a token by its hash (for auth). Returns id + projectId + expiresAt, or null. */
  async findByHash(tokenHash: string): Promise<{ id: string; projectId: string; expiresAt: string | null } | null> {
    const [row] = await this.db
      .select({ id: apiTokens.id, projectId: apiTokens.projectId, expiresAt: apiTokens.expiresAt })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash));
    return row ? { id: row.id, projectId: row.projectId, expiresAt: row.expiresAt ?? null } : null;
  }

  /** Delete a token scoped to its project. Returns true if a row was removed (404 vs 204). */
  async remove(projectId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.projectId, projectId)))
      .returning();
    return deleted.length > 0;
  }

  async touchLastUsed(id: string, now: string): Promise<void> {
    await this.db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, id));
  }
}
