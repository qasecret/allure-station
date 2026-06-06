import { describe, it, expect, vi } from "vitest";
import { selectTriggers, slackText, webhookPayload, dispatchNotifications } from "./notify.js";
import type { AppDeps } from "./app.js";
import type { Notification, Run } from "@allure-station/shared";

const run = (over: Partial<Run> = {}): Run => ({
  id: "r1", projectId: "p", status: "ready", reportName: "R",
  createdAt: "2026-06-07T00:00:00.000Z", finishedAt: "2026-06-07T00:00:01.000Z",
  stats: { total: 2, passed: 2, failed: 0, broken: 0, skipped: 0 }, ...over,
});

describe("selectTriggers", () => {
  it("failed run → completed + failed", () => {
    expect(selectTriggers(run({ status: "failed", stats: null }), false, 0).sort()).toEqual(["completed", "failed"]);
  });
  it("clean ready run → completed only", () => {
    expect(selectTriggers(run(), false, 0)).toEqual(["completed"]);
  });
  it("ready + gate breach + regressions → all relevant", () => {
    expect(selectTriggers(run(), true, 3).sort()).toEqual(["completed", "gate_failed", "regression"]);
  });
});

describe("payload builders", () => {
  it("slackText reflects status + counts + report link", () => {
    const txt = slackText({ project: "p", run: run({ stats: { total: 3, passed: 2, failed: 1, broken: 0, skipped: 0 } }), fired: ["completed", "regression"], newlyFailing: 1, reportUrl: "http://x/r" });
    expect(txt).toContain("*p*");
    expect(txt).toContain("2/3 passed");
    expect(txt).toContain("1* newly failing");
    expect(txt).toContain("http://x/r");
  });
  it("webhookPayload carries machine-readable fields", () => {
    const p = webhookPayload({ project: "p", run: run(), fired: ["completed"], newlyFailing: 0, reportUrl: "http://x/r" });
    expect(p).toMatchObject({ project: "p", runId: "r1", status: "ready", triggers: ["completed"], reportUrl: "http://x/r" });
  });
});

function fakeDeps(subs: Notification[], theRun: Run, over: Partial<AppDeps> = {}): AppDeps {
  return {
    notifications: {
      countByProject: async () => subs.length,
      listByProject: async () => subs,
    },
    runs: { get: async () => theRun, previousReadyBefore: async () => null },
    projects: { getQualityGate: async () => null },
    testResults: { listByRun: async () => [] },
    publicUrl: "https://allure.example.com",
    ...over,
  } as unknown as AppDeps;
}

const sub = (over: Partial<Notification>): Notification => ({
  id: "n1", projectId: "p", kind: "webhook", url: "https://hook/x", events: ["failed"], createdAt: "x", ...over,
});

describe("dispatchNotifications", () => {
  it("POSTs only subscriptions whose events match the fired triggers", async () => {
    const calls: string[] = [];
    const fakeFetch = vi.fn(async (url: string) => { calls.push(url); return new Response("ok"); }) as unknown as typeof fetch;
    const subs = [
      sub({ id: "match", url: "https://hook/match", events: ["completed"] }),
      sub({ id: "nomatch", url: "https://hook/nomatch", events: ["regression"] }),
    ];
    await dispatchNotifications(fakeDeps(subs, run()), "p", "r1", fakeFetch);
    expect(calls).toEqual(["https://hook/match"]); // clean ready → only "completed" fires
  });

  it("does nothing when there are no subscriptions", async () => {
    const fakeFetch = vi.fn() as unknown as typeof fetch;
    await dispatchNotifications(fakeDeps([], run()), "p", "r1", fakeFetch);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("a throwing fetch never propagates (best-effort)", async () => {
    const fakeFetch = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const subs = [sub({ events: ["completed"] })];
    await expect(dispatchNotifications(fakeDeps(subs, run()), "p", "r1", fakeFetch)).resolves.toBeUndefined();
  });

  it("uses publicUrl for an absolute report link in slack payloads", async () => {
    let body: string | undefined;
    const fakeFetch = vi.fn(async (_url: string, init: { body: string }) => { body = init.body; return new Response("ok"); }) as unknown as typeof fetch;
    const subs = [sub({ kind: "slack", events: ["completed"] })];
    await dispatchNotifications(fakeDeps(subs, run()), "p", "r1", fakeFetch);
    expect(JSON.parse(body!).text).toContain("https://allure.example.com/api/projects/p/runs/r1/report/index.html");
  });
});
