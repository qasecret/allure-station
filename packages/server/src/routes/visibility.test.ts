import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { hashPassword } from "../password.js";
import type { AppDeps } from "../app.js";

async function seed(deps: AppDeps) {
  await deps.users.create("admin@x.com", await hashPassword("password123"), "admin", deps.now());
  await deps.users.create("viewer@x.com", await hashPassword("password123"), "user", deps.now());
  await deps.users.create("stranger@x.com", await hashPassword("password123"), "user", deps.now());
}
async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
  return res.cookies.find((c) => c.name === "as_session")!.value;
}
const sc = (r: { statusCode: number }) => r.statusCode;

describe("private projects / read gating", () => {
  it("gates reads when private; badge stays public; owner/admin/member/token can read", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const admin = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: admin } });
    await app.inject({ method: "PUT", url: "/api/projects/p/members", payload: { email: "viewer@x.com", role: "viewer" }, cookies: { as_session: admin } });
    const tok = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" }, cookies: { as_session: admin } })).json().token as string;

    // public: anyone reads
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p" }))).toBe(200);

    // flip to private
    const setRes = await app.inject({ method: "PUT", url: "/api/projects/p/visibility", payload: { visibility: "private" }, cookies: { as_session: admin } });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json().visibility).toBe("private");

    // anonymous is now 404 across every read surface (existence hidden) — but the badge stays public.
    // Includes the high-leak surfaces (report HTML, run, summary, SSE) which the gate must close.
    for (const url of [
      "/api/projects/p", "/api/projects/p/runs", "/api/projects/p/trends", "/api/projects/p/quality-gate",
      "/api/projects/p/compare?base=a&target=b", "/api/projects/p/runs/anyid", "/api/projects/p/runs/anyid/report/index.html",
      "/api/projects/p/runs/anyid/summary", "/api/projects/p/events",
    ]) {
      expect(sc(await app.inject({ method: "GET", url })), url).toBe(404);
    }
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p/badge.svg" }))).toBe(200);

    // admin, member viewer, and a project token can all read
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: admin } }))).toBe(200);
    const viewer = await login(app, "viewer@x.com");
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: viewer } }))).toBe(200);
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p", headers: { authorization: `Bearer ${tok}` } }))).toBe(200);

    // a logged-in non-member is denied
    const stranger = await login(app, "stranger@x.com");
    expect(sc(await app.inject({ method: "GET", url: "/api/projects/p", cookies: { as_session: stranger } }))).toBe(404);
    await app.close();
  });

  it("private projects are filtered from the project list for non-members", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const admin = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "open" }, cookies: { as_session: admin } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "secret" }, cookies: { as_session: admin } });
    await app.inject({ method: "PUT", url: "/api/projects/secret/visibility", payload: { visibility: "private" }, cookies: { as_session: admin } });
    await app.inject({ method: "PUT", url: "/api/projects/secret/members", payload: { email: "viewer@x.com", role: "viewer" }, cookies: { as_session: admin } });

    const ids = async (cookie?: string) =>
      ((await app.inject({ method: "GET", url: "/api/projects", ...(cookie ? { cookies: { as_session: cookie } } : {}) })).json() as { id: string }[]).map((p) => p.id).sort();

    expect(await ids()).toEqual(["open"]);                                  // anonymous: public only
    expect(await ids(admin)).toEqual(["open", "secret"]);                   // admin: all
    expect(await ids(await login(app, "viewer@x.com"))).toEqual(["open", "secret"]); // member: public ∪ member
    expect(await ids(await login(app, "stranger@x.com"))).toEqual(["open"]); // non-member: public only
    await app.close();
  });

  it("only owner/admin can set visibility; bad body is 400", async () => {
    const deps = await makeTestDeps();
    await seed(deps);
    const app = buildApp(deps);
    const admin = await login(app, "admin@x.com");
    await app.inject({ method: "POST", url: "/api/projects", payload: { id: "p" }, cookies: { as_session: admin } });

    expect(sc(await app.inject({ method: "PUT", url: "/api/projects/p/visibility", payload: { visibility: "private" } }))).toBe(401); // anon
    const stranger = await login(app, "stranger@x.com");
    expect(sc(await app.inject({ method: "PUT", url: "/api/projects/p/visibility", payload: { visibility: "private" }, cookies: { as_session: stranger } }))).toBe(401);
    expect(sc(await app.inject({ method: "PUT", url: "/api/projects/p/visibility", payload: { visibility: "bogus" }, cookies: { as_session: admin } }))).toBe(400);
    await app.close();
  });
});
