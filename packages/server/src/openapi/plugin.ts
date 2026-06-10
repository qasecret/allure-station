import type { FastifyInstance } from "fastify";
import fastifySwagger, { type StaticDocumentSpec } from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { AppDeps } from "../app.js";
import { buildOpenapiDocument } from "./registry.js";

// Registers Swagger UI + the raw document route. Call INSIDE the /api scope so the
// UI lands at /api/docs and the document at /api/openapi.json. The document itself
// is built statically from the Zod contracts (handlers carry no Fastify schemas).
export async function registerOpenapi(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const document = buildOpenapiDocument({ version: deps.version });

  await app.register(fastifySwagger, {
    mode: "static",
    // @fastify/swagger v8's `document` type only models OpenAPI 2/3.0; our 3.1
    // document is structurally fine but doesn't satisfy that union, so cast via unknown.
    specification: { document: document as unknown as StaticDocumentSpec["document"] },
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", async () => document);
}
