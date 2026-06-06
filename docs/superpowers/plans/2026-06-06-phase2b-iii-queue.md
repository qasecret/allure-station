# Allure Station — Slice 2b-iii (External BullMQ/Redis Queue + Worker Process) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make report generation horizontally scalable — swap the closure-based, completion-awaiting `JobQueue` for a **data + registered-processor** model with two drivers: the in-process default (unchanged single-container deployment) and a **BullMQ/Redis** queue consumed by a **separate worker process**. Keep in-process the zero-config default.

**Architecture:** Redesign `JobQueue` to `start(processor)` + `enqueue(data)` + `onIdle()` + `close()`, where jobs are serializable `GenerateJobData = {projectId, runId}` and `processGenerate(deps, data)` wraps the **unchanged** `runGeneration`. `InProcessQueue` runs the processor itself under a concurrency limit (fire-and-forget); `BullMQQueue` enqueues to Redis and a new `worker-main.ts` process runs a BullMQ `Worker` calling the same processor. The `/generate` route becomes fire-and-forget: it claims the run (`pending→generating`, already the case) and returns the `generating` run immediately — the UI already polls to convergence, and this removes the long-held HTTP connection during generation. `QUEUE_DRIVER=inprocess|bullmq` + `REDIS_URL` select the backend; an env-gated BullMQ conformance test runs against a real Redis (`REDIS_TEST_URL`).

**Tech Stack:** adds `bullmq@5.78.0` (pulls ioredis) to `@allure-station/worker`; Redis as a docker-compose service; a `worker` compose service for bullmq mode. Otherwise unchanged.

**Spike findings (Task 1 — DONE 2026-06-06, verified live vs redis:7):**
- `bullmq@5.78.0`. Connection: `{ connection: { url: REDIS_URL } }` (URL form works, matches our convention). **Worker's** connection MUST set `maxRetriesPerRequest: null` (bullmq overrides+warns otherwise); the producer `Queue` does not.
- `add(name, data, { attempts: 1, removeOnComplete: true, removeOnFail: true })` → throwing processor runs exactly once, no retry — correct, since `runGeneration`'s `catch` already `markFailed`s. (Retries would re-run a terminal run; `claimPending` only matches `pending`, so a naive retry redoes work — keep `attempts: 1`.)
- Redesigned interface (Q2) below; processor wired via `start(processor)` (not constructor) so the queue is constructable before deps and the BullMQ Worker can call the same processor in another process.
- `/generate` contract change (Q3): returns the `generating` run; **UI needs zero changes** (`Project.tsx` already polls `refetchInterval` while a run is `generating`); fixes the prior long-connection concern. API clients must poll `GET /api/projects/:id/runs/:runId` for terminal status.
- bullmq mode practically requires **shared DB + shared storage** (Postgres + S3/shared volume) since API and worker processes touch the same rows/files. Document.
- Tests: `InProcessQueue.onIdle()` makes them deterministic (`await inject(generate)` → `await deps.queue.onIdle()` → refetch → assert `ready`). ~8–10 assertion sites change across results/e2e + queue.test rewrite + config test. Env-gated bullmq test mirrors the S3/PG precedent.
- Graceful shutdown: SIGTERM → `await queue.close()`; reuse `failStaleGenerating` reconciliation in `worker-main` startup too.

---

## Redesigned interface (the contract this slice delivers)
```ts
// packages/worker/src/queue.ts
export type GenerateJobData = { projectId: string; runId: string };
export type JobProcessor = (data: GenerateJobData) => Promise<void>;

export interface JobQueue {
  /** Register the processor. InProcessQueue runs it on enqueue; BullMQ's worker-main calls it. */
  start(processor: JobProcessor): void;
  /** Fire-and-forget enqueue — does NOT await completion. */
  enqueue(data: GenerateJobData): Promise<void>;
  /** Resolves when all in-flight + queued jobs finish (deterministic tests + graceful drain). */
  onIdle(): Promise<void>;
  close(): Promise<void>;
}
```

