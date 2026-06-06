# Allure Station — Slice 2b-i (S3 Storage + Driver Abstraction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make storage pluggable for real — add an **S3-compatible driver** (MinIO for dev/test parity) behind a reshaped `StorageDriver` interface that has **no local-only assumptions**, resolving code-review #5. Reports/results live in object storage with backups & horizontal-scale potential, while local-filesystem stays the zero-config default.

**Architecture:** Replace the local-only `resolveLocalPath`/`move` methods with two backend-agnostic primitives: `materializeDir(prefix)→{dir,dispose}` (hydrate a prefix to a temp local dir for Allure's `readDirectory`) and `readStream(key)→{body,contentType,contentLength}` (stream a single object for HTTP serving). Report publishing writes directly to the final prefix (no temp/rename); **serving is gated on `run.status === 'ready'`**, which both gives an identical publish path for every driver and closes the "serve a half-written/failed report" gap. A storage factory selects `local` or `s3` by config. Driver correctness is locked by a single shared **conformance suite** run against LocalDriver (always) and S3Driver (when an S3 endpoint env var is set).

**Tech Stack:** adds `@aws-sdk/client-s3@3.x`, `@aws-sdk/lib-storage@3.x`, and `mrmime` (tiny content-type lookup) to `@allure-station/server`; MinIO as a docker-compose service for dev/CI. Otherwise unchanged.

**Spike findings (Task 1 — DONE 2026-06-06, verified live against MinIO):**
- Client config that works: `new S3Client({ endpoint, forcePathStyle: true, region: "us-east-1", credentials })`. **`forcePathStyle: true` is mandatory** for MinIO. `@aws-sdk/client-s3@3.1063.0`, no checksum-header issues on `minio/minio:latest` (escape hatch if a pinned combo breaks: `requestChecksumCalculation: "WHEN_REQUIRED"`).
- `GetObject` `Body` **is a Node `Readable`** — stream it to `reply.send(body)`; don't buffer. Not-found = `err.name === "NoSuchKey"` (GetObject) / `"NotFound"` (HeadObject), both `$metadata.httpStatusCode === 404`.
- `materializeDir`: ListObjectsV2 (paginated) under prefix → download each preserving `key.slice(prefix.length)` → temp dir; ~10ms for 2 files. LocalDriver can return its real dir with a no-op dispose (zero-copy).
- **Atomic publish:** drop `move`; write report straight to the final prefix and gate serving on `run.status==='ready'` (the DB already sets `ready` last in `runGeneration`, and has the `idx_runs_project_status_created` index). Removes `move` from the interface; LocalDriver's `putDir` (mkdir-p + cp -r) lands files directly.
- **MIME:** S3 returns `application/octet-stream` unless `ContentType` is set at put time. Set `ContentType` per file in `putDir`/`putBuffer` via `mrmime`, and have each driver's `readStream` also fill `contentType` from the key extension so the serve route is driver-agnostic.
- **Test strategy:** env-gated shared conformance suite (reject in-memory mocks — they miss the path-style/NoSuchKey realities the spike found; reject testcontainers — flaky in-process). MinIO via docker-compose, `S3_TEST_ENDPOINT` gates the S3 cases.

---

## Reshaped interface (the contract this slice delivers)
```ts
import type { Readable } from "node:stream";

export interface StorageDriver {
  putDir(key: string, localDir: string): Promise<void>;     // recursive upload; sets per-file ContentType
  putBuffer(key: string, data: Buffer): Promise<void>;      // sets ContentType from key ext
  read(key: string): Promise<Buffer>;                       // full read; throws if absent
  exists(key: string): Promise<boolean>;                    // true if key OR any object under prefix exists
  remove(key: string): Promise<void>;                       // recursive delete of key/prefix
  /** Hydrate everything under `prefix` to a temp local dir; caller MUST dispose(). Local = real dir, no-op dispose. */
  materializeDir(prefix: string): Promise<{ dir: string; dispose(): Promise<void> }>;
  /** Open one object for HTTP serving; rejects with a not-found error (NoSuchKey/ENOENT) when absent. */
  readStream(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }>;
}
```
**Removed:** `resolveLocalPath`, `move`. **Added:** `materializeDir`, `readStream`.

---

## File Structure (changes)
```
packages/server/package.json                          # +@aws-sdk/client-s3, +@aws-sdk/lib-storage, +mrmime
packages/server/src/storage/driver.ts                 # MODIFY: reshaped interface (above)
packages/server/src/storage/local-driver.ts           # MODIFY: add materializeDir/readStream; drop resolveLocalPath/move; set ContentType N/A (local)
packages/server/src/storage/s3-driver.ts              # NEW: S3Driver
packages/server/src/storage/conformance.ts            # NEW: shared conformance suite (exported fn)
packages/server/src/storage/local-driver.test.ts      # MODIFY: run conformance(local) + keep escape-guard test
packages/server/src/storage/s3-driver.test.ts         # NEW: env-gated conformance(s3)
packages/server/src/storage/factory.ts                # NEW: createStorage(config)
packages/server/src/storage/mime.ts                   # NEW: contentTypeFor(key) via mrmime (shared by drivers)
packages/server/src/generation.ts                     # MODIFY: materializeDir+dispose; single putDir; drop move/.report.tmp
packages/server/src/routes/runs.ts                    # MODIFY: serve via readStream + readiness gate + path sanitize
packages/server/src/config.ts                         # MODIFY: STORAGE_DRIVER + S3_* config
packages/server/src/main.ts                           # MODIFY: use createStorage(config)
docker/docker-compose.yml                             # MODIFY: add minio service + console
docker/docker-compose.test.yml                        # NEW (optional): minio for CI conformance
README or docs/                                        # MODIFY: storage config + S3_TEST_ENDPOINT docs
```

---

## Task 1: Spike — DONE
See "Spike findings" above. No code committed. Proceed.

---

## Task 2: Reshape interface + LocalDriver + shared conformance suite

**Files:** `storage/driver.ts`, `storage/mime.ts`, `storage/local-driver.ts`, `storage/conformance.ts`, `storage/local-driver.test.ts`; `packages/server/package.json` (+`mrmime`).

- [ ] **Step 1: Add mrmime + the mime helper.**
`pnpm --filter @allure-station/server add mrmime@2`.
`storage/mime.ts`:
```ts
import { lookup } from "mrmime";
/** Content-type for a storage key/filename; defaults to octet-stream. */
export function contentTypeFor(key: string): string {
  return lookup(key) ?? "application/octet-stream";
}
```

- [ ] **Step 2: Replace the interface** in `storage/driver.ts` with the reshaped `StorageDriver` (see "Reshaped interface" above), importing `Readable` from `node:stream`.

- [ ] **Step 3: Write the conformance suite** `storage/conformance.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageDriver } from "./driver.js";

export function runStorageConformance(
  name: string,
  makeDriver: () => Promise<{ driver: StorageDriver; cleanup: () => Promise<void> }>,
): void {
  describe(`StorageDriver conformance: ${name}`, () => {
    let driver: StorageDriver;
    let cleanup: () => Promise<void>;
    let srcDir: string;
    beforeEach(async () => {
      ({ driver, cleanup } = await makeDriver());
      srcDir = await mkdtemp(join(tmpdir(), "conf-src-"));
      await mkdir(join(srcDir, "sub"), { recursive: true });
      await writeFile(join(srcDir, "index.html"), "<html>");
      await writeFile(join(srcDir, "sub", "app.js"), "console.log(1)");
    });
    afterEach(async () => { await rm(srcDir, { recursive: true, force: true }); await cleanup(); });

    it("putBuffer + read round-trips", async () => {
      await driver.putBuffer("a/b.txt", Buffer.from("hi"));
      expect((await driver.read("a/b.txt")).toString()).toBe("hi");
    });
    it("exists: false for missing, true for object and prefix", async () => {
      expect(await driver.exists("nope")).toBe(false);
      await driver.putBuffer("p/x.txt", Buffer.from("1"));
      expect(await driver.exists("p/x.txt")).toBe(true);
      expect(await driver.exists("p")).toBe(true); // prefix
    });
    it("putDir + materializeDir preserves relative layout", async () => {
      await driver.putDir("proj/results", srcDir);
      const { dir, dispose } = await driver.materializeDir("proj/results");
      const top = (await readdir(dir)).sort();
      expect(top).toContain("index.html");
      expect(top).toContain("sub");
      expect((await readdir(join(dir, "sub")))).toEqual(["app.js"]);
      await dispose();
    });
    it("readStream streams an object and sets content-type; rejects on missing", async () => {
      await driver.putDir("proj/report", srcDir);
      const got = await driver.readStream("proj/report/index.html");
      let n = 0; for await (const c of got.body) n += (c as Buffer).length;
      expect(n).toBe(6);
      expect(got.contentType).toMatch(/html/);
      await expect(driver.readStream("proj/report/missing.html")).rejects.toBeTruthy();
    });
    it("remove deletes a whole prefix", async () => {
      await driver.putDir("proj/results", srcDir);
      await driver.remove("proj/results");
      expect(await driver.exists("proj/results")).toBe(false);
    });
  });
}
```

- [ ] **Step 4: Rewrite LocalDriver** to the new interface. Keep the `#path` root-escape guard. Add `materializeDir` (return the real dir + no-op dispose) and `readStream` (fs stream + `contentTypeFor` + size via stat); drop `resolveLocalPath` and `move`.
```ts
import { cp, mkdir, readFile, rm, writeFile, access, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { StorageDriver } from "./driver.js";
import { contentTypeFor } from "./mime.js";

export class LocalDriver implements StorageDriver {
  readonly #root: string;
  constructor(root: string) { this.#root = resolve(root); }
  #path(key: string): string {
    const p = resolve(this.#root, key);
    if (p !== this.#root && !p.startsWith(this.#root + sep)) throw new Error(`key escapes storage root: ${key}`);
    return p;
  }
  async putDir(key: string, localDir: string): Promise<void> {
    const dest = this.#path(key);
    await mkdir(dest, { recursive: true });
    await cp(localDir, dest, { recursive: true });
  }
  async putBuffer(key: string, data: Buffer): Promise<void> {
    const dest = this.#path(key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }
  async read(key: string): Promise<Buffer> { return readFile(this.#path(key)); }
  async exists(key: string): Promise<boolean> {
    try { await access(this.#path(key)); return true; } catch { return false; }
  }
  async remove(key: string): Promise<void> { await rm(this.#path(key), { recursive: true, force: true }); }
  async materializeDir(prefix: string): Promise<{ dir: string; dispose(): Promise<void> }> {
    return { dir: this.#path(prefix), dispose: async () => {} }; // zero-copy; do NOT delete real storage
  }
  async readStream(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }> {
    const p = this.#path(key);
    const s = await stat(p); // throws ENOENT if missing → not-found
    return { body: createReadStream(p), contentType: contentTypeFor(key), contentLength: s.size };
  }
}
```
(Note: `exists("p")` for a prefix dir returns true via `access` on the directory — works since LocalDriver stores prefixes as real dirs.)

- [ ] **Step 5: Wire the conformance suite for local** in `local-driver.test.ts` (replace the old bespoke tests; KEEP a dedicated path-escape test since that's LocalDriver-specific):
```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDriver } from "./local-driver.js";
import { runStorageConformance } from "./conformance.js";

runStorageConformance("local", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-store-"));
  return { driver: new LocalDriver(root), cleanup: () => rm(root, { recursive: true, force: true }) };
});

describe("LocalDriver path-escape guard", () => {
  it("rejects keys that escape the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "esc-"));
    const d = new LocalDriver(root);
    await expect(d.putBuffer("../evil.txt", Buffer.from("x"))).rejects.toThrow(/escapes/);
    await rm(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6:** `pnpm --filter @allure-station/server test src/storage` → conformance(local) + escape test green. `pnpm --filter @allure-station/server typecheck` will FAIL until Task 3 (generation/runs still call the removed methods) — that's expected; proceed to Task 3 before committing. **Defer commit to end of Task 3.**

---

## Task 3: Update consumers (generation + serving) to the new interface

**Files:** `generation.ts`, `routes/runs.ts`, plus any test touch-ups.

- [ ] **Step 1: `generation.ts`** — materialize results, single direct publish, dispose in finally:
```ts
export async function runGeneration(deps: AppDeps, projectId: string, runId: string): Promise<void> {
  const resultsKey = `${projectId}/runs/${runId}/results`;
  if (!(await deps.storage.exists(resultsKey))) throw new Error(`no results staged for run ${runId}`);

  const jobDir = join(deps.workDir, runId);
  const outDir = join(jobDir, "report");
  const materialized = await deps.storage.materializeDir(resultsKey);
  try {
    await mkdir(jobDir, { recursive: true });
    const run = await deps.runs.get(runId);
    const { stats } = await generateReport({
      resultsDirs: [materialized.dir],
      outputDir: outDir,
      reportName: run?.reportName ?? "Allure Report",
    });
    await deps.storage.putDir(`${projectId}/runs/${runId}/report`, outDir); // direct to final prefix
    await deps.runs.markReady(runId, stats, deps.now());
  } catch (err) {
    await deps.runs.markFailed(runId, deps.now());
    throw err;
  } finally {
    await materialized.dispose();
    await rm(jobDir, { recursive: true, force: true });
  }
}
```
(Drops `.report.tmp` + `move`. The `exists` guard from finding #1 stays. `dispose()` is a no-op for local, real cleanup for S3.)

- [ ] **Step 2: `routes/runs.ts` report route** — readiness gate + ownership + stream + path sanitize. Remove the old `sendFile`/MIME-map/`sep` machinery:
```ts
  app.get("/projects/:projectId/runs/:runId/report/*", async (req, reply) => {
    const { projectId, runId } = req.params as { projectId: string; runId: string };
    const rel = (req.params as Record<string, string>)["*"] || "index.html";
    if (rel.split("/").some((seg) => seg === ".." )) return reply.code(400).send({ error: "bad path" });

    const run = await deps.runs.get(runId);
    if (!run || run.projectId !== projectId || run.status !== "ready") {
      return reply.code(404).send({ error: "not found" });
    }
    try {
      const obj = await deps.storage.readStream(`${projectId}/runs/${runId}/report/${rel}`);
      if (obj.contentType) reply.header("content-type", obj.contentType);
      if (obj.contentLength != null) reply.header("content-length", String(obj.contentLength));
      return reply.send(obj.body);
    } catch (err) {
      const e = err as { code?: string; name?: string };
      if (e.code === "ENOENT" || e.name === "NoSuchKey") return reply.code(404).send({ error: "not found" });
      throw err;
    }
  });
```
This also closes two earlier-deferred items: serves only `ready` runs (no partial/failed reports) and enforces project ownership on the report path.

- [ ] **Step 3: Update affected server tests.** The existing `results.test.ts`/`e2e.test.ts` real-generation tests fetch `report/index.html` AFTER generation completes (run is `ready`), so they still pass with the readiness gate. Confirm; if any test fetched a report before the run was ready, fix the test to await ready. The report-serving content-type assertions still hold (mrmime via readStream).

- [ ] **Step 4:** `pnpm --filter @allure-station/server test` (whole suite) + `typecheck` → all green now.
- [ ] **Step 5: Commit (Tasks 2+3 together).**
`git add packages/server && git commit -m "refactor(storage): backend-agnostic StorageDriver (materializeDir/readStream), drop resolveLocalPath/move, gate report serving on ready (code-review #5)"`

---

## Task 4: Implement S3Driver + env-gated conformance

**Files:** `storage/s3-driver.ts`, `storage/s3-driver.test.ts`; `package.json` (+aws-sdk).

- [ ] **Step 1: Deps.** `pnpm --filter @allure-station/server add @aws-sdk/client-s3@3 @aws-sdk/lib-storage@3`.

- [ ] **Step 2: Implement `S3Driver`** satisfying `StorageDriver`. Key points from the spike: `forcePathStyle`, paginated ListObjectsV2, `ContentType` via `contentTypeFor`, `Body` is a `Readable`, bulk delete, NoSuchKey handling. Include `ensureBucket()`/`dropBucket()` test helpers (used only by the conformance harness).
```ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand, CreateBucketCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { glob } from "node:fs/promises"; // or a small recursive walk helper if glob unavailable in Node 20
import type { StorageDriver } from "./driver.js";
import { contentTypeFor } from "./mime.js";

export interface S3Config {
  endpoint?: string; region: string; bucket: string; forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class S3Driver implements StorageDriver {
  readonly #c: S3Client;
  readonly #bucket: string;
  constructor(cfg: S3Config) {
    this.#bucket = cfg.bucket;
    this.#c = new S3Client({ endpoint: cfg.endpoint, region: cfg.region,
      forcePathStyle: cfg.forcePathStyle ?? true, credentials: cfg.credentials });
  }
  async putBuffer(key: string, data: Buffer): Promise<void> {
    await this.#c.send(new PutObjectCommand({ Bucket: this.#bucket, Key: key, Body: data, ContentType: contentTypeFor(key) }));
  }
  async putDir(key: string, localDir: string): Promise<void> {
    // walk localDir, upload each file under `${key}/${relativePath}` with ContentType
    for (const file of await walkFiles(localDir)) {
      const rel = relative(localDir, file).split(sep).join("/");
      const up = new Upload({ client: this.#c, params: {
        Bucket: this.#bucket, Key: `${key}/${rel}`, Body: (await import("node:fs")).createReadStream(file),
        ContentType: contentTypeFor(rel) } });
      await up.done();
    }
  }
  async read(key: string): Promise<Buffer> {
    const r = await this.#c.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    return Buffer.from(await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  async exists(key: string): Promise<boolean> {
    const r = await this.#c.send(new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: key, MaxKeys: 1 }));
    return (r.KeyCount ?? 0) > 0;
  }
  async remove(key: string): Promise<void> {
    for await (const batch of this.#listKeys(key)) {
      if (batch.length) await this.#c.send(new DeleteObjectsCommand({ Bucket: this.#bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }));
    }
  }
  async materializeDir(prefix: string): Promise<{ dir: string; dispose(): Promise<void> }> {
    const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const dir = await mkdtemp(join(tmpdir(), "s3mat-"));
    for await (const batch of this.#listKeys(norm)) {
      for (const k of batch) {
        const rel = k.slice(norm.length); if (!rel) continue;
        const dest = join(dir, rel); await mkdir(dirname(dest), { recursive: true });
        const obj = await this.#c.send(new GetObjectCommand({ Bucket: this.#bucket, Key: k }));
        await pipeline(obj.Body as Readable, createWriteStream(dest));
      }
    }
    return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
  }
  async readStream(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }> {
    const r = await this.#c.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key })); // throws NoSuchKey if absent
    return { body: r.Body as Readable, contentType: r.ContentType ?? contentTypeFor(key), contentLength: r.ContentLength };
  }
  async *#listKeys(prefix: string): AsyncGenerator<string[]> {
    let token: string | undefined;
    do {
      const r = await this.#c.send(new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, ContinuationToken: token }));
      yield (r.Contents ?? []).map((o) => o.Key!).filter(Boolean);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
  // test-only helpers
  async ensureBucket(): Promise<void> { try { await this.#c.send(new CreateBucketCommand({ Bucket: this.#bucket })); } catch { /* exists */ } }
  async dropBucket(): Promise<void> { await this.remove(""); try { await this.#c.send(new DeleteBucketCommand({ Bucket: this.#bucket })); } catch {} }
}
```
Add a `walkFiles(dir)` recursive helper (or use `node:fs` `glob` if available on Node 20; otherwise a small readdir-recursive). The spike confirmed these ops against MinIO.

- [ ] **Step 3: env-gated conformance test** `storage/s3-driver.test.ts`:
```ts
import { describe } from "vitest";
import { randomUUID } from "node:crypto";
import { S3Driver } from "./s3-driver.js";
import { runStorageConformance } from "./conformance.js";

const ep = process.env.S3_TEST_ENDPOINT;
const d = ep ? describe : describe.skip;
d("s3 (requires S3_TEST_ENDPOINT)", () => {
  runStorageConformance("s3", async () => {
    const driver = new S3Driver({
      endpoint: ep, region: "us-east-1", bucket: `test-${randomUUID()}`, forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_TEST_KEY ?? "minio", secretAccessKey: process.env.S3_TEST_SECRET ?? "minio12345" },
    });
    await driver.ensureBucket();
    return { driver, cleanup: () => driver.dropBucket() };
  });
});
```

- [ ] **Step 4: Verify.** Without env: `pnpm --filter @allure-station/server test src/storage` → s3 suite SKIPS, local passes. With MinIO: `docker compose -f docker/docker-compose.test.yml up -d` (Task 5), then `S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_KEY=minio S3_TEST_SECRET=minio12345 pnpm --filter @allure-station/server test src/storage` → s3 conformance passes. `typecheck` clean.
- [ ] **Step 5: Commit.** `git add packages/server && git commit -m "feat(storage): S3Driver (@aws-sdk/client-s3) + env-gated conformance suite"`

---

## Task 5: Storage factory + config + compose wiring

**Files:** `storage/factory.ts`, `config.ts`, `main.ts`, `docker/docker-compose.yml`, `docker/docker-compose.test.yml`, docs.

- [ ] **Step 1: Config.** Extend `AppConfig`/`loadConfig`:
```ts
export type StorageBackend = "local" | "s3";
export interface AppConfig { /* ...existing... */
  storage: { backend: StorageBackend; localRoot: string;
    s3?: { endpoint?: string; region: string; bucket: string; forcePathStyle: boolean;
           credentials?: { accessKeyId: string; secretAccessKey: string } }; };
}
```
`loadConfig` reads `STORAGE_DRIVER` (default `local`), and when `s3`: `S3_ENDPOINT`, `S3_REGION` (default us-east-1), `S3_BUCKET` (required), `S3_FORCE_PATH_STYLE` (default true), `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`. Keep the existing `storageRoot` as `storage.localRoot`.

- [ ] **Step 2: Factory** `storage/factory.ts`:
```ts
import type { AppConfig } from "../config.js";
import type { StorageDriver } from "./driver.js";
import { LocalDriver } from "./local-driver.js";
import { S3Driver } from "./s3-driver.js";
export function createStorage(cfg: AppConfig["storage"]): StorageDriver {
  if (cfg.backend === "s3") {
    if (!cfg.s3?.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    return new S3Driver(cfg.s3);
  }
  return new LocalDriver(cfg.localRoot);
}
```

- [ ] **Step 3: main.ts** — replace `new LocalDriver(...)` with `createStorage(config.storage)`.

- [ ] **Step 4: docker-compose** — add a MinIO service to `docker/docker-compose.yml` (dev) and a minimal `docker/docker-compose.test.yml` (CI conformance). Example service:
```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: minio, MINIO_ROOT_PASSWORD: minio12345 }
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]
```
Wire the app service env for S3 mode behind a documented override (keep `local` the default so `docker compose up` stays zero-config).

- [ ] **Step 5: Docs.** Document `STORAGE_DRIVER=local|s3` + the `S3_*` envs, and how to run the S3 conformance tests (`docker compose -f docker/docker-compose.test.yml up -d` + the `S3_TEST_*` envs).

- [ ] **Step 6: Verify + commit.** `pnpm test` + `pnpm typecheck` (root) green; a manual `STORAGE_DRIVER=s3` smoke against MinIO (create project → send-results → generate → fetch report) works. `git add -A && git commit -m "feat(storage): config-driven storage factory (local|s3) + MinIO compose + docs"`

---

## Self-Review (spec coverage)
- **#5 resolved:** `resolveLocalPath`/`move` removed; `materializeDir`/`readStream` are backend-agnostic; generation + serving use them (Tasks 2–3).
- **S3 driver + dev parity:** Task 4 (MinIO), Task 5 (compose/config).
- **Conformance parity:** one suite, both drivers (Task 2 + Task 4).
- **Bonus fixes folded:** report serving now gated on `status==='ready'` (no partial/failed reports) and enforces project ownership on the report path.

## Out of scope (later slices)
- **Postgres metadata + drizzle `migrate()` (#9)** — Slice 2b-ii.
- **External BullMQ/Redis queue** — Slice 2b-iii.
- **Content-addressed asset dedupe** — optimization; revisit after S3 lands (would hash report assets to a shared `cas/` prefix + per-run manifest).
- Multipart/large-object tuning, S3 lifecycle/retention policies, signed-URL serving (could replace proxy-streaming later).

## Risks
1. **AWS SDK checksum headers vs a different MinIO/SDK pin** — if Put/Copy fail with checksum errors in CI, set `requestChecksumCalculation: "WHEN_REQUIRED"` on the S3Client (spike escape hatch). Pin `@aws-sdk/client-s3` exactly.
2. **`node:fs/promises` `glob` availability on Node 20** — if unavailable, use a small recursive `readdir` walker for `putDir` (don't rely on experimental glob).
3. **Readiness-gate behavior change**: report assets now 404 until the run is `ready`. Confirm the UI only loads the iframe for ready runs (it already selects a ready run) — verify in Task 3 so this isn't a UX regression.
4. **`exists("")` / `dropBucket`** in tests must not nuke a shared bucket — the conformance harness uses a unique `test-${uuid}` bucket per run; never point `S3_TEST_*` at a real bucket.
