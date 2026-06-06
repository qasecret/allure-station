import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // pending|generating|ready|failed
  reportName: text("report_name").notNull(),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  statsJson: text("stats_json"), // JSON RunStats | null
});
