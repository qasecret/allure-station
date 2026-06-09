import { describe, it, expect, vi, afterEach } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";

afterEach(() => vi.unstubAllGlobals());

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
    // SSRF guard: internal/loopback targets rejected
    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "http://169.254.169.254/latest" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "http://localhost:5095/h" } })).statusCode).toBe(400);
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

  it("test-send delivers to the subscription and returns the result; 404 for an unknown id", async () => {
    const app = buildApp(await makeTestDeps());
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" } });
    const created = await app.inject({ method: "POST", url: "/api/projects/p/notifications", payload: { kind: "webhook", url: "https://hooks.example.com/x" } });
    const id = created.json().id;

    let posted: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { posted = url; return new Response("ok", { status: 200 }); }));

    const ok = await app.inject({ method: "POST", url: `/api/projects/p/notifications/${id}/test` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, status: 200 });
    expect(posted).toBe("https://hooks.example.com/x");

    expect((await app.inject({ method: "POST", url: "/api/projects/p/notifications/nope/test" })).statusCode).toBe(404);
    await app.close();
  });
});
