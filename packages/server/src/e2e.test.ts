import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { makeTestDeps } from "./test-helpers.js";

const fixturesDir = fileURLToPath(
  new URL("../../worker/test/fixtures/allure-results", import.meta.url),
);

async function buildMultipartBody(f1: Buffer, f2: Buffer): Promise<{ body: Buffer; boundary: string }> {
  const boundary = "----b";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="1-result.json"\r\nContent-Type: application/json\r\n\r\n`),
    f1, Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="2-result.json"\r\nContent-Type: application/json\r\n\r\n`),
    f2, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

describe("e2e: project -> results -> generate -> serve", () => {
  it("produces a ready run and a servable report", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "e2e" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const { body, boundary } = await buildMultipartBody(f1, f2);
    const send = await app.inject({
      method: "POST", url: "/api/projects/e2e/send-results",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    const runId = send.json().runId as string;

    // fire-and-forget; returns 202 with generating status
    const gen = await app.inject({ method: "POST", url: "/api/projects/e2e/generate" });
    expect(gen.statusCode).toBe(202);
    expect(gen.json().status).toBe("generating");
    await deps.queue.onIdle();

    const run = await app.inject({ method: "GET", url: `/api/projects/e2e/runs/${runId}` });
    expect(run.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    const report = await app.inject({ method: "GET", url: `/api/projects/e2e/runs/${runId}/report/index.html` });
    expect(report.statusCode).toBe(200);
    await app.close();
  }, 90_000);

  it("two-run trends: DB trends series has 2 points with correct stats and distinct runIds", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "trend2" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));

    // Run 1: send results and generate
    const { body: body1, boundary: boundary1 } = await buildMultipartBody(f1, f2);
    const send1 = await app.inject({
      method: "POST", url: "/api/projects/trend2/send-results",
      headers: { "content-type": `multipart/form-data; boundary=${boundary1}` }, payload: body1,
    });
    expect(send1.statusCode).toBe(202);
    const runId1 = send1.json().runId as string;

    const gen1 = await app.inject({ method: "POST", url: "/api/projects/trend2/generate" });
    expect(gen1.statusCode).toBe(202);
    expect(gen1.json().status).toBe("generating");
    await deps.queue.onIdle();

    // Confirm run 1 is ready
    const run1 = await app.inject({ method: "GET", url: `/api/projects/trend2/runs/${runId1}` });
    expect(run1.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    // Run 2: send the same two fixture files again and generate a second run
    const { body: body2, boundary: boundary2 } = await buildMultipartBody(f1, f2);
    const send2 = await app.inject({
      method: "POST", url: "/api/projects/trend2/send-results",
      headers: { "content-type": `multipart/form-data; boundary=${boundary2}` }, payload: body2,
    });
    expect(send2.statusCode).toBe(202);
    const runId2 = send2.json().runId as string;

    const gen2 = await app.inject({ method: "POST", url: "/api/projects/trend2/generate" });
    expect(gen2.statusCode).toBe(202);
    expect(gen2.json().status).toBe("generating");
    await deps.queue.onIdle();

    // Confirm run 2 is ready
    const run2 = await app.inject({ method: "GET", url: `/api/projects/trend2/runs/${runId2}` });
    expect(run2.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    // Assert the two runIds are distinct
    expect(runId1).not.toBe(runId2);

    // GET /trends and assert a 2-point series, oldest-first
    const trends = await app.inject({ method: "GET", url: "/api/projects/trend2/trends" });
    expect(trends.statusCode).toBe(200);
    const series = trends.json() as Array<{ runId: string; createdAt: string; stats: { total: number; passed: number; failed: number } }>;
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ runId: runId1, stats: { total: 2, passed: 1, failed: 1 } });
    expect(series[1]).toMatchObject({ runId: runId2, stats: { total: 2, passed: 1, failed: 1 } });
    expect(series[0].createdAt).toBeDefined();
    expect(series[1].createdAt).toBeDefined();

    await app.close();
  }, 90_000);
});
