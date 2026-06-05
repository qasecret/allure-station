import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDriver } from "./local-driver.js";

let root: string;
let driver: LocalDriver;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "as-storage-"));
  driver = new LocalDriver(root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("LocalDriver", () => {
  it("stores a directory tree and reads a file back", async () => {
    const src = await mkdtemp(join(tmpdir(), "as-src-"));
    await mkdir(join(src, "data"), { recursive: true });
    await writeFile(join(src, "index.html"), "<h1>hi</h1>");
    await writeFile(join(src, "data", "app.js"), "console.log(1)");

    await driver.putDir("p1/runs/r1/report", src);

    const html = await driver.read("p1/runs/r1/report/index.html");
    expect(html.toString()).toBe("<h1>hi</h1>");
    await rm(src, { recursive: true, force: true });
  });

  it("exists() reflects presence", async () => {
    expect(await driver.exists("nope")).toBe(false);
    await driver.putBuffer("a/b.txt", Buffer.from("x"));
    expect(await driver.exists("a/b.txt")).toBe(true);
  });

  it("resolveLocalPath returns an on-disk path for serving", async () => {
    await driver.putBuffer("x/y.html", Buffer.from("ok"));
    const p = await driver.resolveLocalPath("x/y.html");
    expect(p).toContain(root);
  });
});
