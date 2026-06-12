import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("meta routes", () => {
  it("GET /version returns the app + allure versions", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: expect.any(String), allure: "3.9.0" });
    await app.close();
  });

  it("GET /config reports security disabled (Phase 1)", async () => {
    const app = buildApp(await makeTestDeps());
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json()).toMatchObject({ securityEnabled: false });
    await app.close();
  });

  it("serves branding with zero-config defaults and env overrides", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json().branding).toEqual({ name: "Allure Station", tagline: "Your test reports, beautifully hosted.", logoUrl: null });
    await app.close();

    const deps2 = await makeTestDeps({ branding: { name: "Acme QA", tagline: "Ship it.", logoUrl: "https://cdn.acme/logo.svg" } });
    const app2 = buildApp(deps2);
    expect((await app2.inject({ method: "GET", url: "/api/config" })).json().branding.name).toBe("Acme QA");
    await app2.close();
  });
});
