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
});
