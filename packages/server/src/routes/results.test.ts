import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

const fixturesDir = fileURLToPath(
  new URL("../../../worker/test/fixtures/allure-results", import.meta.url),
);

async function multipart(files: { field: string; filename: string; data: Buffer }[]) {
  const boundary = "----asboundary";
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
      `Content-Type: application/json\r\n\r\n`));
    chunks.push(f.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("send-results + generate", () => {
  it("ingests results, generates a report, and serves index.html", async () => {
    const app = buildApp(makeTestDeps());
    await app.inject({ method: "POST", url: "/projects", payload: { id: "p" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
      { field: "files", filename: "2-result.json", data: f2 },
    ]);

    const send = await app.inject({ method: "POST", url: "/projects/p/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const runId = send.json().runId as string;

    // generate synchronously for the test
    const gen = await app.inject({ method: "POST", url: `/projects/p/generate` });
    expect(gen.statusCode).toBe(200);

    const run = await app.inject({ method: "GET", url: `/projects/p/runs/${runId}` });
    expect(run.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    const report = await app.inject({ method: "GET", url: `/projects/p/runs/${runId}/report/index.html` });
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-type"]).toContain("text/html");
    await app.close();
  }, 60_000);
});
