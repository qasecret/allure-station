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
