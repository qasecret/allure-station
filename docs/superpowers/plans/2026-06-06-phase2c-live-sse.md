# Phase 2c — Live run status over SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI's run-status polling with server-pushed live updates: the React app opens an SSE stream per project and run lifecycle events (created → generating → ready/failed, with stats) arrive instantly, including across a multi-replica bullmq deployment.

**Architecture:** A pluggable `EventBus` (same driver shape as Storage/Queue/DB): `InProcessBus` (Node `EventEmitter`, the zero-config default) and `RedisBus` (Redis pub/sub, used whenever `QUEUE_DRIVER=bullmq` so the worker process and N API replicas share one event stream). Run transitions publish `RunEvent`s; a Fastify SSE route subscribes and streams project-scoped events to browsers; the UI consumes them via `EventSource` and updates the react-query cache.

**Tech Stack:** Fastify v4 raw SSE (`reply.hijack()` + `reply.raw`), `ioredis` 5.x (already present transitively via bullmq — promote to a direct dep), `@tanstack/react-query`, browser `EventSource`.

---

## Spike findings (2026-06-06) — why this shape

- Allure 3.9.0 has **no file-watch / `directory-watcher`** package and `AllureReport` has **no `watch()` mode**. It *does* expose `realtimeSubscriber.onTestResults(ids[])` (batched ~100ms) firing during `readDirectory()`, but our model uploads complete results then runs a few-second batch generate — so per-test Allure events have little value. **The valuable live surface is our own run lifecycle**, driven by our state machine, not Allure.
- The Awesome report bundle is static HTML (no socket/poll), so "live" is a list/status concern, not an in-report concern.
- **Multi-process constraint:** in `bullmq` mode, `ready`/`failed` transitions happen in the *worker* process while SSE connections live on the *API* process(es). Events must cross processes → Redis pub/sub. In the single-process `inprocess` default, an in-memory `EventEmitter` suffices. → pluggable `EventBus`, driver tied to `QUEUE_DRIVER`.

**Scope (locked with user):** live run status over SSE only. NOT bridging Allure per-test events; NOT incremental ingestion. Those stay deferred.

---

## File Structure

- Create `packages/server/src/events/bus.ts` — `EventBus` interface, `InProcessBus`, `RedisBus`.
- Create `packages/server/src/events/conformance.ts` — shared bus conformance suite.
- Create `packages/server/src/events/bus.test.ts` — runs conformance (in-process always; Redis when `REDIS_TEST_URL`).
- Create `packages/server/src/routes/events.ts` — SSE route.
- Create `packages/server/src/routes/events.test.ts` — SSE end-to-end test.
- Modify `packages/shared/src/contracts.ts` — add `RunEvent`.
- Modify `packages/server/src/app.ts` — `AppDeps.bus`; register events route.
- Modify `packages/server/src/deps.ts` — `buildDeps` takes `bus`.
- Modify `packages/server/src/test-helpers.ts` — wire `InProcessBus`.
- Modify `packages/server/src/generation.ts` — publish on ready/failed.
- Modify `packages/server/src/routes/results.ts` — publish on create + generating.
- Modify `packages/server/src/main.ts` + `worker-main.ts` — construct bus, pass to `buildDeps`, close on shutdown.
- Modify `packages/server/package.json` — add `ioredis`.
- Modify `packages/web/src/api/client.ts` — `subscribeRuns(projectId, onEvent)`.
- Modify `packages/web/src/pages/Project.tsx` — replace `refetchInterval` with `EventSource`.
- Modify `README.md` — document the events stream.

Notes for all tasks: ESM (`.js` import specifiers), `pnpm --filter @allure-station/<pkg> test|typecheck`. Commit after each task.

---

### Task 1: `RunEvent` contract in shared

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Test: `packages/shared/src/contracts.test.ts` (existing)

- [ ] **Step 1: Add the schema.** After the existing `runSchema`/`Run` export in `packages/shared/src/contracts.ts`, add:

```ts
export const runEventSchema = z.object({
  type: z.literal("run"),
  projectId: z.string(),
  run: runSchema,
});
export type RunEvent = z.infer<typeof runEventSchema>;
```

(If `runSchema` is named differently, use the existing Run zod schema variable. `z` is already imported.)

- [ ] **Step 2: Export.** Ensure `runEventSchema`/`RunEvent` are exported from the shared package barrel (`packages/shared/src/index.ts`) the same way `Run`/`runSchema` are. Match the existing export style.

- [ ] **Step 3: Typecheck + commit.** `pnpm --filter @allure-station/shared typecheck` then commit: `feat(shared): RunEvent contract for live run updates`.

