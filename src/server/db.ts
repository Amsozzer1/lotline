import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// int8 columns (virtual-clock milliseconds) fit in a double, so return them as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

export const DEFAULT_DATABASE_URL = "postgres://lotline:lotline@localhost:55432/lotline";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createPool(): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl(), max: 8 });
}

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "db", "migrations");

/** Drops everything and applies every migration in order. */
export async function resetDb(pool: pg.Pool): Promise<string[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("drop schema if exists public cascade; create schema public;");
    for (const f of files) {
      await client.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    }
  } finally {
    client.release();
  }
  return files;
}
