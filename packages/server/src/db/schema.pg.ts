import { index, pgTable, text } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  reportName: text("report_name").notNull(),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  statsJson: text("stats_json"),
}, (t) => ({
  byProject: index("idx_runs_project").on(t.projectId),
  byProjectStatusCreated: index("idx_runs_project_status_created").on(t.projectId, t.status, t.createdAt),
}));
