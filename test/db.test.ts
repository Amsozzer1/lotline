import { afterAll, describe, expect, it } from "vitest";
import { createPool, resetDb } from "../src/server/db";

const pool = createPool();
afterAll(() => pool.end());

describe("schema", () => {
  it("applies every migration on a clean database", async () => {
    await resetDb(pool);
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "experiment",
      "frame",
      "health_features",
      "measurement",
      "recipe_version",
      "run",
      "step_summary",
      "tool",
      "tool_config",
      "wafer",
    ]);
  });
});
