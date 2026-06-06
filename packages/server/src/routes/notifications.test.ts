import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

describe("notification routes", () => {
  it("creates, lists, and deletes a subscription", async () => {
    const app = buildApp(await makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });

    const created = await app.inject({
      method: "POST", url: "/api/projects/p/notifications",
      payload: { kind: "slack", url: "https://hooks.slack.com/x", events: ["failed", "regression"] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: "slack", url: "https://hooks.slack.com/x", events: ["failed", "regression"] });

    const list = await app.inject({ method: "GET", url: "/api/projects/p/notifications" });
    expect(list.json()).toHaveLength(1);

    const del = await app.inject({ method: "DELETE", url: `/api/projects/p/notifications/${created.json().id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/projects/p/notifications" })).json()).toHaveLength(0);
    await app.close();
  });

  it("defaults events when omitted and rejects invalid input", async () => {
    const app = buildApp(await makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });

    const defaulted = await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "https://h/x" } });
    expect(defaulted.json().events).toEqual(["failed", "gate_failed", "regression"]);

    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "not-a-url" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "carrierpigeon", url: "https://h/x" } })).statusCode).toBe(400);
    await app.close();
  });

  it("all notification routes are auth-gated once the project has a token", async () => {
    const app = buildApp(await makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } }); // locks the project
    expect((await app.inject({ method: "GET", url: "/api/projects/p/notifications" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "https://h/x" } })).statusCode).toBe(401);
    await app.close();
  });
});