---

## File Structure (changes)
```
packages/worker/package.json                   # + bullmq
packages/worker/src/queue.ts                    # REDESIGN: GenerateJobData/JobProcessor/JobQueue; InProcessQueue (start/enqueue/onIdle/close) + BullMQQueue
packages/worker/src/queue.test.ts               # REWRITE: enqueue/start/onIdle/concurrency/failure-swallow; + env-gated bullmq conformance
packages/server/src/generation.ts               # + processGenerate(deps, data) wrapper (runGeneration unchanged)
packages/server/src/routes/results.ts           # /generate: enqueue + return generating (drop await-completion)
packages/server/src/app.ts                      # buildApp wires deps.queue.start(d => processGenerate(deps, d))
packages/server/src/config.ts                   # + queueDriver (QUEUE_DRIVER, default inprocess) + redisUrl (REDIS_URL)
packages/server/src/deps.ts                     # NEW: buildDeps(config) shared by main + worker-main
packages/server/src/main.ts                     # use buildDeps + pick queue impl by driver; start in-process processor; SIGTERM close
packages/server/src/worker-main.ts              # NEW: bullmq consumer process (buildDeps + BullMQ Worker + reconciliation + SIGTERM)
packages/server/src/test-helpers.ts             # makeTestDeps: InProcessQueue (start wired by buildApp)
packages/server/src/**/*.test.ts                # onIdle()-then-refetch where they asserted terminal status off /generate
docker/docker-compose.yml                        # + redis service; + worker service (QUEUE_DRIVER=bullmq); api gets QUEUE_DRIVER/REDIS_URL (commented default inprocess)
docker/docker-compose.test.yml                   # + redis service (REDIS_TEST_URL)
README.md                                        # queue config + contract change + scaling + shared-DB/storage note
```

---

## Task 1: Spike — DONE
See "Spike findings". No code committed. Proceed.

---

## Task 2: Redesign queue.ts (interface + InProcessQueue) + processGenerate + rewrite queue.test

**Files:** `packages/worker/src/queue.ts`, `packages/worker/src/queue.test.ts`, `packages/server/src/generation.ts`.

- [ ] **Step 1: Redesign `queue.ts`** — the interface (above) + InProcessQueue. (BullMQQueue lands in Task 4; this task keeps the in-process default fully working.)
```ts
export type GenerateJobData = { projectId: string; runId: string };
export type JobProcessor = (data: GenerateJobData) => Promise<void>;

export interface JobQueue {
  start(processor: JobProcessor): void;
  enqueue(data: GenerateJobData): Promise<void>;
  onIdle(): Promise<void>;
  close(): Promise<void>;
}

/** In-process, concurrency-limited, fire-and-forget. Runs jobs in the API process. */
export class InProcessQueue implements JobQueue {
  #processor?: JobProcessor;
  #active = 0;
  readonly #pending: GenerateJobData[] = [];
  readonly #idleWaiters: Array<() => void> = [];
  #closed = false;
  constructor(private readonly concurrency = 2) {}

  start(processor: JobProcessor): void { this.#processor = processor; }

  async enqueue(data: GenerateJobData): Promise<void> {
    if (this.#closed) throw new Error("queue is closed");
    if (!this.#processor) throw new Error("queue.start(processor) not called");
    this.#pending.push(data);
    this.#drain();
  }

  #drain(): void {
    while (this.#active < this.concurrency && this.#pending.length > 0) {
      const data = this.#pending.shift()!;
      this.#active += 1;
      // Errors are swallowed: runGeneration already marks the run failed; a failed
      // job must not crash the queue or reject the (already-returned) enqueue.
      Promise.resolve(this.#processor!(data))
        .catch(() => {})
        .finally(() => {
          this.#active -= 1;
          if (this.#active === 0 && this.#pending.length === 0) {
            this.#idleWaiters.splice(0).forEach((r) => r());
          } else {
            this.#drain();
          }
        });
    }
  }

  onIdle(): Promise<void> {
    if (this.#active === 0 && this.#pending.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  async close(): Promise<void> { this.#closed = true; await this.onIdle(); }
}
```

