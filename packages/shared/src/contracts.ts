import { z } from "zod";

// Mirrors Allure's plugin id rule: no separators, not "." / "..".
export const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, "id must be lowercase alphanumeric, dash or underscore");

export const displayNameSchema = z.string().trim().min(1).max(120);
export const createProjectSchema = z.object({ id: projectIdSchema, displayName: displayNameSchema.optional() });
// PATCH body: empty string is allowed and means "clear" (normalized to null by the route).
export const updateProjectRequestSchema = z.object({ displayName: z.string().trim().max(120).nullable() });

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
  // Failure reason for a `failed` run (truncated); null/absent otherwise. nullable().optional() so
  // runs persisted before this field existed still parse — mirrors the CI-metadata fields above.
  error: z.string().nullable().optional(),
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
  // Failure detail captured on ingest (F0). nullable().optional() so summaries created before this
  // field existed (and helpers that omit it) still parse — mirrors runSchema's CI-metadata fields.
  message: z.string().nullable().optional(),
  trace: z.string().nullable().optional(),
  // Slice-able dimensions lifted from Allure's labels at ingest, so the analytics layer (trends,
  // compare, filtering) can group/filter by them without re-reading the report. All optional for the
  // same back-compat reason as message/trace: summaries persisted before this slice still parse.
  severity: z.string().nullable().optional(), // label "severity" (blocker…trivial; adapters may set arbitrary values)
  owner: z.string().nullable().optional(),    // label "owner"
  suite: z.string().nullable().optional(),    // label "suite" (falls back to "parentSuite")
  tags: z.array(z.string()).optional(),       // all "tag" labels; [] when none
  // Allure's known-issue flags for this test (driven by a known-issues list when one is configured).
  // Stored now so the planned known-issues/muting feature can suppress gate/notification noise.
  muted: z.boolean().optional(),
  known: z.boolean().optional(),
});

// One test's cross-run difference.
export const testDiffSchema = z.object({
  historyId: z.string().nullable(),
  name: z.string(),
  fullName: z.string().nullable(),
  baseStatus: testStatusSchema.nullable(),   // null = absent in base
  targetStatus: testStatusSchema.nullable(), // null = absent in target
  flaky: z.boolean(),                          // flaky in target (or base if absent in target)
  // Slice-able dimensions copied from the diffed test (target, falling back to base) so the compare
  // UI can show severity/suite/owner without a second read. Optional/back-compat like testSummarySchema.
  // `tags` is carried for a stable contract but not rendered yet (see the filter slice).
  severity: z.string().nullable().optional(),
  suite: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
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

// One run's outcome for a single test, plus that run's CI metadata — a row in the test's timeline.
// `message` (short, ≤2 KB) is inline; the heavy `trace` (≤16 KB) is fetched lazily per entry via
// the trace endpoint, so the timeline only carries a `hasTrace` flag to drive the expand affordance.
export const testHistoryEntrySchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  ciUrl: z.string().nullable(),
  status: testStatusSchema,
  duration: z.number().nullable(),
  flaky: z.boolean(),
  message: z.string().nullable(),
  hasTrace: z.boolean(),
});

// A minimal reference to a run, self-contained for the regression hint (date + short commit) so a
// consumer needs no entry lookup to render it.
export const runRefSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
});

// The most-recent passing→failing transition for a currently-failing test (the "bisect hint").
export const regressionSchema = z.object({
  windowLimited: z.boolean(),          // true when no passing run was found within the window
  firstFailed: runRefSchema,           // oldest run of the current failing streak
  lastPassed: runRefSchema.nullable(), // the passing run just before the streak; null when windowLimited
  failingRunCount: z.number().int().nonnegative(), // streak length, bounded by the fetched window
});

// A single test's cross-run timeline + flake rate over the returned window (newest run first).
export const testHistorySchema = z.object({
  identity: z.object({
    historyId: z.string().nullable(),
    fullName: z.string().nullable(),
    name: z.string(),
  }),
  window: z.number(),     // number of runs in `entries`
  flakeRate: z.number(),  // flakyCount / window, 0 when empty
  regression: regressionSchema.nullable(), // most-recent regression; null unless currently failing
  entries: z.array(testHistoryEntrySchema),
});

// Lazily-fetched stack trace for a single (run, test) cell of the timeline.
export const testTraceSchema = z.object({ trace: z.string().nullable() });

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

export const retentionConfigSchema = z.object({
  retentionDays: z.number().int().min(0).nullable().optional(),
  retentionMaxRuns: z.number().int().min(0).nullable().optional(),
});
export type RetentionConfig = z.infer<typeof retentionConfigSchema>;

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

export const projectVisibilitySchema = z.enum(["public", "private"]);
export const setVisibilityRequestSchema = z.object({ visibility: projectVisibilitySchema });

export const projectSchema = z.object({
  id: projectIdSchema,
  displayName: z.string().nullable().default(null),
  createdAt: z.string(),
  latestRunId: z.string().nullable(),
  // public = readable by anyone; private = reads require viewer+ / admin / project token.
  visibility: projectVisibilitySchema.default("public"),
  // Effective write permission for the caller. Optional — only the single-project GET (/projects/:id)
  // sets it; list responses leave it absent to avoid N×auth lookups per page.
  canWrite: z.boolean().optional(),
});

