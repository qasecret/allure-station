import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { multipart } from "../test-multipart.js";

const NOW = "2026-06-06T00:00:00.000Z";

async function createProject(app: ReturnType<typeof buildApp>, id: string) {
  await app.inject({ method: "POST", url: "/api/projects", payload: { id } });
}

describe("token routes + write authorization", () => {
  it("creates a token (plaintext once), lists without leaking the secret", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");

    const created = await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.token).toMatch(/^ast_/);
    expect(body.prefix).toBe(body.token.slice(0, 12));

    // Listing is gated once a token exists — authenticate with the just-created token.
    const list = await app.inject({ method: "GET", url: "/api/projects/p/tokens", headers: { authorization: `Bearer ${body.token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain(body.token); // plaintext never re-exposed
    expect(list.json()[0]).not.toHaveProperty("tokenHash");
    await app.close();
  });

  it("open project (no tokens) allows writes; once a token exists, writes require it", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");

    // Open: generate without auth works (404-less path — no pending run yields 409, not 401).
    const openGen = await app.inject({ method: "POST", url: "/api/projects/p/generate" });
    expect(openGen.statusCode).toBe(409); // no pending run, but NOT 401 → write was authorized

    // Create a token → project is now locked.
    const token = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } })).json().token as string;

    expect((await app.inject({ method: "POST", url: "/api/projects/p/generate" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/generate", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/projects/p/generate", headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(409); // authorized (409 no-pending, not 401)
    await app.close();
  });

  it("a token for one project cannot authorize writes to another — wrong-scope token is indistinguishable from no/invalid token (401, not 403)", async () => {
    // Fix #3: wrong-scope token → 401 "unauthenticated" (no token-validity oracle).
    // A valid token on the wrong project now responds identically to an invalid token.
    const app = buildApp(await makeTestDeps());
    await createProject(app, "a");
    await createProject(app, "b");
    const aToken = (await app.inject({ method: "POST", url: "/api/projects/a/tokens", payload: { name: "ci" } })).json().token as string;
    // b also gets a token so it's locked
    await app.inject({ method: "POST", url: "/api/projects/b/tokens", payload: { name: "ci" } });

    // valid token but wrong project → 401 unauthenticated (no-oracle: "is this token valid for something?" hidden)
    const cross = await app.inject({ method: "POST", url: "/api/projects/b/generate", headers: { authorization: `Bearer ${aToken}` } });
    expect(cross.statusCode).toBe(401);
    expect(cross.json().error).toBe("unauthenticated");
    await app.close();
  });

  it("send-results enforces auth once a token exists", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");
    const token = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } })).json().token as string;

    const mp = await multipart([{ field: "files", filename: "x-result.json", data: Buffer.from("{}") }]);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/send-results", ...mp })).statusCode).toBe(401);

    const mp2 = await multipart([{ field: "files", filename: "x-result.json", data: Buffer.from("{}") }]);
    const ok = await app.inject({
      method: "POST",
      url: "/api/projects/p/send-results",
      body: mp2.body,
      headers: { ...mp2.headers, authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(202);
    await app.close();
  });

  it("revoking the last token re-opens writes", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");
    const created = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci" } })).json();
    expect((await app.inject({ method: "POST", url: "/api/projects/p/generate" })).statusCode).toBe(401);

    const del = await app.inject({ method: "DELETE", url: `/api/projects/p/tokens/${created.id}`, headers: { authorization: `Bearer ${created.token}` } });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/api/projects/p/generate" })).statusCode).toBe(409); // open again
    await app.close();
  });
});

describe("token expiry", () => {
  it("creates with expiresInDays and lists expiresAt; rejects invalid values", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");

    const res = await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci", expiresInDays: 30 } });
    expect(res.statusCode).toBe(201);
    const ciToken = res.json().token as string;
    const days = (Date.parse(res.json().expiresAt) - Date.parse(NOW)) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);

    // Invalid value: 7 is not in {30, 90, 365} — project is locked, auth with the valid token
    expect((await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "x", expiresInDays: 7 }, headers: { authorization: `Bearer ${ciToken}` } })).statusCode).toBe(400);

    // No expiresInDays → expiresAt is null (never expires)
    const never = await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "legacy" }, headers: { authorization: `Bearer ${ciToken}` } });
    expect(never.json().expiresAt).toBeNull();

    await app.close();
  });

  it("expired token cannot authenticate (resolves to anonymous); if it was the only token, project reopens in zero-config mode", async () => {
    // authenticate() rejects expired tokens → anonymous. countByProject(now) excludes expired rows,
    // so a project with only an expired token is indistinguishable from a project with no tokens →
    // zero-config mode reopens (409 no-pending, not 401). A second live token would keep it locked.
    let nowMs = Date.parse(NOW);
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    const app = buildApp(deps);
    await createProject(app, "p");

    const tok = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "t", expiresInDays: 30 } })).json().token as string;

    // Advance clock 31 days past expiry
    nowMs += 31 * 86_400_000;

    // Using the expired token as auth → bearer is expired → authenticate returns anonymous.
    // The only token is expired → countByProject(now) = 0 → zero-config reopens → 409 authorized.
    const res = await app.inject({ method: "POST", url: `/api/projects/p/generate`, headers: { authorization: `Bearer ${tok}` } });
    expect(res.statusCode).toBe(409); // authorized (no pending run), not 401
    void tok;

    await app.close();
  });

  it("boundary: expiresAt === now — token cannot authenticate AND project reopens", async () => {
    // authenticate() uses strict >: expiresAt === now → expired → anonymous.
    // countByProject(now) uses strict gt: expiresAt === now → excluded → count = 0 → reopens.
    let nowMs = Date.parse(NOW);
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    const app = buildApp(deps);
    await createProject(app, "p");

    const created = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "t", expiresInDays: 30 } })).json();
    const tok = created.token as string;
    const expiresAt = created.expiresAt as string;

    // Advance clock exactly to expiry moment
    nowMs = Date.parse(expiresAt);

    // At the boundary: token can't authenticate AND is excluded from count → project reopens → 409.
    const res = await app.inject({ method: "POST", url: `/api/projects/p/generate`, headers: { authorization: `Bearer ${tok}` } });
    expect(res.statusCode).toBe(409); // authorized (no pending run), not 401
    void tok;

    await app.close();
  });

  it("string '30' for expiresInDays is rejected with 400 (no coercion)", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "p");

    // Send expiresInDays as a string — zod literal(30) requires a number, not a string.
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p/tokens",
      payload: { name: "ci", expiresInDays: "30" },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it("an expired token's use does NOT bump lastUsedAt", async () => {
    let nowMs = Date.parse(NOW);
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    const app = buildApp(deps);
    await createProject(app, "p");

    // Create a token that expires in 30 days; lastUsedAt starts null.
    const tok = (await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "expiring", expiresInDays: 30 } })).json().token as string;

    // Advance clock past expiry.
    nowMs += 31 * 86_400_000;

    // Attempt an authenticated call with the now-expired token — it resolves to anonymous.
    await app.inject({ method: "POST", url: "/api/projects/p/generate", headers: { authorization: `Bearer ${tok}` } });

    // Inspect directly: lastUsedAt must still be null — touchLastUsed is NOT called for expired tokens.
    const tokens = await deps.tokens.listByProject("p");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].lastUsedAt).toBeNull();

    await app.close();
  });

  it("sole-token-expired project reopens to anonymous writes (zero-config mode parity with no-token state)", async () => {
    // Fix #2: countByProject now excludes expired tokens. A project whose only token has expired
    // is indistinguishable from a project with no tokens → anonymous writes are re-allowed in
    // zero-config mode (no users). This is consistent with the no-token state.
    let nowMs = Date.parse(NOW);
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    const app = buildApp(deps);
    await createProject(app, "p");

    // No users; create a token with expiry — project becomes locked.
    await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci", expiresInDays: 30 } });

    // Verify it IS locked while the token is live.
    expect((await app.inject({ method: "POST", url: "/api/projects/p/generate" })).statusCode).toBe(401);

    // Advance clock past expiry.
    nowMs += 31 * 86_400_000;

    // Expired token no longer counts → zero-config reopens. Anonymous POST → 409 (no pending run,
    // but authorized), not 401.
    const res = await app.inject({ method: "POST", url: "/api/projects/p/generate" });
    expect(res.statusCode).toBe(409); // authorized (no-pending-run, not 401)
    expect(res.json().error).not.toBe("unauthenticated");

    await app.close();
  });

  it("non-expired token still locks anonymous writes", async () => {
    // Fix #2 guard: a live token MUST still lock the project. Only expired tokens are excluded.
    let nowMs = Date.parse(NOW);
    const deps = await makeTestDeps({ now: () => new Date(nowMs).toISOString() });
    const app = buildApp(deps);
    await createProject(app, "p");

    // Create a token expiring in 30 days — project is locked while the token is live.
    await app.inject({ method: "POST", url: "/api/projects/p/tokens", payload: { name: "ci", expiresInDays: 30 } });

    // Advance clock 15 days (still within expiry) — project stays locked.
    nowMs += 15 * 86_400_000;

    const res = await app.inject({ method: "POST", url: "/api/projects/p/generate" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthenticated");

    await app.close();
  });
});