- [ ] **Step 2: `processGenerate` wrapper** in `packages/server/src/generation.ts` (keep `runGeneration` exactly as is, add):
```ts
import type { GenerateJobData } from "@allure-station/worker";
/** Job processor: run a generation job from its serialized data. */
export async function processGenerate(deps: AppDeps, data: GenerateJobData): Promise<void> {
  await runGeneration(deps, data.projectId, data.runId);
}
```

- [ ] **Step 3: Rewrite `queue.test.ts`** for the new API (the old closure `add` is gone):
```ts
import { describe, it, expect } from "vitest";
import { InProcessQueue, type GenerateJobData } from "./queue.js";

describe("InProcessQueue", () => {
  it("runs enqueued jobs via the registered processor, honoring concurrency, and onIdle waits", async () => {
    const q = new InProcessQueue(2);
    let active = 0, maxActive = 0; const done: string[] = [];
    q.start(async (d) => { active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20)); active--; done.push(d.runId); });
    for (const id of ["a","b","c","d"]) await q.enqueue({ projectId: "p", runId: id });
    await q.onIdle();
    expect(done.sort()).toEqual(["a","b","c","d"]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
  it("a throwing processor does not reject enqueue and does not stall the queue", async () => {
    const q = new InProcessQueue(1); const seen: string[] = [];
    q.start(async (d) => { if (d.runId === "boom") throw new Error("x"); seen.push(d.runId); });
    await q.enqueue({ projectId: "p", runId: "boom" });
    await q.enqueue({ projectId: "p", runId: "ok" });
    await q.onIdle();
    expect(seen).toEqual(["ok"]); // boom failed silently, ok still ran
  });
  it("enqueue before start throws", async () => {
    const q = new InProcessQueue(1);
    await expect(q.enqueue({ projectId: "p", runId: "x" } as GenerateJobData)).rejects.toThrow(/start/);
  });
});
```

- [ ] **Step 4:** `pnpm --filter @allure-station/worker test` → green. `typecheck` → worker clean (server will FAIL typecheck until Task 3 updates consumers — expected; defer commit to end of Task 3).

---

## Task 3: Wire consumers — route fire-and-forget, buildApp/buildDeps, config, tests

**Files:** `routes/results.ts`, `app.ts`, `config.ts`, `deps.ts` (new), `main.ts`, `test-helpers.ts`, affected `*.test.ts`.

- [ ] **Step 1: `/generate` route** (`results.ts`) — enqueue + return generating:
```ts
  app.post("/projects/:projectId/generate", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await deps.projects.get(projectId))) return reply.code(404).send({ error: "project not found" });
    const runs = await deps.runs.listByProject(projectId);
    const pending = runs.find((r) => r.status === "pending");
    if (!pending) return reply.code(409).send({ error: "no pending run to generate" });
    if (!(await deps.runs.claimPending(pending.id))) return reply.code(409).send({ error: "run is already being generated" });
    await deps.queue.enqueue({ projectId, runId: pending.id });
    return reply.code(202).send(await deps.runs.get(pending.id)); // 202 Accepted; status: "generating"
  });
```
(Note: status code becomes **202** to signal async acceptance. Drop the old `try/catch` around the queue call.)

- [ ] **Step 2: `app.ts`** — wire the processor in `buildApp`, after deps are available and routes registered:
```ts
import { processGenerate } from "./generation.js";
// inside buildApp, before `return app;`:
  deps.queue.start((data) => processGenerate(deps, data));
```
`AppDeps.queue` stays `JobQueue` (interface signature changed, type name same).

- [ ] **Step 3: `config.ts`** — add `queueDriver: "inprocess" | "bullmq"` (`QUEUE_DRIVER`, default `"inprocess"`) and `redisUrl: string | undefined` (`REDIS_URL`). Keep `concurrency`.

