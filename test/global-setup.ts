import pg from "pg";

/** Local runs test against lotline_test, so tests never wipe the demo database. CI sets DATABASE_URL. */
export default async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://lotline:lotline@localhost:55432/lotline_test");
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
  if (!rowCount) await client.query(`create database "${name}"`);
  await client.end();
}
