import { and, count, eq } from "drizzle-orm";
import type { Notification, NotificationKind, NotificationTrigger } from "@allure-station/shared";
import type { Db } from "./client.js";
import { notifications } from "./schema.sqlite.js";

export class NotificationRepository {
  constructor(private readonly db: Db, private readonly newId: () => string) {}

  async create(projectId: string, kind: NotificationKind, url: string, events: NotificationTrigger[], now: string): Promise<Notification> {
    const id = this.newId();
    await this.db.insert(notifications).values({ id, projectId, kind, url, events: JSON.stringify(events), createdAt: now });
    return { id, projectId, kind, url, events, createdAt: now };
  }

  async listByProject(projectId: string): Promise<Notification[]> {
    const rows = await this.db.select().from(notifications).where(eq(notifications.projectId, projectId)).orderBy(notifications.createdAt);
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      kind: r.kind as NotificationKind,
      url: r.url,
      events: JSON.parse(r.events) as NotificationTrigger[],
      createdAt: r.createdAt,
    }));
  }

  async countByProject(projectId: string): Promise<number> {
    const [row] = await this.db.select({ c: count() }).from(notifications).where(eq(notifications.projectId, projectId));
    return Number(row?.c ?? 0);
  }

  async remove(projectId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.projectId, projectId)))
      .returning();
    return deleted.length > 0;
  }
}
