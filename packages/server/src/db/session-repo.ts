import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { Db } from "./client.js";
import { sessions } from "./schema.sqlite.js";

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
}

export class SessionRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  /** Store only the hash of the session token — a DB leak then can't be replayed as a live cookie. */
  async create(
    tokenHash: string,
    userId: string,
    now: string,
    expiresAt: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<SessionRow> {
    const id = this.newId();
    const userAgent = meta.userAgent ?? null;
    const ip = meta.ip ?? null;
    await this.db.insert(sessions).values({ id, tokenHash, userId, createdAt: now, expiresAt, userAgent, ip });
    return { id, tokenHash, userId, createdAt: now, expiresAt, userAgent, ip };
  }

  async findByHash(tokenHash: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select({
        id: sessions.id,
        tokenHash: sessions.tokenHash,
        userId: sessions.userId,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    return row ?? null;
  }

  async removeByHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /** All sessions for a user, newest first. Caller decides what's "current" by hash. */
  async listByUser(userId: string): Promise<SessionRow[]> {
    return this.db
      .select({
        id: sessions.id,
        tokenHash: sessions.tokenHash,
        userId: sessions.userId,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt), desc(sessions.id));
  }

  /** Delete one session by id, scoped to the owning user (revoking others' is a silent no-op → 404 upstream). */
  async removeById(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /** Delete all of a user's sessions except the given one. Returns the revoked count. */
  async removeAllExcept(userId: string, keepId: string): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Lazy cleanup of expired rows (called opportunistically; a periodic sweeper is a follow-up). */
  async deleteExpired(nowIso: string): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, nowIso));
  }
}