- [ ] **Step 4: `deps.ts`** (new) — factor the deps construction shared by main + worker-main:
```ts
export function buildDeps(config: AppConfig, queue: JobQueue): AppDeps {
  const { db } = createDb(config.db.driver, { url: config.db.url }); // migrate run by caller
  return { projects: new ProjectRepository(db), runs: new RunRepository(db),
    storage: createStorage(config.storage), queue, workDir: resolve(config.workDir),
    version: config.version, now: () => new Date().toISOString(), newId: () => nanoid(12) };
}
```
(Adjust to return the `migrate` too, or expose a `createDb`+`migrate` step the caller awaits — keep main/worker-main calling `await migrate()` before listening/consuming.)

- [ ] **Step 5: `main.ts`** — pick the queue impl by driver, build deps, migrate, wire+listen:
```ts
const config = loadConfig();
const queue = config.queueDriver === "bullmq"
  ? new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency }) // Task 4
  : new InProcessQueue(config.concurrency);
const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();
const deps = buildDeps(config, queue, db); // pass db in to avoid a second createDb
const app = buildApp(deps);               // buildApp calls queue.start(processGenerate) — runs jobs in-process for inprocess mode
await new RunRepository(db).failStaleGenerating(new Date().toISOString());
// SIGTERM -> await queue.close(); app.close();
app.listen(...);
```
For **bullmq** mode, the API process should NOT run jobs — `buildApp` calling `queue.start(...)` on a `BullMQQueue` must be a **no-op in the API process** (BullMQQueue.start only constructs the Worker in worker-main; see Task 4). Ensure that's the case so the API only enqueues.

- [ ] **Step 6: `test-helpers.ts`** — keep `new InProcessQueue(config.concurrency ?? 2)`; do NOT call `start` here (buildApp does). Tests that use the queue directly get `deps.queue`.

- [ ] **Step 7: Update tests to the onIdle pattern.** Where a test asserted terminal status off the `/generate` response, change to: `const gen = await app.inject(generate); expect(gen.statusCode).toBe(202); expect(gen.json().status).toBe("generating"); await deps.queue.onIdle(); const run = await app.inject(GET .../runs/:id); expect(run.json().status).toBe("ready"|"failed");`. Affected (per spike): `results.test.ts` (ingest/serve, traversal→ready, MIME-needs-ready, orphan→failed, the 409-after-first), `e2e.test.ts` (both incl. two-run trends). Keep assertions' intent identical (final status, stats, served report) — only insert the `onIdle()` + refetch. The 404-unknown-project and 409-no-pending tests need no change.

- [ ] **Step 8: Verify (in-process default).** `pnpm --filter @allure-station/server test` → all green via the onIdle pattern. `pnpm --filter @allure-station/server typecheck` clean. Root `pnpm test` + `pnpm typecheck` green.
- [ ] **Step 9: Commit (Tasks 2+3).** `git add -A && git commit -m "feat(queue): data+processor JobQueue, fire-and-forget /generate (202, returns generating), in-process driver with onIdle"`

---

## Task 4: BullMQQueue + worker-main + env-gated conformance (verify live vs Redis)

**Files:** `queue.ts` (+BullMQQueue), `worker-main.ts` (new), `package.json` (+bullmq, +`start:worker` script), `queue.test.ts` (+env-gated bullmq test).

