import { count, eq } from "drizzle-orm";
import type { GlobalRole, User } from "@allure-station/shared";
import type { Db } from "./client.js";
import { memberships, sessions, users } from "./schema.sqlite.js";

// Internal row including the password hash — never returned over the API. Routes map to `User`.
export interface UserRow extends User {
  passwordHash: string;
}

// Emails are stored and looked up lowercased so login/seed/membership-by-email are case-insensitive
// and the unique index can't hold two casings of the same address.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class UserRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async create(email: string, passwordHash: string, role: GlobalRole, now: string): Promise<User> {
    const id = this.newId();
    const norm = normalizeEmail(email);
    await this.db.insert(users).values({ id, email: norm, passwordHash, role, createdAt: now });
    return { id, email: norm, role, createdAt: now };
  }

  /**
   * Atomic upsert by email — used by the startup admin seed. INSERT … ON CONFLICT DO UPDATE so
   * concurrent boots (API + N workers in bullmq mode) can't race into a unique-violation crash.
   */
  async upsertByEmail(email: string, passwordHash: string, role: GlobalRole, now: string): Promise<User> {
    const norm = normalizeEmail(email);
    await this.db
      .insert(users)
      .values({ id: this.newId(), email: norm, passwordHash, role, createdAt: now })
      .onConflictDoUpdate({ target: users.email, set: { passwordHash, role } });
    // Re-read to return the canonical row (id/createdAt belong to whichever insert won).
    return (await this.findByEmail(norm))!;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, normalizeEmail(email)));
    return row ? this.#toRow(row) : null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? this.#toRow(row) : null;
  }

  async list(): Promise<User[]> {
    const rows = await this.db.select().from(users).orderBy(users.email);
    return rows.map((r) => ({ id: r.id, email: r.email, role: r.role as GlobalRole, createdAt: r.createdAt }));
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ c: count() }).from(users);
    return Number(row?.c ?? 0);
  }

  /** Delete a user and (because libsql doesn't cascade) their sessions + memberships. */
  async remove(id: string): Promise<boolean> {
    await this.db.delete(sessions).where(eq(sessions.userId, id));
    await this.db.delete(memberships).where(eq(memberships.userId, id));
    const deleted = await this.db.delete(users).where(eq(users.id, id)).returning();
    return deleted.length > 0;
  }

  #toRow(r: typeof users.$inferSelect): UserRow {
    return { id: r.id, email: r.email, role: r.role as GlobalRole, createdAt: r.createdAt, passwordHash: r.passwordHash };
  }
}
