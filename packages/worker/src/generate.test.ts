import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport, truncate } from "./generate.js";

const fixtures = fileURLToPath(new URL("../test/fixtures/allure-results", import.meta.url));
let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "as-out-"));
});
afterEach(async () => { await rm(out, { recursive: true, force: true }); });

describe("generateReport", () => {
  it("generates an Awesome report and returns stats", async () => {
    const result = await generateReport({
      resultsDirs: [fixtures],
      outputDir: out,
      reportName: "Test",
      dumps: [],
    });

    // index.html exists -> the awesome plugin wrote a report
    await access(join(out, "index.html"));
    expect((await readdir(out)).length).toBeGreaterThan(0);

    expect(result.stats.total).toBe(2);
    expect(result.stats.passed).toBe(1);
    expect(result.stats.failed).toBe(1);

    // per-test summaries are returned for run comparison
    expect(result.tests).toHaveLength(2);
    const byName = Object.fromEntries(result.tests.map((t) => [t.name, t]));
    expect(byName["passing test"].status).toBe("passed");
    expect(byName["failing test"].status).toBe("failed");
    // Allure recomputes historyId as a stable hash — assert it's a non-empty string.
    expect(typeof byName["passing test"].historyId).toBe("string");
    expect(byName["passing test"].historyId!.length).toBeGreaterThan(0);
  }, 60_000);

  it("captures the failing test's error message on ingest", async () => {
    const result = await generateReport({ resultsDirs: [fixtures], outputDir: out, reportName: "Test", dumps: [] });
    const byName = Object.fromEntries(result.tests.map((t) => [t.name, t]));
    expect(byName["failing test"].message).toBe("boom");
    expect(byName["failing test"].trace ?? null).toBeNull();
    expect(byName["passing test"].message ?? null).toBeNull();
  }, 60_000);

  describe("truncate", () => {
    it("returns null for empty/undefined", () => {
      expect(truncate(undefined, 10)).toBeNull();
      expect(truncate("", 10)).toBeNull();
    });
    it("passes short text through and caps long text with a marker", () => {
      expect(truncate("short", 100)).toBe("short");
      const long = "x".repeat(5000);
      const capped = truncate(long, 2048)!;
      expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(2048 + Buffer.byteLength("\n…[truncated]", "utf8"));
      expect(capped.endsWith("…[truncated]")).toBe(true);
    });
  });

  it("counts flaky tests (statusDetails.flaky) into stats.flaky and per-test flaky", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "as-flaky-"));
    await writeFile(join(resultsDir, "f1-result.json"), JSON.stringify({
      uuid: "f1", historyId: "case-flaky", name: "flaky test", fullName: "suite#flaky",
      status: "passed", stage: "finished", statusDetails: { flaky: true }, start: 1000, stop: 2000,
    }));
    await writeFile(join(resultsDir, "f2-result.json"), JSON.stringify({
      uuid: "f2", historyId: "case-stable", name: "stable test", fullName: "suite#stable",
      status: "passed", stage: "finished", start: 1000, stop: 2000,
    }));
    try {
      const result = await generateReport({ resultsDirs: [resultsDir], outputDir: out, reportName: "Flaky", dumps: [] });
      expect(result.stats.flaky).toBe(1);
      expect(result.stats.durationMs).toBe(2000); // two tests, 1000ms each (stop-start)
      expect(result.tests.find((t) => t.name === "flaky test")?.flaky).toBe(true);
      expect(result.tests.find((t) => t.name === "stable test")?.flaky).toBe(false);
    } finally {
      await rm(resultsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
