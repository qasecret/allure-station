import { and, eq } from "drizzle-orm";
import type { Membership, MembershipWithUser, ProjectRole } from "@allure-station/shared";
import type { Db } from "./client.js";
import { memberships, users } from "./schema.sqlite.js";

export class MembershipRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  /** Set a user's role on a project (insert or update — one role per (project,user)). */
  async upsert(projectId: string, userId: string, role: ProjectRole, now: string): Promise<Membership> {
    const existing = await this.find(projectId, userId);
    if (existing) {
      await this.db.update(memberships).set({ role }).where(eq(memberships.id, existing.id));
      return { ...existing, role };
    }
    const id = this.newId();
    await this.db.insert(memberships).values({ id, projectId, userId, role, createdAt: now });
    return { id, projectId, userId, role, createdAt: now };
  }

  async find(projectId: string, userId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)));
    return row ? { id: row.id, projectId: row.projectId, userId: row.userId, role: row.role as ProjectRole, createdAt: row.createdAt } : null;
  }

  /** List a project's members joined with their email, for the management UI. */
  async listByProject(projectId: string): Promise<MembershipWithUser[]> {
    const rows = await this.db
      .select({
        id: memberships.id,
        projectId: memberships.projectId,
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.projectId, projectId))
      .orderBy(users.email);
    return rows.map((r) => ({ ...r, role: r.role as ProjectRole }));
  }

  async remove(projectId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
      .returning();
    return deleted.length > 0;
  }
}
