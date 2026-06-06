export type StorageBackend = "local" | "s3";
export type DbDriver = "sqlite" | "postgres";
export type QueueDriver = "inprocess" | "bullmq";

export interface AppConfig {
  port: number;
  db: { driver: DbDriver; url: string };
  workDir: string;       // scratch dir for generation jobs
  concurrency: number;
  queueDriver: QueueDriver;
  redisUrl: string | undefined;
  version: string;
  storage: {
    backend: StorageBackend;
    localRoot: string;
    s3?: {
      endpoint?: string;
      region: string;
      bucket: string;
      forcePathStyle: boolean;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    };
  };
}

function parseEnum<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  def: T,
): T {
  if (value === undefined || value === "") return def;
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid ${name} "${value}": must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? "./data";
  const backend = parseEnum("STORAGE_DRIVER", env.STORAGE_DRIVER, ["local", "s3"] as const, "local");

  const storage: AppConfig["storage"] =
    backend === "s3"
      ? {
          backend: "s3",
          localRoot: env.STORAGE_ROOT ?? `${dataDir}/storage`,
          s3: {
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION ?? "us-east-1",
            bucket: env.S3_BUCKET ?? "",
            forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
            credentials:
              env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
                ? {
                    accessKeyId: env.S3_ACCESS_KEY_ID,
                    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
                  }
                : undefined,
          },
        }
      : {
          backend: "local",
          localRoot: env.STORAGE_ROOT ?? `${dataDir}/storage`,
        };

  const dbDriver = parseEnum("DB_DRIVER", env.DB_DRIVER, ["sqlite", "postgres"] as const, "sqlite");
  let dbUrl: string;
  if (dbDriver === "postgres") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required when DB_DRIVER=postgres");
    dbUrl = env.DATABASE_URL;
  } else {
    const dbFile = env.DB_FILE ?? `${dataDir}/allure-station.db`;
    dbUrl = `file:${dbFile}`;
  }

  const queueDriver = parseEnum("QUEUE_DRIVER", env.QUEUE_DRIVER, ["inprocess", "bullmq"] as const, "inprocess");

  return {
    port: Number(env.PORT ?? 5050),
    db: { driver: dbDriver, url: dbUrl },
    workDir: env.WORK_DIR ?? `${dataDir}/work`,
    concurrency: Number(env.GENERATE_CONCURRENCY ?? 2),
    queueDriver,
    redisUrl: env.REDIS_URL,
    version: env.APP_VERSION ?? "0.1.0",
    storage,
  };
}
