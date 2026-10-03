import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = "postgres://lotline:lotline@localhost:55432/lotline_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Database tests share one Postgres, so test files run one at a time.
    fileParallelism: false,
    // Locally, tests use their own database so they never wipe the demo. CI sets DATABASE_URL.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? TEST_DATABASE_URL },
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
});
