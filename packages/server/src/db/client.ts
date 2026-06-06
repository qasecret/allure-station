import { drizzle as drizzleLibsql, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

export type DbDriver = "sqlite" | "postgres";
/** Repo handle type — typed against the sqlite dialect; pg handle is cast to this at the factory. */
export type Db = LibSQLDatabase<typeof sqliteSchema>;

const sqliteMigrations = fileURLToPath(new URL("../../drizzle/sqlite", import.meta.url));
const pgMigrations = fileURLToPath(new URL("../../drizzle/pg", import.meta.url));

export interface DbHandle { db: Db; driver: DbDriver; migrate(): Promise<void>; }

export function createDb(driver: DbDriver, opts: { url: string }): DbHandle {
  if (driver === "postgres") {
    const pool = new Pool({ connectionString: opts.url });
    const pg = drizzlePg(pool, { schema: pgSchema });
    return {
      db: pg as unknown as Db, // cross-dialect union doesn't type-check; structurally identical at runtime (spike-verified)
      driver,
      migrate: () => migratePg(pg, { migrationsFolder: pgMigrations }),
    };
  }
  const client = createClient({ url: opts.url }); // "file:..." or ":memory:"
  const db = drizzleLibsql(client, { schema: sqliteSchema });
  return { db, driver, migrate: () => migrateLibsql(db, { migrationsFolder: sqliteMigrations }) };
}
