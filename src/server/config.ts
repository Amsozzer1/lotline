import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "../domain/types";

export interface DemoTool {
  displayId: string;
  seed: number;
  simToolId: number;
  scenario: Scenario;
  flagRun: number | null;
  trendRun: number | null;
  firstOosRun: number | null;
}
export interface DemoConfig {
  delta: number;
  r: number;
  s: number;
  nRuns: number;
  tools: DemoTool[];
}
export interface ServerConfig {
  demo: DemoConfig;
  r: number;
  s: number;
  leLotline: number;
  leTrend: number;
}

const ROOT = join(import.meta.dirname, "..", "..");
export const DEMO_PATH = join(ROOT, "results", "demo.json");
export const CALIBRATION_PATH = join(ROOT, "src", "domain", "calibration.json");
export const WEB_DIST = join(ROOT, "dist", "web");

/** Reads results/demo.json and the calibrated thresholds for its r. Exits if pnpm eval has not run. */
export function loadServerConfig(): ServerConfig {
  for (const p of [DEMO_PATH, CALIBRATION_PATH]) {
    if (!existsSync(p)) {
      console.error(`missing ${p}: run pnpm eval`);
      process.exit(1);
    }
  }
  const demo = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoConfig;
  const cal = JSON.parse(readFileSync(CALIBRATION_PATH, "utf8")) as { byR: Record<string, { lotline: number; trend: number }> };
  const entry = cal.byR[String(demo.r)];
  if (!entry) {
    console.error(`calibration.json has no entry for r = ${demo.r}: run pnpm eval`);
    process.exit(1);
  }
  return { demo, r: demo.r, s: demo.s, leLotline: entry.lotline, leTrend: entry.trend };
}