- [ ] **Step 1: Deps.** `pnpm --filter @allure-station/worker add bullmq` (pin exact 5.78.0).
- [ ] **Step 2: `BullMQQueue`** in `queue.ts`:
```ts
import { Queue, Worker, type Job } from "bullmq";
const QUEUE_NAME = "generate";
export class BullMQQueue implements JobQueue {
  readonly #queue: Queue;
  #worker?: Worker;
  readonly #connection: { url: string };
  readonly #concurrency: number;
  constructor(cfg: { url: string; concurrency?: number }) {
    this.#connection = { url: cfg.url };
    this.#concurrency = cfg.concurrency ?? 2;
    this.#queue = new Queue(QUEUE_NAME, { connection: this.#connection });
  }
  /** In the API process this is never called with a processor that should run; only worker-main calls start. */
  start(processor: JobProcessor): void {
    this.#worker = new Worker(QUEUE_NAME, async (job: Job) => { await processor(job.data as GenerateJobData); },
      { connection: { ...this.#connection, maxRetriesPerRequest: null }, concurrency: this.#concurrency });
  }
  async enqueue(data: GenerateJobData): Promise<void> {
    await this.#queue.add(QUEUE_NAME, data, { attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  async onIdle(): Promise<void> { await this.#queue.drain(); } // best-effort; tests use the env-gated path
  async close(): Promise<void> { await this.#worker?.close(); await this.#queue.close(); }
}
```
IMPORTANT for Task 3 Step 5: in the API process for bullmq mode, we must NOT construct a Worker. Cleanest: `buildApp` only calls `queue.start(...)` for the in-process driver. Make `main.ts` (not buildApp) own the decision: call `queue.start(processor)` ONLY when `queueDriver === "inprocess"`. Adjust Task 3 Step 2/Step 5 accordingly — move the `queue.start(...)` call out of `buildApp` and into `main.ts` (inprocess) / `worker-main.ts` (bullmq), passing the processor `(d) => processGenerate(deps, d)`. (buildApp must still work for tests, which use InProcessQueue — so tests call `deps.queue.start(...)` via a helper, or buildApp keeps starting it for InProcessQueue only via an `instanceof`/flag. Simplest: a `wireQueue(deps)` helper that tests + main call; worker-main wires its own.)

- [ ] **Step 3: `worker-main.ts`** (new entrypoint):
```ts
const config = loadConfig();
const queue = new BullMQQueue({ url: config.redisUrl!, concurrency: config.concurrency });
const { db, migrate } = createDb(config.db.driver, { url: config.db.url });
await migrate();
const deps = buildDeps(config, queue, db);
await new RunRepository(db).failStaleGenerating(new Date().toISOString()); // reconcile orphans on boot
queue.start((data) => processGenerate(deps, data)); // constructs the BullMQ Worker
const shutdown = async () => { await queue.close(); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
console.log("allure-station worker consuming 'generate' jobs");
```
Add `"start:worker": "tsx src/worker-main.ts"` to `packages/server/package.json`.

- [ ] **Step 4: env-gated bullmq conformance** in `queue.test.ts`:
```ts
const url = process.env.REDIS_TEST_URL;
(url ? describe : describe.skip)("BullMQQueue (requires REDIS_TEST_URL)", () => {
  it("enqueued data is processed by a started worker", async () => {
    const producer = new BullMQQueue({ url: url!, concurrency: 2 });
    const consumer = new BullMQQueue({ url: url!, concurrency: 2 });
    const seen: string[] = [];
    consumer.start(async (d) => { seen.push(d.runId); });
    await producer.enqueue({ projectId: "p", runId: "r1" });
    await vi.waitFor(() => expect(seen).toContain("r1"), { timeout: 5000 });
    await producer.close(); await consumer.close();
  });
});
```

- [ ] **Step 5: Verify LIVE.** `docker run -d --name as-redis -p 6379:6379 redis:7`; `REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @allure-station/worker test` → bullmq test PASSES (report it ran, not skipped). Skip path: without the env, it SKIPS; in-process tests pass. `docker rm -f as-redis`.
- [ ] **Step 6: Verify typecheck + full suite** (no redis env) green. Commit: `git add -A && git commit -m "feat(queue): BullMQQueue + worker-main process + env-gated Redis conformance"`

---

## Task 5: Compose (redis + worker service) + config wiring + docs

**Files:** `docker/docker-compose.yml`, `docker/docker-compose.test.yml`, `README.md`.

