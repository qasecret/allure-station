import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
  qualityGate: text("quality_gate"), // JSON QualityGateConfig | null
  visibility: text("visibility").notNull().default("public"), // public|private (read-gating)
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  reportName: text("report_name").notNull(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"), // set when claimed into 'generating'; powers age-bounded stale reconciliation
  finishedAt: text("finished_at"),
  statsJson: text("stats_json"),
  durationMs: integer("duration_ms"), // denormalized from statsJson.durationMs; backfilled; null until markReady
  branch: text("branch"),         // CI metadata — all nullable
  commit: text("commit"),
  environment: text("environment"),
  ciUrl: text("ci_url"),
  error: text("error"), // failure reason captured on markFailed (truncated); cleared on retry/ready
}, (t) => ({
  byProject: index("idx_runs_project").on(t.projectId),
  byProjectStatusCreated: index("idx_runs_project_status_created").on(t.projectId, t.status, t.createdAt),
  byProjectBranch: index("idx_runs_project_branch").on(t.projectId, t.branch),
  byProjectCreated: index("idx_runs_project_created").on(t.projectId, t.createdAt),
}));

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
}, (t) => ({
  byProject: index("idx_api_tokens_project").on(t.projectId),
  byHash: uniqueIndex("idx_api_tokens_hash").on(t.tokenHash),

}));

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  url: text("url").notNull(),
  events: text("events").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byProject: index("idx_notifications_project").on(t.projectId),
}));

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(), // admin|user (global role)
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byEmail: uniqueIndex("idx_users_email").on(t.email),
}));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => ({
  byHash: uniqueIndex("idx_sessions_hash").on(t.tokenHash),
  byUser: index("idx_sessions_user").on(t.userId),
}));

export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // owner|maintainer|viewer (per-project role)
  createdAt: text("created_at").notNull(),
}, (t) => ({
  byProjectUser: uniqueIndex("idx_memberships_project_user").on(t.projectId, t.userId),
  byUser: index("idx_memberships_user").on(t.userId),
}));

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  actorType: text("actor_type").notNull(), // user|token|anonymous
  actorId: text("actor_id"),
  actorLabel: text("actor_label").notNull(), // email / token prefix / "anonymous" (denormalized)
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  projectId: text("project_id"), // nullable; no FK — audit rows outlive the project they reference
  metadata: text("metadata"),    // JSON | null
}, (t) => ({
  byAt: index("idx_audit_at").on(t.at),
  byProjectAt: index("idx_audit_project_at").on(t.projectId, t.at),
}));

export const testResults = pgTable("test_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  historyId: text("history_id"),
  name: text("name").notNull(),
  fullName: text("full_name"),
  status: text("status").notNull(),
  duration: text("duration"),
  flaky: text("flaky").notNull(),
  message: text("message"),
  trace: text("trace"),
  // Slice-able dimensions lifted from Allure labels at ingest; all nullable so the migration ADDs
  // them onto existing rows without a default. Kept structurally identical to schema.sqlite.ts.
  severity: text("severity"),
  owner: text("owner"),
  suite: text("suite"),
  tags: text("tags"),    // JSON string[]
  muted: text("muted"),  // "true" | "false" | null
  known: text("known"),  // "true" | "false" | null
}, (t) => ({
  byRun: index("idx_test_results_run").on(t.runId),
  // Composite (match-key, run_id): covers the historyByKey match predicate AND the join key to runs
  // in one index scan, so the cross-run timeline query doesn't seek runs per matched row.
  byHistory: index("idx_test_results_history").on(t.historyId, t.runId),
  byFullName: index("idx_test_results_fullname").on(t.fullName, t.runId),
}));
