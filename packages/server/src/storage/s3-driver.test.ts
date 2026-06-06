import { describe } from "vitest";
import { randomUUID } from "node:crypto";
import { S3Driver } from "./s3-driver.js";
import { runStorageConformance } from "./conformance.js";

const ep = process.env.S3_TEST_ENDPOINT;
const d = ep ? describe : describe.skip;

d("s3 (requires S3_TEST_ENDPOINT)", () => {
  runStorageConformance("s3", async () => {
    const driver = new S3Driver({
      endpoint: ep,
      region: "us-east-1",
      bucket: `test-${randomUUID()}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_TEST_KEY ?? "minio",
        secretAccessKey: process.env.S3_TEST_SECRET ?? "minio12345",
      },
    });
    await driver.ensureBucket();
    return { driver, cleanup: () => driver.dropBucket() };
  });
});
