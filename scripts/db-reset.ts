import { createPool, databaseUrl, resetDb } from "../src/server/db";

const pool = createPool();
try {
  const applied = await resetDb(pool);
  const url = new URL(databaseUrl());
  console.log(`reset ${url.host}${url.pathname}: applied ${applied.join(", ")}`);
} finally {
  await pool.end();
}