---

### Task 2: `EventBus` interface + drivers + conformance

**Files:**
- Create: `packages/server/src/events/bus.ts`
- Create: `packages/server/src/events/conformance.ts`
- Create: `packages/server/src/events/bus.test.ts`
- Modify: `packages/server/package.json` (add `ioredis`)

- [ ] **Step 1: Add ioredis dep.** In `packages/server/package.json` `dependencies`, add `"ioredis": "5.10.1"` (the version already resolved transitively). Run `pnpm install` from repo root and confirm the lockfile updates (commit it).

- [ ] **Step 2: Write `bus.ts`.**

```ts
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import type { RunEvent } from "@allure-station/shared";

export interface EventBus {
  /** Fire-and-forget publish. In RedisBus, local subscribers are notified via the round-trip too. */
  publish(event: RunEvent): void;
  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(listener: (event: RunEvent) => void): () => void;
  close(): Promise<void>;
}

const CHANNEL = "allure-station:run-events";

/** Single-process bus. Publisher and subscribers share one EventEmitter. */
export class InProcessBus implements EventBus {
  readonly #emitter = new EventEmitter();
  constructor() {
    // SSE fans out to one listener per connected client; lift the default cap.
    this.#emitter.setMaxListeners(0);
  }
  publish(event: RunEvent): void {
    this.#emitter.emit(CHANNEL, event);
  }
  subscribe(listener: (event: RunEvent) => void): () => void {
    this.#emitter.on(CHANNEL, listener);
    return () => this.#emitter.off(CHANNEL, listener);
  }
  async close(): Promise<void> {
    this.#emitter.removeAllListeners();
  }
}

/**
 * Cross-process bus via Redis pub/sub. Used in bullmq mode so the worker's ready/failed
 * transitions reach SSE clients on every API replica. Redis requires a dedicated connection
 * in subscribe mode, so we hold two clients. publish() goes only to Redis; the subscriber
 * connection drives local listeners — one path, correct multi-replica fan-out (including self).
 */
export class RedisBus implements EventBus {
  readonly #pub: Redis;
  readonly #sub: Redis;
  readonly #listeners = new Set<(event: RunEvent) => void>();
  #ready: Promise<void>;

  constructor(url: string) {
    this.#pub = new Redis(url, { maxRetriesPerRequest: null });
    this.#sub = new Redis(url, { maxRetriesPerRequest: null });
    this.#pub.on("error", (err) => console.error("[events] redis pub error:", err));
    this.#sub.on("error", (err) => console.error("[events] redis sub error:", err));
    this.#sub.on("message", (_channel, message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message) as RunEvent;
      } catch (err) {
        console.error("[events] dropping malformed run event:", err);
        return;
      }
      for (const l of this.#listeners) l(event);
    });
    this.#ready = this.#sub.subscribe(CHANNEL).then(() => undefined);
  }

  publish(event: RunEvent): void {
    // Ensure the channel is subscribed before publishing in fast test/startup paths,
    // then publish. Errors are logged, never thrown into the caller (fire-and-forget).
    this.#ready
      .then(() => this.#pub.publish(CHANNEL, JSON.stringify(event)))
      .catch((err) => console.error("[events] publish failed:", err));
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.#listeners.clear();
    this.#pub.disconnect();
    this.#sub.disconnect();
  }
}
```

- [ ] **Step 3: Write `conformance.ts`** — a suite parameterized over a bus factory, so both drivers are tested identically. Note RedisBus delivery is async (round-trip), so the helper awaits delivery with a short poll.

```ts
import { expect } from "vitest";
import type { EventBus } from "./bus.js";
import type { RunEvent } from "@allure-station/shared";

const sample = (id: string, status: RunEvent["run"]["status"]): RunEvent => ({
  type: "run",
  projectId: "p",
  run: { id, projectId: "p", status, reportName: "R", createdAt: "2026-06-06T00:00:00.000Z", finishedAt: null, stats: null },
});

async function waitFor<T>(get: () => T[], n: number, timeoutMs = 2000): Promise<T[]> {
  const start = Date.now();
  while (get().length < n) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} events (got ${get().length})`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return get();
}

