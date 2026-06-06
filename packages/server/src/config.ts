export interface AppConfig {
  port: number;
  dbFile: string;
  storageRoot: string;
  workDir: string;       // scratch dir for generation jobs
  concurrency: number;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? "./data";
  return {
    port: Number(env.PORT ?? 5050),
    dbFile: env.DB_FILE ?? `${dataDir}/allure-station.db`,
    storageRoot: env.STORAGE_ROOT ?? `${dataDir}/storage`,
    workDir: env.WORK_DIR ?? `${dataDir}/work`,
    concurrency: Number(env.GENERATE_CONCURRENCY ?? 2),
    version: env.APP_VERSION ?? "0.1.0",
  };
}
