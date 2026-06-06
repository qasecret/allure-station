import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../app.js";
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";

describe("SSE /projects/:id/events", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  async function listen(deps: AppDeps): Promise<number> {
    const app = buildApp(deps);
    await app.listen({ port: 0, host: "127.0.0.1" });
    close = () => app.close();
    return (app.server.address() as AddressInfo).port;
  }

  it("404s an unknown project", async () => {
    const port = await listen(await makeTestDeps());
    const status = await new Promise<number>((resolve) => {
      http.get({ port, path: "/api/projects/nope/events" }, (r) => {
        resolve(r.statusCode ?? 0);
        r.destroy();
      });
    });
    expect(status).toBe(404);
  });

  it("streams a run event for the project", async () => {
    const deps = await makeTestDeps();
    await deps.projects.create("p", deps.now());
    const port = await listen(deps);

    const received = new Promise<string>((resolve, reject) => {
      const r = http.get({ port, path: "/api/projects/p/events" }, (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk;
          const line = buf.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            res.destroy();
            resolve(line.slice(6));
          }
        });
        res.on("error", reject);
      });
      r.on("error", reject);
      // Give the server a tick to subscribe to the bus, then publish.
      setTimeout(() => {
        deps.bus.publish({
          type: "run",
          projectId: "p",
          run: { id: "r1", projectId: "p", status: "ready", reportName: "R", createdAt: deps.now(), finishedAt: deps.now(), stats: null },
        });
      }, 100);
    });

    const payload = JSON.parse(await received);
    expect(payload.projectId).toBe("p");
    expect(payload.run.id).toBe("r1");
    expect(payload.run.status).toBe("ready");
  });

  it("does not deliver another project's events to this stream", async () => {
    const deps = await makeTestDeps();
    await deps.projects.create("p", deps.now());
    const port = await listen(deps);

    const sawOther = new Promise<boolean>((resolve, reject) => {
      const r = http.get({ port, path: "/api/projects/p/events" }, (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.split("\n").some((l) => l.startsWith("data: "))) {
            r.destroy(); // tear down the client socket so app.close() doesn't hang
            resolve(true); // received a data line — should not happen for the other project
          }
        });
        res.on("error", () => {}); // expected on destroy
      });
      r.on("error", reject);
      setTimeout(() => {
        deps.bus.publish({
          type: "run",
          projectId: "other",
          run: { id: "x", projectId: "other", status: "ready", reportName: "R", createdAt: deps.now(), finishedAt: deps.now(), stats: null },
        });
        // No matching event should arrive; resolve false after a grace period.
        setTimeout(() => { r.destroy(); resolve(false); }, 200);
      }, 100);
    });

    expect(await sawOther).toBe(false);
  });
});
