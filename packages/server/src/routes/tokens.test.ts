import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import { multipart } from "../test-multipart.js";

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

  it("a token for one project cannot authorize writes to another", async () => {
    const app = buildApp(await makeTestDeps());
    await createProject(app, "a");
    await createProject(app, "b");
    const aToken = (await app.inject({ method: "POST", url: "/api/projects/a/tokens", payload: { name: "ci" } })).json().token as string;
    // b also gets a token so it's locked
    await app.inject({ method: "POST", url: "/api/projects/b/tokens", payload: { name: "ci" } });

    const cross = await app.inject({ method: "POST", url: "/api/projects/b/generate", headers: { authorization: `Bearer ${aToken}` } });
    expect(cross.statusCode).toBe(401);
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
