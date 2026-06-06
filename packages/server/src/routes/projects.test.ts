import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("project routes", () => {
  it("creates, lists, gets and deletes a project", async () => {
    const app = buildApp(makeTestDeps());

    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { id: "team-a" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "team-a", latestRunId: null });

    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.json().map((p: { id: string }) => p.id)).toEqual(["team-a"]);

    const got = await app.inject({ method: "GET", url: "/api/projects/team-a" });
    expect(got.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: "/api/projects/team-a" });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects/team-a" })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects an invalid id with 400 and a duplicate with 409", async () => {
    const app = buildApp(makeTestDeps());
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "a/b" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } });
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } })).statusCode).toBe(409);
    await app.close();
  });
});
