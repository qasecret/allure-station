import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { buildOpenapiDocument } from "./registry.js";

// Normalize a Fastify route URL (":param", "*") to OpenAPI form ("{param}", "{wildcard}").
function toOpenapiPath(url: string): string {
  return url
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/\*$/, "/{wildcard}")
    .replace(/\*/g, "{wildcard}");
}

// Infra routes added by the swagger plugins — not part of the documented API surface.
function isInfraRoute(url: string): boolean {
  return url === "/api/openapi.json" || url === "/api/docs" || url.startsWith("/api/docs/");
}

describe("openapi drift guard", () => {
  it("documents every /api route", async () => {
    const collected: Array<{ method: string; url: string }> = [];
    const app = buildApp(await makeTestDeps());
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const m of methods) collected.push({ method: m, url: route.url });
    });
    await app.ready();

    const doc = buildOpenapiDocument({ version: "test" });
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const method of Object.keys(item as object)) {
        documented.add(`${method.toUpperCase()} ${path}`);
      }
    }

    const missing = collected
      .filter((r) => r.url.startsWith("/api"))
      .filter((r) => !isInfraRoute(r.url))
      .filter((r) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method))
      .map((r) => `${r.method} ${toOpenapiPath(r.url)}`)
      .filter((key) => !documented.has(key));

    try {
      expect(missing, `undocumented routes:\n${missing.join("\n")}`).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
