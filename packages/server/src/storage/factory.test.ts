import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "./factory.js";
import { LocalDriver } from "./local-driver.js";
import { S3Driver } from "./s3-driver.js";

describe("createStorage", () => {
  it("returns a working LocalDriver for local backend (putBuffer + read round-trips)", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-local-"));
    try {
      const driver = createStorage({ backend: "local", localRoot: root });
      expect(driver).toBeInstanceOf(LocalDriver);
      await driver.putBuffer("hello/world.txt", Buffer.from("factory-test"));
      const result = await driver.read("hello/world.txt");
      expect(result.toString()).toBe("factory-test");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error when backend=s3 and bucket is empty string", () => {
    expect(() =>
      createStorage({
        backend: "s3",
        localRoot: "/tmp",
        s3: { region: "us-east-1", bucket: "", forcePathStyle: true },
      }),
    ).toThrow("S3_BUCKET is required when STORAGE_DRIVER=s3");
  });

  it("throws a clear error when backend=s3 and s3 config is missing entirely", () => {
    expect(() =>
      createStorage({
        backend: "s3",
        localRoot: "/tmp",
      }),
    ).toThrow("S3_BUCKET is required when STORAGE_DRIVER=s3");
  });

  it("returns an S3Driver instance when backend=s3 and bucket is provided (no network call)", () => {
    const driver = createStorage({
      backend: "s3",
      localRoot: "/tmp",
      s3: { region: "us-east-1", bucket: "b", forcePathStyle: true },
    });
    expect(driver).toBeInstanceOf(S3Driver);
  });
});
