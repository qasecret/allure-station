import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { makeTestDeps } from "./test-helpers.js";

const fixturesDir = fileURLToPath(
  new URL("../../worker/test/fixtures/allure-results", import.meta.url),
);

describe("e2e: project -> results -> generate -> serve", () => {
  it("produces a ready run and a servable report", async () => {
    const app = buildApp(makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "e2e" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const boundary = "----b";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="1-result.json"\r\nContent-Type: application/json\r\n\r\n`),
      f1, Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="2-result.json"\r\nContent-Type: application/json\r\n\r\n`),
      f2, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const send = await app.inject({
      method: "POST", url: "/api/projects/e2e/send-results",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    const runId = send.json().runId as string;

    await app.inject({ method: "POST", url: "/api/projects/e2e/generate" });

    const run = await app.inject({ method: "GET", url: `/api/projects/e2e/runs/${runId}` });
    expect(run.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    const report = await app.inject({ method: "GET", url: `/api/projects/e2e/runs/${runId}/report/index.html` });
    expect(report.statusCode).toBe(200);
    await app.close();
  }, 90_000);
});
