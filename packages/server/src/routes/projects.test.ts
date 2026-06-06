import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("project routes", () => {
  it("creates, lists, gets and deletes a project", async () => {
    const app = buildApp(await makeTestDeps());

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
    const app = buildApp(await makeTestDeps());
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "a/b" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } });
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { id: "dup" } })).statusCode).toBe(409);
    await app.close();
  });

  it("supports ?q search, ?limit/?offset pagination, and X-Total-Count", async () => {
    const app = buildApp(await makeTestDeps());
    for (const id of ["alpha", "alpine", "beta"]) await app.inject({ method: "POST", url: "/api/projects", payload: { id } });

    const search = await app.inject({ method: "GET", url: "/api/projects?q=alp" });
    expect(search.json().map((p: { id: string }) => p.id)).toEqual(["alpha", "alpine"]);
    expect(search.headers["x-total-count"]).toBe("2");

    const page = await app.inject({ method: "GET", url: "/api/projects?limit=1&offset=1" });
    expect(page.json().map((p: { id: string }) => p.id)).toEqual(["alpine"]);
    expect(page.headers["x-total-count"]).toBe("3"); // total ignores pagination

    expect((await app.inject({ method: "GET", url: "/api/projects?limit=-1" })).statusCode).toBe(400);
    await app.close();
  });
});
