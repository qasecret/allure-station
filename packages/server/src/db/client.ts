import { drizzle as drizzleLibsql, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

export type DbDriver = "sqlite" | "postgres";
/** Repo handle type — typed against the sqlite dialect; pg handle is cast to this at the factory. */
export type Db = LibSQLDatabase<typeof sqliteSchema>;

const sqliteMigrations = fileURLToPath(new URL("../../drizzle/sqlite", import.meta.url));
const pgMigrations = fileURLToPath(new URL("../../drizzle/pg", import.meta.url));

// Arbitrary fixed key for the migration advisory lock (any process migrating uses the same key).
const PG_MIGRATION_LOCK = 4011;

export interface DbHandle { db: Db; driver: DbDriver; migrate(): Promise<void>; }

export function createDb(driver: DbDriver, opts: { url: string }): DbHandle {
  if (driver === "postgres") {
    const pool = new Pool({ connectionString: opts.url });
    const pg = drizzlePg(pool, { schema: pgSchema });
    return {
      db: pg as unknown as Db, // cross-dialect union doesn't type-check; structurally identical at runtime (spike-verified)
      driver,
      // drizzle's migrate() isn't concurrency-safe; in bullmq mode the API + N workers boot together
      // against shared Postgres. A server-wide advisory lock serializes them: the first migrates, the
      // rest wait then find every migration already applied. (Also serializes parallel test workers.)
      migrate: async () => {
        const lock = await pool.connect();
        try {
          await lock.query("SELECT pg_advisory_lock($1)", [PG_MIGRATION_LOCK]);
          await migratePg(pg, { migrationsFolder: pgMigrations });
        } finally {
          try { await lock.query("SELECT pg_advisory_unlock($1)", [PG_MIGRATION_LOCK]); } catch { /* releasing is best-effort */ }
          lock.release();
        }
      },
    };
  }
  // Ensure the DB file's directory exists — libsql can't create a file in a missing dir, so a
  // fresh DATA_DIR (first run / empty volume / e2e) would otherwise fail with SQLITE_CANTOPEN.
  if (opts.url.startsWith("file:")) {
    const path = opts.url.slice("file:".length);
    if (path && !path.startsWith(":")) mkdirSync(dirname(path), { recursive: true }); // skip in-memory forms (":memory:")
  }
  const client = createClient({ url: opts.url }); // "file:..." or ":memory:"
  const db = drizzleLibsql(client, { schema: sqliteSchema });
  return { db, driver, migrate: () => migrateLibsql(db, { migrationsFolder: sqliteMigrations }) };
}
