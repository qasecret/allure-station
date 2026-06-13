import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig — driver enum validation", () => {
  it("throws on unrecognized QUEUE_DRIVER", () => {
    expect(() => loadConfig({ QUEUE_DRIVER: "bullmqs" })).toThrow(/Invalid QUEUE_DRIVER "bullmqs"/);
  });

  it("throws on unrecognized DB_DRIVER", () => {
    expect(() => loadConfig({ DB_DRIVER: "mysql" })).toThrow(/Invalid DB_DRIVER "mysql"/);
  });

  it("throws on unrecognized STORAGE_DRIVER", () => {
    expect(() => loadConfig({ STORAGE_DRIVER: "gcs" })).toThrow(/Invalid STORAGE_DRIVER "gcs"/);
  });

  it("accepts valid QUEUE_DRIVER values", () => {
    expect(loadConfig({ QUEUE_DRIVER: "inprocess" }).queueDriver).toBe("inprocess");
    expect(loadConfig({ QUEUE_DRIVER: "bullmq", REDIS_URL: "redis://localhost:6379" }).queueDriver).toBe("bullmq");
  });

  it("throws when QUEUE_DRIVER=bullmq but REDIS_URL is missing", () => {
    expect(() => loadConfig({ QUEUE_DRIVER: "bullmq" })).toThrow(/REDIS_URL is required/);
  });

  it("defaults QUEUE_DRIVER to inprocess when not set", () => {
    expect(loadConfig({}).queueDriver).toBe("inprocess");
  });

  it("accepts valid DB_DRIVER values", () => {
    expect(loadConfig({ DB_DRIVER: "sqlite" }).db.driver).toBe("sqlite");
    expect(loadConfig({ DB_DRIVER: "postgres", DATABASE_URL: "postgres://localhost/test" }).db.driver).toBe("postgres");
  });

  it("defaults DB_DRIVER to sqlite when not set", () => {
    expect(loadConfig({}).db.driver).toBe("sqlite");
  });

  it("accepts valid STORAGE_DRIVER values", () => {
    expect(loadConfig({ STORAGE_DRIVER: "local" }).storage.backend).toBe("local");
    expect(loadConfig({ STORAGE_DRIVER: "s3" }).storage.backend).toBe("s3");
  });

  it("defaults STORAGE_DRIVER to local when not set", () => {
    expect(loadConfig({}).storage.backend).toBe("local");
  });
});

describe("loadConfig", () => {
  it("defaults to local backend with no env vars", () => {
    const cfg = loadConfig({});
    expect(cfg.storage.backend).toBe("local");
    expect(cfg.storage.s3).toBeUndefined();
  });

  it("uses STORAGE_ROOT for local localRoot", () => {
    const cfg = loadConfig({ STORAGE_ROOT: "/custom/path" });
    expect(cfg.storage.localRoot).toBe("/custom/path");
  });

  it("uses DATA_DIR-derived path when STORAGE_ROOT is not set", () => {
    const cfg = loadConfig({ DATA_DIR: "/mydata" });
    expect(cfg.storage.localRoot).toBe("/mydata/storage");
  });

  it("sets backend=s3 and populates s3 config from env", () => {
    const cfg = loadConfig({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" });
    expect(cfg.storage.backend).toBe("s3");
    expect(cfg.storage.s3).toBeDefined();
    expect(cfg.storage.s3!.bucket).toBe("b");
    expect(cfg.storage.s3!.region).toBe("us-east-1");
    expect(cfg.storage.s3!.forcePathStyle).toBe(true);
    expect(cfg.storage.s3!.credentials).toBeUndefined();
  });

  it("sets S3 region, endpoint, forcePathStyle from env", () => {
    const cfg = loadConfig({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "mybucket",
      S3_REGION: "eu-west-1",
      S3_ENDPOINT: "http://minio:9000",
      S3_FORCE_PATH_STYLE: "false",
    });
    expect(cfg.storage.s3!.region).toBe("eu-west-1");
    expect(cfg.storage.s3!.endpoint).toBe("http://minio:9000");
    expect(cfg.storage.s3!.forcePathStyle).toBe(false);
  });

  it("defaults concurrency to 2 when GENERATE_CONCURRENCY is unset or empty", () => {
    expect(loadConfig({}).concurrency).toBe(2);
    expect(loadConfig({ GENERATE_CONCURRENCY: "" }).concurrency).toBe(2);
  });

  it("parses a valid GENERATE_CONCURRENCY", () => {
    expect(loadConfig({ GENERATE_CONCURRENCY: "4" }).concurrency).toBe(4);
  });

  it("throws on non-numeric or non-positive GENERATE_CONCURRENCY (would silently hang the queue)", () => {
    expect(() => loadConfig({ GENERATE_CONCURRENCY: "two" })).toThrow(/must be a positive integer/);
    expect(() => loadConfig({ GENERATE_CONCURRENCY: "0" })).toThrow(/must be a positive integer/);
    expect(() => loadConfig({ GENERATE_CONCURRENCY: "1.5" })).toThrow(/must be a positive integer/);
  });

  it("defaults generateStaleMs to 30 minutes", () => {
    expect(loadConfig({}).generateStaleMs).toBe(30 * 60 * 1000);
  });

  it("BRAND_NAME='' falls back to default name (|| not ??)", () => {
    expect(loadConfig({ BRAND_NAME: "" }).branding.name).toBe("Allure Station");
  });

  it("BRAND_LOGO_URL='' falls back to null (|| not ??)", () => {
    expect(loadConfig({ BRAND_LOGO_URL: "" }).branding.logoUrl).toBeNull();
  });

  it("populates credentials only when both key id and secret are present", () => {
    const cfgWithBoth = loadConfig({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "mykey",
      S3_SECRET_ACCESS_KEY: "mysecret",
    });
    expect(cfgWithBoth.storage.s3!.credentials).toEqual({
      accessKeyId: "mykey",
      secretAccessKey: "mysecret",
    });

    const cfgWithOnlyKey = loadConfig({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "mykey",
    });
    expect(cfgWithOnlyKey.storage.s3!.credentials).toBeUndefined();
  });
});

describe("retention config", () => {
  it("defaults to 30 days and 50 max runs", () => {
    const cfg = loadConfig({});
    expect(cfg.retentionDays).toBe(30);
    expect(cfg.retentionMaxRuns).toBe(50);
  });

  it("parses RETENTION_DAYS and RETENTION_MAX_RUNS", () => {
    const cfg = loadConfig({ RETENTION_DAYS: "60", RETENTION_MAX_RUNS: "100" });
    expect(cfg.retentionDays).toBe(60);
    expect(cfg.retentionMaxRuns).toBe(100);
  });

  it("allows 0 to disable retention", () => {
    const cfg = loadConfig({ RETENTION_DAYS: "0", RETENTION_MAX_RUNS: "0" });
    expect(cfg.retentionDays).toBe(0);
    expect(cfg.retentionMaxRuns).toBe(0);
  });

  it("rejects negative values", () => {
    expect(() => loadConfig({ RETENTION_DAYS: "-1" })).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() => loadConfig({ RETENTION_MAX_RUNS: "3.5" })).toThrow();
  });
});
