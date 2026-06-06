import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("meta routes", () => {
  it("GET /version returns the app + allure versions", async () => {
    const app = buildApp(makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: expect.any(String), allure: "3.9.0" });
    await app.close();
  });

  it("GET /config reports security disabled (Phase 1)", async () => {
    const app = buildApp(makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json()).toMatchObject({ securityEnabled: false });
    await app.close();
  });
});
