import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
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
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const f2 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000002-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
      { field: "files", filename: "2-result.json", data: f2 },
    ]);

    const send = await app.inject({ method: "POST", url: "/api/projects/p/send-results", ...mp });
    expect(send.statusCode).toBe(202);
    const runId = send.json().runId as string;

    // generate synchronously for the test
    const gen = await app.inject({ method: "POST", url: `/api/projects/p/generate` });
    expect(gen.statusCode).toBe(200);

    const run = await app.inject({ method: "GET", url: `/api/projects/p/runs/${runId}` });
    expect(run.json()).toMatchObject({ status: "ready", stats: { total: 2, passed: 1, failed: 1 } });

    const report = await app.inject({ method: "GET", url: `/api/projects/p/runs/${runId}/report/index.html` });
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-type"]).toContain("text/html");
    await app.close();
  }, 60_000);

  it("sanitizes traversal filenames: ../escape.json is stored as escape.json and generation succeeds", async () => {
    const app = buildApp(makeTestDeps());
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
    // Both files accepted (../escape.json becomes escape.json, not skipped)
    expect(send.json().files).toBe(2);

    // Generation should succeed (no crash from traversal)
    const gen = await app.inject({ method: "POST", url: `/api/projects/p2/generate` });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().status).toBe("ready");

    await app.close();
  }, 60_000);

  it("serves report assets with correct MIME types (not application/octet-stream) and 404s missing files", async () => {
    const deps = makeTestDeps();
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

    await app.inject({ method: "POST", url: "/api/projects/mime/generate" });

    // index.html served as text/html
    const htmlResp = await app.inject({ method: "GET", url: `/api/projects/mime/runs/${runId}/report/index.html` });
    expect(htmlResp.statusCode).toBe(200);
    expect(htmlResp.headers["content-type"]).toContain("text/html");

    // Find a .js file in the generated report and verify its content-type
    const reportDir = await deps.storage.resolveLocalPath(`mime/runs/${runId}/report`);
    const allFiles = await readdir(reportDir, { recursive: true });
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
    const deps = makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "orphan" } });

    // Create a pending run directly — never upload any result files
    const runId = deps.newId();
    await deps.runs.create("orphan", runId, "Orphan Report", deps.now());

    // POST /generate should not 409 (there is a pending run) but generation must fail
    const gen = await app.inject({ method: "POST", url: "/api/projects/orphan/generate" });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().status).toBe("failed");

    await app.close();
  });

  it("POST /generate on unknown project returns 404", async () => {
    const app = buildApp(makeTestDeps());
    const res = await app.inject({ method: "POST", url: "/api/projects/ghost/generate" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project not found");
    await app.close();
  });

  it("second POST /generate returns 409 after first succeeds (no pending run)", async () => {
    const app = buildApp(makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p3" } });

    const f1 = await readFile(join(fixturesDir, "00000000-0000-0000-0000-000000000001-result.json"));
    const mp = await multipart([
      { field: "files", filename: "1-result.json", data: f1 },
    ]);

    await app.inject({ method: "POST", url: "/api/projects/p3/send-results", ...mp });

    // First generate succeeds and run becomes ready
    const gen1 = await app.inject({ method: "POST", url: `/api/projects/p3/generate` });
    expect(gen1.statusCode).toBe(200);
    expect(gen1.json().status).toBe("ready");

    // Second generate finds no pending run -> 409
    const gen2 = await app.inject({ method: "POST", url: `/api/projects/p3/generate` });
    expect(gen2.statusCode).toBe(409);
    expect(gen2.json().error).toBe("no pending run to generate");

    await app.close();
  }, 60_000);
});
