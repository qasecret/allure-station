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
  }, 60_000);
});
