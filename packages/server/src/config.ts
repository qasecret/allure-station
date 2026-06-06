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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? "./data";
  const backend = (env.STORAGE_DRIVER ?? "local") as StorageBackend;

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

  const dbDriver = (env.DB_DRIVER ?? "sqlite") as DbDriver;
  let dbUrl: string;
  if (dbDriver === "postgres") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required when DB_DRIVER=postgres");
    dbUrl = env.DATABASE_URL;
  } else {
    const dbFile = env.DB_FILE ?? `${dataDir}/allure-station.db`;
    dbUrl = `file:${dbFile}`;
  }

  return {
    port: Number(env.PORT ?? 5050),
    db: { driver: dbDriver, url: dbUrl },
    workDir: env.WORK_DIR ?? `${dataDir}/work`,
    concurrency: Number(env.GENERATE_CONCURRENCY ?? 2),
    queueDriver: (env.QUEUE_DRIVER ?? "inprocess") as QueueDriver,
    redisUrl: env.REDIS_URL,
    version: env.APP_VERSION ?? "0.1.0",
    storage,
  };
}
