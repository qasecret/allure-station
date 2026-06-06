import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  startedAt: text("started_at"), // set when claimed into 'generating'; powers age-bounded stale reconciliation
  finishedAt: text("finished_at"),
  statsJson: text("stats_json"), // JSON RunStats | null
}, (t) => ({
  byProjectStatusCreated: index("idx_runs_project_status_created").on(t.projectId, t.status, t.createdAt),
}));

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
}, (t) => ({
  byProject: index("idx_api_tokens_project").on(t.projectId),
  byHash: uniqueIndex("idx_api_tokens_hash").on(t.tokenHash), // unique: a token credential resolves to exactly one row

}));

export const testResults = sqliteTable("test_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  historyId: text("history_id"),
  name: text("name").notNull(),
  fullName: text("full_name"),
  status: text("status").notNull(), // passed|failed|broken|skipped|unknown
  duration: text("duration"),        // ms, stringified | null
  flaky: text("flaky").notNull(),    // "true" | "false"
}, (t) => ({
  byRun: index("idx_test_results_run").on(t.runId),
}));
