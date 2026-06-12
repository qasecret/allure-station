export type StorageBackend = "local" | "s3";
export type DbDriver = "sqlite" | "postgres";
export type QueueDriver = "inprocess" | "bullmq";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;            // space-delimited, default "openid email profile"
  label: string;             // button text, e.g. "SSO" / "Google"
  allowedDomains: string[];  // empty = any verified email allowed
  allowUnverifiedEmail: boolean;
}

export interface AppConfig {
  port: number;
  db: { driver: DbDriver; url: string };
  workDir: string;       // scratch dir for generation jobs
  concurrency: number;
  generateStaleMs: number; // a run stuck 'generating' longer than this is reconciled to 'failed'
  queueDriver: QueueDriver;
  redisUrl: string | undefined;
  version: string;
  publicUrl: string | undefined; // absolute base URL for links in notifications (no trailing slash)
  sessionTtlMs: number;
  cookieSecure: boolean;
  adminEmail: string | undefined;    // seeded/upserted as a global admin on startup (with adminPassword)
  adminPassword: string | undefined;
  trustProxy: boolean;               // trust X-Forwarded-For/Proto headers (set true behind a load balancer/proxy)
  branding: {
    name: string;       // displayed in the UI title and login page (BRAND_NAME)
    tagline: string;    // displayed on the login page (BRAND_TAGLINE)
    logoUrl: string | null; // URL of a custom logo image (BRAND_LOGO_URL)
  };
  oidc: OidcConfig | undefined;      // external SSO; present only when OIDC_ISSUER is set
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

/** Parse a required positive integer env var. Rejects empty string, non-numeric, and < 1
 *  (Number("") === 0 and Number("x") === NaN would otherwise silently misconfigure the queue). */
function parsePositiveInt(name: string, value: string | undefined, def: number): number {
  if (value === undefined || value === "") return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${name} "${value}": must be a positive integer`);
  }
  return n;
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
  if (queueDriver === "bullmq" && !env.REDIS_URL) {
    throw new Error("REDIS_URL is required when QUEUE_DRIVER=bullmq");
  }

  const publicUrl = env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, "") : undefined;
  let oidc: OidcConfig | undefined;
  if (env.OIDC_ISSUER) {
    const redirectUri = env.OIDC_REDIRECT_URI || (publicUrl ? `${publicUrl}/api/auth/oidc/callback` : undefined);
    if (!env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) throw new Error("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required when OIDC_ISSUER is set");
    if (!redirectUri) throw new Error("OIDC_REDIRECT_URI (or PUBLIC_URL) is required when OIDC_ISSUER is set");
    const scopes = env.OIDC_SCOPES || "openid email profile";
    if (!scopes.split(/\s+/).includes("openid")) throw new Error("OIDC_SCOPES must include 'openid'");
    oidc = {
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      redirectUri,
      scopes,
      label: env.OIDC_LABEL || "SSO",
      allowedDomains: (env.OIDC_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
      allowUnverifiedEmail: env.OIDC_ALLOW_UNVERIFIED_EMAIL === "true",
    };
  }

  return {
    port: parsePositiveInt("PORT", env.PORT, 5050),
    db: { driver: dbDriver, url: dbUrl },
    workDir: env.WORK_DIR ?? `${dataDir}/work`,
    concurrency: parsePositiveInt("GENERATE_CONCURRENCY", env.GENERATE_CONCURRENCY, 2),
    generateStaleMs: parsePositiveInt("GENERATE_STALE_MS", env.GENERATE_STALE_MS, 30 * 60 * 1000),
    queueDriver,
    redisUrl: env.REDIS_URL,
    version: env.APP_VERSION ?? "0.1.0",
    publicUrl,
    sessionTtlMs: parsePositiveInt("SESSION_TTL_MS", env.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000),
    // Default Secure cookies on when serving over https (PUBLIC_URL); COOKIE_SECURE overrides explicitly.
    cookieSecure:
      env.COOKIE_SECURE !== undefined && env.COOKIE_SECURE !== ""
        ? env.COOKIE_SECURE === "true"
        : (env.PUBLIC_URL ?? "").startsWith("https://"),
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
    branding: {
      name: env.BRAND_NAME || "Allure Station",
      tagline: env.BRAND_TAGLINE ?? "Your test reports, beautifully hosted.",
      logoUrl: env.BRAND_LOGO_URL || null,
    },
    oidc,
    storage,
  };
}
