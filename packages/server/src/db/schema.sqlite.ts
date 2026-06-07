import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  qualityGate: text("quality_gate"), // JSON QualityGateConfig | null
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

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),     // slack|webhook
  url: text("url").notNull(),
  events: text("events").notNull(), // JSON array of triggers
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byProject: index("idx_notifications_project").on(t.projectId),
}));

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(), // admin|user (global role)
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byEmail: uniqueIndex("idx_users_email").on(t.email),
}));

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => ({
  byHash: uniqueIndex("idx_sessions_hash").on(t.tokenHash), // unique: a cookie resolves to exactly one session
  byUser: index("idx_sessions_user").on(t.userId),
}));

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // owner|maintainer|viewer (per-project role)
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byProjectUser: uniqueIndex("idx_memberships_project_user").on(t.projectId, t.userId), // one role per (project,user)
  byUser: index("idx_memberships_user").on(t.userId),
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
