import { count, eq } from "drizzle-orm";
import type { GlobalRole, User } from "@allure-station/shared";
import type { Db } from "./client.js";
import { memberships, sessions, users } from "./schema.sqlite.js";

// Internal row including the password hash — never returned over the API. Routes map to `User`.
export interface UserRow extends User {
  passwordHash: string;
}

export class UserRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async create(email: string, passwordHash: string, role: GlobalRole, now: string): Promise<User> {
    const id = this.newId();
    await this.db.insert(users).values({ id, email, passwordHash, role, createdAt: now });
    return { id, email, role, createdAt: now };
  }

  /** Upsert by email (used by the startup admin seed — idempotent across restarts). */
  async upsertByEmail(email: string, passwordHash: string, role: GlobalRole, now: string): Promise<User> {
    const existing = await this.findByEmail(email);
    if (existing) {
      await this.db.update(users).set({ passwordHash, role }).where(eq(users.id, existing.id));
      return { id: existing.id, email, role, createdAt: existing.createdAt };
    }
    return this.create(email, passwordHash, role, now);
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email));
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
