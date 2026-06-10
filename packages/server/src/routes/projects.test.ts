import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AuditEntry } from "@allure-station/shared";

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

describe("project display name", () => {
  it("creates with a display name, trims it, and returns it on GET", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { id: "named", displayName: "  Demo Web App  " } });
    expect(created.statusCode).toBe(201);
    expect(created.json().displayName).toBe("Demo Web App");
    expect((await app.inject({ method: "GET", url: "/api/projects/named" })).json().displayName).toBe("Demo Web App");
    await app.close();
  });

  it("defaults displayName to null and PATCH updates + clears it (audited)", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "GET", url: "/api/projects/p" })).json().displayName).toBeNull();

    const renamed = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "Payments" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().displayName).toBe("Payments");

    // empty string clears back to null
    const cleared = await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "" } });
    expect(cleared.json().displayName).toBeNull();

    const audit = await deps.audit.list({ limit: 10 });
    expect(audit.some((e: AuditEntry) => e.action === "project_renamed")).toBe(true);
    await app.close();
  });

  it("PATCH 404s unknown project and 400s an over-long name", async () => {
    const deps = await makeTestDeps();
    const app = buildApp(deps);
    expect((await app.inject({ method: "PATCH", url: "/api/projects/nope", payload: { displayName: "x" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    expect((await app.inject({ method: "PATCH", url: "/api/projects/p", payload: { displayName: "x".repeat(121) } })).statusCode).toBe(400);
    await app.close();
  });
});
