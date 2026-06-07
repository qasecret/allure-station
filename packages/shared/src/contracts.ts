import { z } from "zod";

// Mirrors Allure's plugin id rule: no separators, not "." / "..".
export const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, "id must be lowercase alphanumeric, dash or underscore");

export const createProjectSchema = z.object({ id: projectIdSchema });

export const runStatusSchema = z.enum(["pending", "generating", "ready", "failed"]);

export const runStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  broken: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  // Count of tests Allure flagged flaky (retry/statusDetails.flaky) in this run. Optional so runs
  // generated before this field existed still parse; consumers coalesce to 0.
  flaky: z.number().int().nonnegative().optional(),
  // Total test execution time (sum of per-test durations, ms). Optional for the same back-compat reason.
  durationMs: z.number().int().nonnegative().optional(),
});

// CI context attached to a run at upload time. Each field optional on ingest; capped to bound the
// values that flow into JSON/UI. Empty strings are normalized to null by the server.
export const runMetadataSchema = z.object({
  branch: z.string().max(256).optional(),
  commit: z.string().max(256).optional(),
  environment: z.string().max(256).optional(),
  ciUrl: z.string().max(2048).optional(),
});

export const runSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  status: runStatusSchema,
  reportName: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  stats: runStatsSchema.nullable(),
  // CI metadata — nullable; optional so runs created before this field existed still parse.
  branch: z.string().nullable().optional(),
  commit: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
  ciUrl: z.string().nullable().optional(),
});

export const testStatusSchema = z.enum(["passed", "failed", "broken", "skipped", "unknown"]);

// One test's outcome within a run (persisted per run, returned by generation).
export const testSummarySchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  status: testStatusSchema,
  duration: z.number().nullable(),
  flaky: z.boolean(),
});

// One test's cross-run difference.
export const testDiffSchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  baseStatus: testStatusSchema.nullable(),   // null = absent in base
  targetStatus: testStatusSchema.nullable(), // null = absent in target
  flaky: z.boolean(),                          // flaky in target (or base if absent in target)
});

export const compareResultSchema = z.object({
  base: z.object({ runId: z.string(), createdAt: z.string() }),
  target: z.object({ runId: z.string(), createdAt: z.string() }),
  newlyFailing: z.array(testDiffSchema), // base passed/skipped -> target failed/broken
  fixed: z.array(testDiffSchema),        // base failed/broken  -> target passed
  stillFailing: z.array(testDiffSchema), // failing in both
  added: z.array(testDiffSchema),        // absent in base
  removed: z.array(testDiffSchema),      // absent in target
  flaky: z.array(testDiffSchema),        // flagged flaky in target
});

// .strict() so a typo'd rule (e.g. {maxFailurez:0}) is a 400, not silently stripped to {} — which
// would clear the gate and let everything pass.
export const qualityGateConfigSchema = z.object({
  maxFailures: z.number().int().nonnegative().optional(),
  minTests: z.number().int().nonnegative().optional(),
  minPassRate: z.number().min(0).max(1).optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
}).strict();
export const qualityGateCheckSchema = z.object({
  rule: z.string(),
  ok: z.boolean(),
  actual: z.number(),
  threshold: z.number(),
});
export const qualityGateVerdictSchema = z.object({
  configured: z.boolean(),
  passed: z.boolean(),
  checks: z.array(qualityGateCheckSchema),
});

export const runSummarySchema = z.object({
  run: runSchema,
  reportPath: z.string(),
  previousReadyRunId: z.string().nullable(),
  qualityGate: qualityGateVerdictSchema,
});

export const notificationTriggerSchema = z.enum(["completed", "failed", "gate_failed", "regression"]);
export const notificationKindSchema = z.enum(["slack", "webhook"]);
export const notificationSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  kind: notificationKindSchema,
  url: z.string().url(),
  events: z.array(notificationTriggerSchema).min(1),
  createdAt: z.string(),
});
export const createNotificationRequestSchema = z.object({
  kind: notificationKindSchema,
  url: z.string().url(),
  events: z.array(notificationTriggerSchema).min(1).default(["failed", "gate_failed", "regression"]),
}).strict();

export const trendPointSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  stats: runStatsSchema,
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const projectSchema = z.object({
  id: projectIdSchema,
  createdAt: z.string(),
  latestRunId: z.string().nullable(),
});

// Pushed to the UI over SSE on every run lifecycle transition (created/generating/ready/failed).
export const runEventSchema = z.object({
  type: z.literal("run"),
  projectId: z.string(),
  run: runSchema,
});

// API token as shown to clients (never includes the hash or plaintext).
export const apiTokenSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
// Returned ONCE on creation — includes the plaintext token.
export const createdTokenSchema = apiTokenSchema.extend({ token: z.string() });
export const createTokenRequestSchema = z.object({ name: z.string().min(1).max(64) });

// --- Accounts & RBAC (Phase 5b) ---
export const globalRoleSchema = z.enum(["admin", "user"]);
export const projectRoleSchema = z.enum(["owner", "maintainer", "viewer"]);

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: globalRoleSchema,
  createdAt: z.string(),
});
// The authenticated principal returned by GET /auth/me (or null when anonymous).
export const sessionUserSchema = userSchema;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const createUserRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: globalRoleSchema.default("user"),
});

export const membershipSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  userId: z.string(),
  role: projectRoleSchema,
  createdAt: z.string(),
});
// Member listing joins the user so the UI can show emails without N+1 lookups.
export const membershipWithUserSchema = membershipSchema.extend({ email: z.string().email() });
export const setMembershipRequestSchema = z.object({
  email: z.string().email(),
  role: projectRoleSchema,
});

// --- Audit log (Phase 5c) ---
export const auditActionSchema = z.enum([
  "login", "login_failed", "logout",
  "user_created", "user_deleted",
  "token_created", "token_deleted",
  "member_set", "member_removed",
  "project_created", "project_deleted",
  "quality_gate_set",
  "notification_created", "notification_deleted",
]);
export const auditActorTypeSchema = z.enum(["user", "token", "anonymous"]);
export const auditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  actorType: auditActorTypeSchema,
  actorId: z.string().nullable(),
  actorLabel: z.string(),
  action: auditActionSchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  projectId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export type ProjectId = z.infer<typeof projectIdSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
export type RunMetadata = z.infer<typeof runMetadataSchema>;
export type Project = z.infer<typeof projectSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type TestStatus = z.infer<typeof testStatusSchema>;
export type TestSummary = z.infer<typeof testSummarySchema>;
export type TestDiff = z.infer<typeof testDiffSchema>;
export type CompareResult = z.infer<typeof compareResultSchema>;
export type ApiToken = z.infer<typeof apiTokenSchema>;
export type CreatedToken = z.infer<typeof createdTokenSchema>;
export type QualityGateConfig = z.infer<typeof qualityGateConfigSchema>;
export type QualityGateVerdict = z.infer<typeof qualityGateVerdictSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type NotificationTrigger = z.infer<typeof notificationTriggerSchema>;
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type GlobalRole = z.infer<typeof globalRoleSchema>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type MembershipWithUser = z.infer<typeof membershipWithUserSchema>;
export type SetMembershipRequest = z.infer<typeof setMembershipRequestSchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
