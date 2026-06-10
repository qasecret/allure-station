import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

extendZodWithOpenApi(z);

// Reused response/inline schemas not present in the shared contracts.
const errorSchema = z.object({ error: z.string() }).openapi("Error");
const versionResponse = z.object({ version: z.string(), allure: z.string() });
const configResponse = z.object({
  securityEnabled: z.boolean(),
  oidc: z.object({ enabled: z.boolean(), label: z.string().optional() }),
  allure: z.string(),
});

export interface OpenapiOptions {
  version: string;
}

export function buildOpenapiDocument(opts: OpenapiOptions): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "bearerToken", {
    type: "http",
    scheme: "bearer",
    description: "Per-project CI API token: `Authorization: Bearer <token>`.",
  });
  registry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "session",
    description: "Browser session cookie set by /api/auth/login.",
  });

  registry.registerPath({
    method: "get",
    path: "/api/version",
    tags: ["meta"],
    summary: "Server and embedded Allure versions",
    responses: {
      200: { description: "OK", content: { "application/json": { schema: versionResponse } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/config",
    tags: ["meta"],
    summary: "Public runtime configuration",
    responses: {
      200: { description: "OK", content: { "application/json": { schema: configResponse } } },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Allure Station API",
      version: opts.version,
      description: "Self-hosted multi-project Allure 3 report hub.",
    },
  });
}

// Exported for reuse by route-declaration helpers in later tasks.
export { errorSchema };