export const latestRunSummarySchema = z.object({
  id: z.string(),
  status: runStatusSchema,
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  stats: runStatsSchema.nullable(),
  gatePassed: z.boolean().nullable(), // null = no gate configured or no stats
});
export const projectListItemSchema = projectSchema.extend({
  latestRun: latestRunSummarySchema.nullable(),
  // The most-recent run whose status is 'ready' AND has stats. Null when no such run exists.
  // Unaffected by in-flight (pending/generating) or failed runs — lets UI always show the last
  // good report stats even when a newer run is in progress or failed to generate.
  lastReadyRun: latestRunSummarySchema.nullable(),
});
export const projectSortSchema = z.enum(["name", "worst", "active"]);
export type LatestRunSummary = z.infer<typeof latestRunSummarySchema>;
export type ProjectListItem = z.infer<typeof projectListItemSchema>;
export type ProjectSort = z.infer<typeof projectSortSchema>;

// Pushed to the UI over SSE on every run lifecycle transition (created/generating/ready/failed).
// `deleted: true` signals that the run has been hard-deleted so live UIs can remove it rather
// than upserting a stale row (the SSE handler upserts all other events).
//
// .passthrough() is intentional: during a rolling deploy an OLD replica re-validates events
// published by a NEWER replica. Strip-mode (the zod default) would silently drop unknown fields
// added in the newer version; passthrough ensures those fields survive the round-trip so the
// event bus never narrows the schema on the forwarding path.
export const runEventSchema = z.object({
  type: z.literal("run"),
  projectId: z.string(),
  run: runSchema,
  deleted: z.boolean().optional(),
}).passthrough();

// API token as shown to clients (never includes the hash or plaintext).
export const apiTokenSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
// Returned ONCE on creation — includes the plaintext token.
export const createdTokenSchema = apiTokenSchema.extend({ token: z.string() });
/** Allowed API-token lifetimes (days). Single source: the zod union, the client param type, and the
 *  UI's expiry options all derive from this — add a value here and every layer stays in sync. */
export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
export type TokenExpiryDays = (typeof TOKEN_EXPIRY_DAYS)[number];
export const createTokenRequestSchema = z.object({
  name: z.string().min(1).max(64),
  expiresInDays: z
    .union(TOKEN_EXPIRY_DAYS.map((d) => z.literal(d)) as [z.ZodLiteral<30>, z.ZodLiteral<90>, z.ZodLiteral<365>])
    .optional(),
});

// --- Accounts & RBAC (Phase 5b) ---
export const globalRoleSchema = z.enum(["admin", "user"]);
export const projectRoleSchema = z.enum(["owner", "maintainer", "viewer"]);

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: globalRoleSchema,
  createdAt: z.string(),
  // "oidc" when the account was provisioned via SSO (no usable local password); null/absent = local.
  authProvider: z.enum(["oidc"]).nullable().optional(),
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

// --- Session info (returned by GET /auth/sessions — no tokenHash exposed) ---
export const sessionInfoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// --- Audit log (Phase 5c) ---
export const auditActionSchema = z.enum([
  "login", "login_failed", "logout",
  "user_created", "user_deleted",
  "token_created", "token_deleted",
  "member_set", "member_removed",
  "project_created", "project_deleted", "project_renamed",
  "project_visibility_set",
  "quality_gate_set",
  "notification_created", "notification_deleted",
  "run_deleted", "run_pruned",
  "retention_updated",
  "password_changed",
  "password_change_failed",
  "session_revoked",
]);
export const auditActorTypeSchema = z.enum(["user", "token", "anonymous", "system"]);
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

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
export type RunMetadata = z.infer<typeof runMetadataSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;
export type SetVisibilityRequest = z.infer<typeof setVisibilityRequestSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type TestStatus = z.infer<typeof testStatusSchema>;
export type TestSummary = z.infer<typeof testSummarySchema>;
export type TestDiff = z.infer<typeof testDiffSchema>;
export type CompareResult = z.infer<typeof compareResultSchema>;
export type TestHistoryEntry = z.infer<typeof testHistoryEntrySchema>;
export type TestHistory = z.infer<typeof testHistorySchema>;
export type TestTrace = z.infer<typeof testTraceSchema>;
export type RunRef = z.infer<typeof runRefSchema>;
export type Regression = z.infer<typeof regressionSchema>;
export type ApiToken = z.infer<typeof apiTokenSchema>;
export type CreatedToken = z.infer<typeof createdTokenSchema>;
export type QualityGateConfig = z.infer<typeof qualityGateConfigSchema>;
export type QualityGateCheck = z.infer<typeof qualityGateCheckSchema>;
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

export const overviewSchema = z.object({
  projects: z.number().int(),
  failing: z.number().int(),
  gateBreached: z.number().int(),
  runsLast24h: z.number().int(),
  generating: z.number().int(),
});
export type Overview = z.infer<typeof overviewSchema>;

export const runSortSchema = z.enum(["createdAt", "duration", "status"]);
export const sortOrderSchema = z.enum(["asc", "desc"]);
export type RunSort = z.infer<typeof runSortSchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