/** Run the shared bus conformance assertions against a freshly-built bus. */
export async function runBusConformance(makeBus: () => EventBus): Promise<void> {
  // delivers a published event to a subscriber
  {
    const bus = makeBus();
    const got: RunEvent[] = [];
    const unsub = bus.subscribe((e) => got.push(e));
    bus.publish(sample("r1", "generating"));
    await waitFor(() => got, 1);
    expect(got[0].run.id).toBe("r1");
    unsub();
    await bus.close();
  }
  // unsubscribe stops delivery
  {
    const bus = makeBus();
    const got: RunEvent[] = [];
    const unsub = bus.subscribe((e) => got.push(e));
    unsub();
    bus.publish(sample("r2", "ready"));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(0);
    await bus.close();
  }
}
```

- [ ] **Step 4: Write `bus.test.ts`.**

```ts
import { describe, it } from "vitest";
import { InProcessBus, RedisBus } from "./bus.js";
import { runBusConformance } from "./conformance.js";

describe("InProcessBus", () => {
  it("passes bus conformance", async () => {
    await runBusConformance(() => new InProcessBus());
  });
});

const redisUrl = process.env.REDIS_TEST_URL;
(redisUrl ? describe : describe.skip)("RedisBus (requires REDIS_TEST_URL)", () => {
  it("passes bus conformance across two Redis connections", async () => {
    await runBusConformance(() => new RedisBus(redisUrl!));
  });
});
```

- [ ] **Step 5: Typecheck + test (in-process) + commit.** `pnpm --filter @allure-station/server typecheck` and `pnpm --filter @allure-station/server test bus`. Commit: `feat(events): pluggable EventBus (in-process + Redis pub/sub) + conformance`.

---

### Task 3: Wire the bus through deps / config / entrypoints (no publishing yet)

**Files:**
- Modify: `packages/server/src/app.ts`, `deps.ts`, `test-helpers.ts`, `main.ts`, `worker-main.ts`

- [ ] **Step 1: `AppDeps.bus`.** In `packages/server/src/app.ts`, import the type and add `bus` to `AppDeps`:

```ts
import type { EventBus } from "./events/bus.js";
// ...inside AppDeps:
  bus: EventBus;
```

- [ ] **Step 2: `buildDeps` takes the bus.** In `packages/server/src/deps.ts`, add a `bus: EventBus` parameter and include it in the returned object:

```ts
import type { EventBus } from "./events/bus.js";
export function buildDeps(config: AppConfig, queue: JobQueue, db: Db, bus: EventBus): AppDeps {
  return { /* ...existing... */, bus };
}
```

- [ ] **Step 3: test-helpers.** In `packages/server/src/test-helpers.ts`, construct an `InProcessBus` and add it to the deps object: `import { InProcessBus } from "./events/bus.js";` and `bus: new InProcessBus(),` in the `deps` literal (before `wireQueue(deps)`).

- [ ] **Step 4: main.ts.** Construct the bus tied to the queue driver, pass to `buildDeps`, close on shutdown.

```ts
import { InProcessBus, RedisBus } from "./events/bus.js";
// after `queue` is built:
const bus = config.queueDriver === "bullmq" ? new RedisBus(config.redisUrl!) : new InProcessBus();
// ...
const deps = buildDeps(config, queue, db, bus);
// ...in shutdown(), after queue.close():
try { await bus.close(); } catch { /* best-effort */ }
```

- [ ] **Step 5: worker-main.ts.** The worker only runs in bullmq mode, so it always uses a `RedisBus` (it publishes ready/failed):

```ts
import { RedisBus } from "./events/bus.js";
const bus = new RedisBus(config.redisUrl!);
const deps = buildDeps(config, queue, db, bus);
// ...in shutdown(), after queue.close():
try { await bus.close(); } catch { /* best-effort */ }
```

- [ ] **Step 6: Typecheck + full server test + commit.** `pnpm --filter @allure-station/server typecheck && pnpm --filter @allure-station/server test`. All existing tests must still pass (the bus is wired but unused). Commit: `feat(events): wire EventBus through deps/config/entrypoints`.

---

### Task 4: Publish run events on every transition

**Files:**
- Modify: `packages/server/src/routes/results.ts`, `packages/server/src/generation.ts`
- Test: `packages/server/src/routes/results.test.ts` (add an assertion)

- [ ] **Step 1: Publish on create + generating in `results.ts`.** In the `send-results` handler, after `const run = await deps.runs.create(...)` and before returning, publish the created run:

```ts
deps.bus.publish({ type: "run", projectId, run });
```

In the `/generate` handler, after a successful `claimPending` (right before/after the enqueue try-block returns the 202), publish the generating run object you already build:

```ts
const generating = { ...pending, status: "generating" as const };
// ...enqueue try/catch unchanged...
deps.bus.publish({ type: "run", projectId, run: generating });
return reply.code(202).send(generating);
```

(Publish only after enqueue succeeds — i.e. just before the 202 return, not in the catch.)

- [ ] **Step 2: Publish on ready/failed in `generation.ts`.** In `runGeneration`, after `markReady(...)` and after `markFailed(...)`, fetch the updated run and publish it. Add a small helper inside the module:

```ts
async function publishRun(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  const run = await deps.runs.get(runId);
  if (run) deps.bus.publish({ type: "run", projectId, run });
}
```

Call `await publishRun(deps, projectId, runId);` immediately after the `markReady` call and immediately after the `markFailed` call. (`runGeneration` already has `deps`, `projectId`, `runId` in scope — confirm parameter names and reuse them.)

- [ ] **Step 2b: Note the known gap in a comment.** Above the reconcile sweep in `reconcile.ts`, add a one-line comment: `// Note: stale-reconcile failures are not published to the event bus (rare worker-crash path); the UI catches them on next load.` (No behavior change — documents the deliberate scope boundary.)

