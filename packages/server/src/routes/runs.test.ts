import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("run routes", () => {
  it("lists runs for a project and 404s unknown run", async () => {
    const deps = makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/projects", payload: { id: "p" } });
    await deps.runs.create("p", deps.newId(), "R", deps.now());

    const list = await app.inject({ method: "GET", url: "/projects/p/runs" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    expect((await app.inject({ method: "GET", url: "/projects/p/runs/nope" })).statusCode).toBe(404);
    await app.close();
  });
});
