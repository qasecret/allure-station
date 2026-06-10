import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("openapi plugin", () => {
  it("serves the OpenAPI document at /api/openapi.json", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/version"]).toBeDefined();
    await app.close();
  });

  it("serves the Swagger UI at /api/docs", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    // swagger-ui redirects /docs -> /docs/ (or serves 200 HTML)
    expect([200, 302]).toContain(res.statusCode);
    await app.close();
  });
});