- [ ] **Step 3: Add a bus assertion to `results.test.ts`.** In the existing send-results+generate test, subscribe to `deps.bus` before acting, collect events, await `deps.queue.onIdle()`, then assert the sequence of statuses observed includes `generating` and ends with `ready`:

```ts
const events: string[] = [];
deps.bus.subscribe((e) => events.push(e.run.status));
// ...existing send-results + generate calls...
await deps.queue.onIdle();
expect(events).toContain("generating");
expect(events.at(-1)).toBe("ready");
```

- [ ] **Step 4: Typecheck + test + commit.** `pnpm --filter @allure-station/server typecheck && pnpm --filter @allure-station/server test results`. Commit: `feat(events): publish run lifecycle events on every transition`.

---

### Task 5: SSE route

**Files:**
- Create: `packages/server/src/routes/events.ts`
- Create: `packages/server/src/routes/events.test.ts`
- Modify: `packages/server/src/app.ts` (register the route)

- [ ] **Step 1: Write `events.ts`.** Project-scoped SSE stream. Uses `reply.hijack()` then writes raw. Filters bus events by `projectId`. Heartbeat every 25s; cleans up on client disconnect.

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  // SSE stream of run lifecycle events for one project. Clients reconnect automatically (EventSource).
  app.get("/projects/:projectId/events", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });

    reply.hijack(); // we own the socket from here; Fastify will not send a response
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
    });
    res.write("retry: 3000\n\n");

    const unsub = deps.bus.subscribe((event) => {
      if (event.projectId !== projectId) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
    };
    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);
  });
}
```

- [ ] **Step 2: Register in `app.ts`.** Import `registerEventRoutes` and call it inside the `/api` scope alongside the other `register*Routes(api, deps)` calls.

- [ ] **Step 3: Write `events.test.ts`** — a real end-to-end: start the app on an ephemeral port, open the SSE connection with the raw `http` client, publish via the bus, assert a `data:` line with the event arrives; also assert 404 for an unknown project.

```ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { buildApp } from "./app.js"; // adjust path: "../app.js" from routes/ -> this file is in routes/
import { makeTestDeps } from "../test-helpers.js";
import type { AppDeps } from "../app.js";

// NOTE: place this file at packages/server/src/routes/events.test.ts; fix the relative
// import of buildApp to "../app.js".

describe("SSE /projects/:id/events", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => { if (close) await close(); close = null; });

  async function listen(deps: AppDeps): Promise<{ port: number }> {
    const { buildApp } = await import("../app.js");
    const app = buildApp(deps);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    close = () => app.close();
    return { port };
  }

  it("streams a run event for the project and 404s unknown projects", async () => {
    const deps = await makeTestDeps();
    await deps.projects.create("p", deps.now());
    const { port } = await listen(deps);

    // 404 path
    const notFound = await new Promise<number>((resolve) => {
      http.get({ port, path: "/api/projects/nope/events" }, (r) => { resolve(r.statusCode ?? 0); r.destroy(); });
    });
    expect(notFound).toBe(404);

    // stream path: connect, then publish, then read the first data line
    const received = new Promise<string>((resolve, reject) => {
      const r = http.get({ port, path: "/api/projects/p/events" }, (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk;
          const line = buf.split("\n").find((l) => l.startsWith("data: "));
          if (line) { res.destroy(); resolve(line.slice(6)); }
        });
        res.on("error", reject);
      });
      r.on("error", reject);
      // give the server a tick to subscribe, then publish
      setTimeout(() => {
        deps.bus.publish({ type: "run", projectId: "p", run: { id: "r1", projectId: "p", status: "ready", reportName: "R", createdAt: deps.now(), finishedAt: deps.now(), stats: null } });
      }, 100);
    });

    const payload = JSON.parse(await received);
    expect(payload.run.id).toBe("r1");
    expect(payload.projectId).toBe("p");
  });
});
```

(If the duplicated `buildApp` import is awkward, keep only the dynamic `import("../app.js")` inside `listen` and remove the top static import. Ensure the file compiles.)

- [ ] **Step 4: Typecheck + test + commit.** `pnpm --filter @allure-station/server typecheck && pnpm --filter @allure-station/server test events`. Commit: `feat(events): project-scoped SSE route`.

---

### Task 6: UI — replace polling with `EventSource`

**Files:**
- Modify: `packages/web/src/api/client.ts`, `packages/web/src/pages/Project.tsx`
- Test: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Add `subscribeRuns` to the client.** In `client.ts`, extend `ApiClient` and the implementation. It returns an unsubscribe; it no-ops gracefully where `EventSource` is unavailable (e.g. jsdom):

```ts
import type { Project, Run, TrendPoint, RunEvent } from "@allure-station/shared";
// in ApiClient:
  subscribeRuns(projectId: string, onEvent: (event: RunEvent) => void): () => void;
