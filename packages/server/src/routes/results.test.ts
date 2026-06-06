import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { multipart } from "../test-multipart.js";
import type { JobQueue } from "@allure-station/worker";

const fixturesDir = fileURLToPath(
  new URL("../../../worker/test/fixtures/allure-results", import.meta.url),
);

describe("send-results + generate", () => {
  it("ingests results, generates a report, and serves index.html", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });

    // Capture the live event stream the SSE route relays to the UI.
    const events: string[] = [];
    deps.bus.subscribe((e) => events.push(e.run.status));

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
      { field: "files", filename: "2-result.json", data: f2 },
    ]);

    const send = await app.inject({ method: "POST", url: "/api/projects/p/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const runId = send.json().runId as string;

    // fire-and-forget enqueue; returns 202 with generating status
    const gen = await app.inject({ method: "POST", url: `/api/projects/p/generate` });
    expect(gen.statusCode).toBe(202);
    expect(gen.json().status).toBe("generating");
    await deps.queue.onIdle();

    // The bus saw the full lifecycle: pending (on upload) -> generating -> ready.
    expect(events).toContain("generating");
    expect(events.at(-1)).toBe("ready");

    const run = await app.inject({ method: "GET", url: `/api/projects/p/runs/${runId}` });
    expect(run.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    // per-test results persisted for run comparison
    const persisted = await deps.testResults.listByRun(runId);
    expect(persisted).toHaveLength(2);
    expect(persisted.map((t) => t.status).sort()).toEqual(["failed", "passed"]);

    const report = await app.inject({ method: "GET", url: `/api/projects/p/runs/${runId}/report/index.html` });
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-type"]).toContain("text/html");
    await app.close();
  }, 60_000);

  it("sanitizes traversal filenames: ../escape.json is stored as escape.json and generation succeeds", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p2" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    // Use traversal filename for one file; the other is normal
    const mp = await multipart([
      { field: "files", filename: "../escape.json", data: f1 },
      { field: "files", filename: "2-result.json", data: f2 },
    ]);

    const send = await app.inject({ method: "POST", url: "/api/projects/p2/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const { runId: runId2, files } = send.json() as { runId: string; files: number };
    // Both files accepted (../escape.json becomes escape.json, not skipped)
    expect(files).toBe(2);

    // Generation should succeed (no crash from traversal)
    const gen = await app.inject({ method: "POST", url: `/api/projects/p2/generate` });
    expect(gen.statusCode).toBe(202);
    expect(gen.json().status).toBe("generating");
    await deps.queue.onIdle();

    const run = await app.inject({ method: "GET", url: `/api/projects/p2/runs/${runId2}` });
    expect(run.json().status).toBe("ready");

    await app.close();
  }, 60_000);

  it("serves report assets with correct MIME types (not application/octet-stream) and 404s missing files", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "mime" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
      { field: "files", filename: "2-result.json", data: f2 },
    ]);

    const send = await app.inject({ method: "POST", url: "/api/projects/mime/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const runId = send.json().runId as string;

    const gen = await app.inject({ method: "POST", url: "/api/projects/mime/generate" });
    expect(gen.statusCode).toBe(202);
    expect(gen.json().status).toBe("generating");
    await deps.queue.onIdle();

    // index.html served as text/html
    const htmlResp = await app.inject({ method: "GET", url: `/api/projects/mime/runs/${runId}/report/index.html` });
    expect(htmlResp.statusCode).toBe(200);
    expect(htmlResp.headers["content-type"]).toContain("text/html");

    // Find a .js file in the generated report and verify its content-type
    const { dir: reportDir, dispose } = await deps.storage.materializeDir(`mime/runs/${runId}/report`);
    const allFiles = await readdir(reportDir, { recursive: true });
    await dispose();
    const jsFile = (allFiles as string[]).find((f) => f.endsWith(".js"));
    expect(jsFile, "expected at least one .js file in the generated report").toBeTruthy();
    const jsResp = await app.inject({ method: "GET", url: `/api/projects/mime/runs/${runId}/report/${jsFile}` });
    expect(jsResp.statusCode).toBe(200);
    expect(jsResp.headers["content-type"]).toContain("javascript");
    expect(jsResp.headers["content-type"]).not.toBe("application/octet-stream");

    // Missing report file returns 404
    const missing = await app.inject({ method: "GET", url: `/api/projects/mime/runs/${runId}/report/does-not-exist.js` });
    expect(missing.statusCode).toBe(404);

    await app.close();
  }, 60_000);

  it("generate with no results staged marks the run failed (orphan-pending-run)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "orphan" } });

    // Create a pending run directly — never upload any result files
    const runId = deps.newId();
    await deps.runs.create("orphan", runId, "Orphan Report", deps.now());

    // POST /generate should not 409 (there is a pending run) but generation must fail
    const gen = await app.inject({ method: "POST", url: "/api/projects/orphan/generate" });
    expect(gen.statusCode).toBe(202);
    expect(gen.json().status).toBe("generating");
    await deps.queue.onIdle();

    const run = await app.inject({ method: "GET", url: `/api/projects/orphan/runs/${runId}` });
    expect(run.json().status).toBe("failed");

    await app.close();
  });

  it("POST /generate on unknown project returns 404", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "POST", url: "/api/projects/ghost/generate" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project not found");
    await app.close();
  });

  it("second POST /generate returns 409 after first succeeds (no pending run)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p3" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
    ]);

    const sendRes = await app.inject({ method: "POST", url: "/api/projects/p3/send-results", ...mp });
    const runId = sendRes.json().runId as string;

    // First generate: fire-and-forget, returns 202 generating; wait for completion
    const gen1 = await app.inject({ method: "POST", url: `/api/projects/p3/generate` });
    expect(gen1.statusCode).toBe(202);
    expect(gen1.json().status).toBe("generating");
    await deps.queue.onIdle();

    // Confirm the run is now ready
    const ready = await app.inject({ method: "GET", url: `/api/projects/p3/runs/${runId}` });
    expect(ready.json().status).toBe("ready");

    // Second generate finds no pending run -> 409
    const gen2 = await app.inject({ method: "POST", url: `/api/projects/p3/generate` });
    expect(gen2.statusCode).toBe(409);
    expect(gen2.json().error).toBe("no pending run to generate");

    await app.close();
  }, 60_000);

  it("POST /generate returns 503 and marks run failed when enqueue throws", async () => {
    const deps = await makeTestDeps();
    // Replace queue with a stub whose enqueue always rejects (simulates Redis down)
    deps.queue = {
      start() {},
      enqueue: async () => { throw new Error("redis down"); },
      onIdle: async () => {},
      close: async () => {},
    } as unknown as JobQueue;
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "eq-fail" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const mp = await multipart([{ field: "files", filename: "1-result.json", data: f1 }]);

    const send = await app.inject({ method: "POST", url: "/api/projects/eq-fail/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const runId = send.json().runId as string;

    const gen = await app.inject({ method: "POST", url: "/api/projects/eq-fail/generate" });
    expect(gen.statusCode).toBe(503);
    expect(gen.json().error).toBe("failed to enqueue generation");

    // Run must be marked failed (not stranded in 'generating')
    const run = await app.inject({ method: "GET", url: `/api/projects/eq-fail/runs/${runId}` });
    expect(run.json().status).toBe("failed");

    await app.close();
  });
});