- [ ] **Step 1: `docker-compose.test.yml`** — add a `redis:7` service (sibling to minio/postgres) for CI's env-gated bullmq conformance (`REDIS_TEST_URL=redis://localhost:6379`).
- [ ] **Step 2: `docker-compose.yml`** — add a `redis:7` service and a `worker` service (same image as `allure-station`, `command` runs `start:worker`, env `QUEUE_DRIVER=bullmq` + `REDIS_URL=redis://redis:6379` + the SAME `DB_DRIVER`/`STORAGE_DRIVER` as the api). Keep the default `allure-station` (api) on `QUEUE_DRIVER=inprocess` (zero-config) with COMMENTED env showing how to switch the stack to bullmq (api: `QUEUE_DRIVER=bullmq` + `REDIS_URL`; enable the `worker` + `redis` services). Put the `worker` service behind a `bullmq` profile so default `docker compose up` stays single-process in-process. Document that **bullmq mode needs shared DB (postgres) + shared storage (s3 or a shared volume)**.
- [ ] **Step 3: README** — "Job queue" section: `QUEUE_DRIVER=inprocess` (default, runs jobs in the API process) vs `bullmq` (`REDIS_URL` + run the `worker` process; scale by running N workers); the **`/generate` contract** (returns 202 + `generating`; poll `GET /runs/:id` for terminal status); the shared-DB/storage requirement for bullmq; how to run the Redis conformance (`docker compose -f docker/docker-compose.test.yml up -d redis` + `REDIS_TEST_URL`).
- [ ] **Step 4: Verify + commit.** Root `pnpm test`+`typecheck` green; `docker compose -f docker/docker-compose.yml config` (+`--profile bullmq`) validates; optional full-stack bullmq smoke (api + worker + redis + postgres + minio: create→send-results→generate(202)→poll until ready→serve) if time permits, else note Task 4 proved the worker path. `git add -A && git commit -m "feat(queue): redis + worker compose services (bullmq profile) + docs"`

---

## Self-Review (spec coverage)
- **Horizontal scale:** Tasks 2–5 — data+processor queue; BullMQ + separate worker-main; scale by N workers.
- **In-process default preserved:** InProcessQueue runs jobs in the API process; default compose unchanged.
- **Fixes prior concern:** `/generate` no longer holds the HTTP connection (202 + generating).
- **Parity/verification:** env-gated bullmq conformance verified live vs Redis; onIdle keeps the suite deterministic.

## Out of scope (later)
- Live `watch` over SSE/WebSocket — Slice 2c.
- Job progress reporting, priorities, rate-limiting, dead-letter handling, BullMQ dashboard.
- Content-addressed dedupe; embedded-report trends (upstream-blocked).

## Risks
1. **`/generate` contract change** (202 + `generating`, poll for terminal). UI unaffected (already polls); document for API clients. Biggest semantic shift.
2. **`onIdle()` determinism** — the in-process drain/idle logic must resolve only when active AND pending are both zero; an off-by-one flakes the whole suite. Covered directly in `queue.test.ts`.
3. **API process must not consume in bullmq mode** — wire `queue.start(processor)` only in `main.ts` (inprocess) / `worker-main.ts` (bullmq), NOT unconditionally in `buildApp`. (Plan Task 4 Step 2 corrects the Task 3 wiring to a `wireQueue` helper.)
4. **Graceful shutdown** — SIGTERM → `await queue.close()` in both entrypoints; reuse `failStaleGenerating` on worker-main boot to reconcile runs orphaned by a crash.
5. **Retries** — `attempts: 1` (no BullMQ retry); `runGeneration` already `markFailed`s and `claimPending` won't re-match a terminal run. If retries are ever enabled, add an idempotency guard (re-check status is `generating`).
6. **bullmq needs shared DB+storage** — two processes on the same rows/files; doc + compose default to postgres+s3 in the bullmq profile.
