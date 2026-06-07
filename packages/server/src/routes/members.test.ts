import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";

async function seed(deps: AppDeps) {
  await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
  await deps.users.create("owner@x.com", await hashPassword("password123"), "user", deps.now());
  await deps.users.create("other@x.com", await hashPassword("password123"), "user", deps.now());
}
async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
  return res.cookies.find((c) => c.name === "as_session")!.value;
}

describe("member routes (owner/admin-gated)", () => {
  it("admin grants ownership; owner manages members; lists join email", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });

    // Admin makes owner@ an owner.
    const grant = await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "owner@x.com", role: "owner" }, cookies: { as_session: adminCookie } });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toMatchObject({ email: "owner@x.com", role: "owner" });

    // Owner can now add other@ as a viewer and see the member list with emails.
    const ownerCookie = await login(app, "owner@x.com");
    const add = await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "other@x.com", role: "viewer" }, cookies: { as_session: ownerCookie } });
    expect(add.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/projects/p/members", cookies: { as_session: ownerCookie } });
    expect(list.json()).toHaveLength(2);
    expect(list.json().map((m: { email: string }) => m.email).sort()).toEqual(["other@x.com", "owner@x.com"]);

    // upsert: changing other@ to maintainer updates in place (still 2 members)
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "other@x.com", role: "maintainer" }, cookies: { as_session: ownerCookie } });
    expect((await app.inject({ method: "GET", url: "/api/projects/p/members", cookies: { as_session: ownerCookie } })).json()).toHaveLength(2);

    // Remove other@.
    const otherId = list.json().find((m: { email: string }) => m.email === "other@x.com").userId;
    expect((await app.inject({ method: "DELETE", url: `/api/projects/p/members/${otherId}`, cookies: { as_session: ownerCookie } })).statusCode).toBe(204);
    await app.close();
  });

  it("a maintainer cannot manage members; unknown email is 404", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const adminCookie = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: adminCookie } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "owner@x.com", role: "maintainer" }, cookies: { as_session: adminCookie } });

    const maintCookie = await login(app, "owner@x.com");
    expect((await app.inject({ method: "GET", url: "/api/projects/p/members", cookies: { as_session: maintCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "other@x.com", role: "viewer" }, cookies: { as_session: maintCookie } })).statusCode).toBe(401);

    // Granting a non-existent user is 404.
    expect((await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "ghost@x.com", role: "viewer" }, cookies: { as_session: adminCookie } })).statusCode).toBe(404);
    await app.close();
  });
});
