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
