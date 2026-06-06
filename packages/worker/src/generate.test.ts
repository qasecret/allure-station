import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport } from "./generate.js";

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
});
