import { describe, it, expect } from "vitest";
import { buildOpenapiDocument } from "./registry.js";

describe("buildOpenapiDocument", () => {
  it("produces a valid OpenAPI 3.1 document", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("9.9.9");
    expect(doc.info.title).toMatch(/allure/i);
  });

  it("documents the meta routes", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    expect(doc.paths?.["/api/version"]?.get).toBeDefined();
    expect(doc.paths?.["/api/config"]?.get).toBeDefined();
  });

  it("declares both security schemes", () => {
    const doc = buildOpenapiDocument({ version: "9.9.9" });
    const schemes = doc.components?.securitySchemes ?? {};
    expect(schemes.bearerToken).toBeDefined();
    expect(schemes.sessionCookie).toBeDefined();
  });

  it("declares POST /api/projects with security, body, and standard error responses", () => {
    const doc = buildOpenapiDocument({ version: "x" });
    const op = doc.paths?.["/api/projects"]?.post;
    expect(op).toBeDefined();

    // Both security schemes are offered as alternatives.
    const securityKeys = (op?.security ?? []).flatMap((s) => Object.keys(s));
    expect(securityKeys).toContain("bearerToken");
    expect(securityKeys).toContain("sessionCookie");

    // Request body present, as application/json.
    const body = op?.requestBody as { content?: Record<string, unknown> } | undefined;
    expect(body?.content?.["application/json"]).toBeDefined();

    // 201 success plus the standard JSON error responses referencing the Error schema.
    const responses = op?.responses ?? {};
    expect(responses["201"]).toBeDefined();
    for (const status of ["400", "401", "404"] as const) {
      const schemaRef = (
        responses[status] as {
          content?: { "application/json"?: { schema?: { $ref?: string } } };
        }
      )?.content?.["application/json"]?.schema?.$ref;
      expect(schemaRef).toMatch(/Error$/);
    }
  });

  it("declares a 204 route (DELETE /api/projects/{id}) with no content schema", () => {
    const doc = buildOpenapiDocument({ version: "x" });
    const op = doc.paths?.["/api/projects/{id}"]?.delete;
    expect(op).toBeDefined();
    const ok = op?.responses?.["204"] as { content?: unknown } | undefined;
    expect(ok).toBeDefined();
    expect(ok?.content).toBeUndefined();
  });
});
