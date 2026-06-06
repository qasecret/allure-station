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

  it("move() renames a directory from src to dest and src no longer exists", async () => {
    const src = await mkdtemp(join(tmpdir(), "as-move-src-"));
    await writeFile(join(src, "file.txt"), "hello");

    await driver.putDir("a/src-dir", src);
    await driver.move("a/src-dir", "a/dest-dir");

    // dest has the file
    const content = await driver.read("a/dest-dir/file.txt");
    expect(content.toString()).toBe("hello");

    // src no longer exists
    expect(await driver.exists("a/src-dir")).toBe(false);

    await rm(src, { recursive: true, force: true });
  });

  it("move() replaces an existing destination", async () => {
    const srcA = await mkdtemp(join(tmpdir(), "as-move-a-"));
    const srcB = await mkdtemp(join(tmpdir(), "as-move-b-"));
    await writeFile(join(srcA, "a.txt"), "from-a");
    await writeFile(join(srcB, "b.txt"), "from-b");

    // Put something at B first
    await driver.putDir("move-test/b", srcB);
    expect(await driver.exists("move-test/b/b.txt")).toBe(true);

    // Now put A at src and move over B
    await driver.putDir("move-test/a", srcA);
    await driver.move("move-test/a", "move-test/b");

    // B now reflects A's contents
    const content = await driver.read("move-test/b/a.txt");
    expect(content.toString()).toBe("from-a");
    // Old B content is gone
    expect(await driver.exists("move-test/b/b.txt")).toBe(false);

    await rm(srcA, { recursive: true, force: true });
    await rm(srcB, { recursive: true, force: true });
  });
});