// in the returned object (base is e.g. "/api"):
  subscribeRuns: (projectId, onEvent) => {
    if (typeof EventSource === "undefined") return () => {};
    const es = new EventSource(`${base}/projects/${projectId}/events`);
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data) as RunEvent); } catch { /* ignore malformed */ }
    };
    return () => es.close();
  },
```

- [ ] **Step 2: Use it in `Project.tsx`.** Remove `refetchInterval` from both queries. Add an effect that subscribes for the current project and updates the cache: upsert the run into `["runs", id]` and invalidate `["trends", id]` when a run is `ready`/`failed`.

```tsx
useEffect(() => {
  const unsub = api.subscribeRuns(id, (event) => {
    qc.setQueryData<Run[]>(["runs", id], (prev = []) => {
      const next = prev.filter((r) => r.id !== event.run.id);
      return [event.run, ...next].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    });
    if (event.run.status === "ready" || event.run.status === "failed") {
      qc.invalidateQueries({ queryKey: ["trends", id] });
    }
  });
  return unsub;
}, [id, qc]);
```

Keep the initial `useQuery` fetches (they seed state on load and after `EventSource` reconnects). Keep the `selectedRun` reset effect.

- [ ] **Step 3: Client test.** In `client.test.ts`, add a test that `subscribeRuns` returns a function and does not throw when `EventSource` is undefined (the jsdom default), and — if feasible with a stub — that a stubbed `EventSource` delivers a parsed event to `onEvent`. Minimal acceptable assertion: `expect(typeof api.subscribeRuns("p", () => {})).toBe("function")`.

- [ ] **Step 4: Typecheck + test + commit.** `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web test`. Commit: `feat(web): live run updates via EventSource (replaces polling)`.

---

### Task 7: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the events stream.** In the Job-queue / live section, add a short subsection:

```markdown
### Live updates (SSE)

The UI subscribes to `GET /api/projects/:projectId/events` (Server-Sent Events) and updates run
status in real time — no polling. Each message is a JSON `RunEvent` (`{ type: "run", projectId, run }`).

Events are delivered through a pluggable bus selected by `QUEUE_DRIVER`:
- `inprocess` (default): in-memory — single process, zero config.
- `bullmq`: Redis pub/sub on `REDIS_URL`, so the worker process and every API replica share one
  stream. No extra configuration beyond the Redis you already run for the queue.
```

- [ ] **Step 2: Commit.** `docs: live SSE updates section`.

---

## Final verification (after all tasks)

- [ ] `pnpm -r typecheck` clean; `pnpm -r test` green (server/worker/shared/web).
- [ ] Live: start `redis:7`, run `REDIS_TEST_URL=... pnpm --filter @allure-station/server test bus` (RedisBus conformance passes across two connections).
- [ ] Final code-review of the slice; fix; push.

## Self-review notes
- Type consistency: `RunEvent.run` is the shared `Run` (has `id, projectId, status, reportName, createdAt, finishedAt, stats`). The SSE test and conformance build `Run` literals matching that shape — keep them in sync with `runSchema`.
- `buildDeps` signature gains a 4th param; every caller (main, worker-main, test-helpers) is updated in Task 3 — grep `buildDeps(` to confirm none missed.
- `EventBus` driver is intentionally tied to `QUEUE_DRIVER` (no new env var): bullmq ⇒ multi-process ⇒ RedisBus; inprocess ⇒ InProcessBus. Documented in README.
