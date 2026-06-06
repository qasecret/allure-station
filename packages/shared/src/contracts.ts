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

export const runSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  status: runStatusSchema,
  reportName: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  stats: runStatsSchema.nullable(),
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

export type ProjectId = z.infer<typeof projectIdSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
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
