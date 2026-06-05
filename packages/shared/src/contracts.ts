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

export const projectSchema = z.object({
  id: projectIdSchema,
  createdAt: z.string(),
  latestRunId: z.string().nullable(),
});

export type ProjectId = z.infer<typeof projectIdSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunStats = z.infer<typeof runStatsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
