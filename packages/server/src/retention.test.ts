import { describe, it, expect, vi } from "vitest";
import { sweepRetention } from "./retention.js";
import type { AppDeps } from "./app.js";
import type { AppConfig } from "./config.js";

function makeRun(id: string, projectId: string, createdAt: string) {
  return { id, projectId, status: "ready" as const, reportName: "R", createdAt, finishedAt: null, stats: null, branch: null, commit: null, environment: null, ciUrl: null, error: null };
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    projects: { listAllIds: vi.fn().mockResolvedValue([]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any,
    runs: { findExpiredByAge: vi.fn().mockResolvedValue([]), findExcessByCount: vi.fn().mockResolvedValue([]), remove: vi.fn().mockResolvedValue(true) } as any,
    storage: { remove: vi.fn().mockResolvedValue(undefined) } as any,
    audit: { record: vi.fn().mockResolvedValue(undefined) } as any,
    bus: { publish: vi.fn() } as any,
    now: () => "2026-06-13T00:00:00.000Z",
    newId: () => "audit-id",
    ...overrides,
  } as AppDeps;
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { retentionDays: 30, retentionMaxRuns: 50, retentionSweepIntervalMs: 60_000, ...overrides } as AppConfig;
}

describe("sweepRetention", () => {
  it("does nothing when both caps are 0 (disabled)", async () => {
    const deps = makeDeps({ projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 0, retentionMaxRuns: 0 }));
    expect(pruned).toBe(0);
    expect(deps.runs.findExpiredByAge).not.toHaveBeenCalled();
  });

  it("prunes runs older than retentionDays", async () => {
    const old = makeRun("r1", "p1", "2026-04-01T00:00:00.000Z");
    const deps = makeDeps({
      projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any,
      runs: { findExpiredByAge: vi.fn().mockResolvedValue([old]), findExcessByCount: vi.fn().mockResolvedValue([]), remove: vi.fn().mockResolvedValue(true) } as any,
    });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 30, retentionMaxRuns: 0 }));
    expect(pruned).toBe(1);
    expect(deps.runs.remove).toHaveBeenCalledWith("r1");
    expect(deps.storage.remove).toHaveBeenCalledWith("p1/runs/r1");
  });

  it("prunes runs exceeding retentionMaxRuns", async () => {
    const excess = makeRun("r-old", "p1", "2026-06-01T00:00:00.000Z");
    const deps = makeDeps({
      projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any,
      runs: { findExpiredByAge: vi.fn().mockResolvedValue([]), findExcessByCount: vi.fn().mockResolvedValue([excess]), remove: vi.fn().mockResolvedValue(true) } as any,
    });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 0, retentionMaxRuns: 10 }));
    expect(pruned).toBe(1);
    expect(deps.runs.remove).toHaveBeenCalledWith("r-old");
  });

  it("deduplicates runs found by both age and count", async () => {
    const run = makeRun("r1", "p1", "2026-04-01T00:00:00.000Z");
    const deps = makeDeps({
      projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any,
      runs: { findExpiredByAge: vi.fn().mockResolvedValue([run]), findExcessByCount: vi.fn().mockResolvedValue([run]), remove: vi.fn().mockResolvedValue(true) } as any,
    });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 30, retentionMaxRuns: 5 }));
    expect(pruned).toBe(1);
    expect(deps.runs.remove).toHaveBeenCalledTimes(1);
  });

  it("respects per-project overrides", async () => {
    const deps = makeDeps({
      projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: 0, retentionMaxRuns: 0 }) } as any,
    });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 30, retentionMaxRuns: 50 }));
    expect(pruned).toBe(0);
    expect(deps.runs.findExpiredByAge).not.toHaveBeenCalled();
  });

  it("skips runs that fail to remove (generating)", async () => {
    const run = makeRun("r1", "p1", "2026-04-01T00:00:00.000Z");
    const deps = makeDeps({
      projects: { listAllIds: vi.fn().mockResolvedValue(["p1"]), getRetention: vi.fn().mockResolvedValue({ retentionDays: null, retentionMaxRuns: null }) } as any,
      runs: { findExpiredByAge: vi.fn().mockResolvedValue([run]), findExcessByCount: vi.fn().mockResolvedValue([]), remove: vi.fn().mockResolvedValue(false) } as any,
    });
    const pruned = await sweepRetention(deps, makeConfig({ retentionDays: 30, retentionMaxRuns: 0 }));
    expect(pruned).toBe(0);
    expect(deps.storage.remove).not.toHaveBeenCalled();
  });
});
