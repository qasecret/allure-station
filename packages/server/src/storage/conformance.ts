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
