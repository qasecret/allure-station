import { eq, lt } from "drizzle-orm";
import type { Db } from "./client.js";
import { sessions } from "./schema.sqlite.js";

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export class SessionRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  /** Store only the hash of the session token — a DB leak then can't be replayed as a live cookie. */
  async create(tokenHash: string, userId: string, now: string, expiresAt: string): Promise<SessionRow> {
    const id = this.newId();
    await this.db.insert(sessions).values({ id, tokenHash, userId, createdAt: now, expiresAt });
    return { id, userId, createdAt: now, expiresAt };
  }

  async findByHash(tokenHash: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select({ id: sessions.id, userId: sessions.userId, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    return row ?? null;
  }

  async removeByHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /** Lazy cleanup of expired rows (called opportunistically; a periodic sweeper is a follow-up). */
  async deleteExpired(nowIso: string): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, nowIso));
  }
}
