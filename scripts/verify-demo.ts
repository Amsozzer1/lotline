/**
 * pnpm verify-demo: checks that the running app reproduces results/demo.json. For each demo tool it
 * reads /api/tools/:id/health and compares the first lotline flag, first thickness-trend alarm and
 * first out-of-spec wafer in runs s..nRuns (nulls included). Exits 1 on any mismatch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.LOTLINE_URL ?? "http://localhost:8787";
const demo = JSON.parse(readFileSync(join(import.meta.dirname, "..", "results", "demo.json"), "utf8"));
let ok = true;
for (const t of demo.tools) {
  const res = await fetch(`${base}/api/tools/${t.displayId}/health`);
  if (!res.ok) {
    console.error(`${t.displayId}: HTTP ${res.status}`);
    ok = false;
    continue;
  }
  const h = await res.json();
  const inWindow = (run: number) => run >= demo.s && run <= demo.nRuns;
  const got = {
    flagRun: h.signals.lotline.map((a: { run: number }) => a.run).find(inWindow) ?? null,
    trendRun: h.signals.trend.map((a: { run: number }) => a.run).find(inWindow) ?? null,
    firstOosRun: (h.oosRuns as number[]).find(inWindow) ?? null,
  };
  for (const k of ["flagRun", "trendRun", "firstOosRun"] as const) {
    const match = got[k] === t[k];
    ok &&= match;
    console.log(`${match ? "ok  " : "FAIL"} ${t.displayId} ${k}: app ${got[k]}, demo.json ${t[k]}`);
  }
}
if (!ok) {
  console.error("verify-demo: the app does not reproduce results/demo.json");
  process.exit(1);
}
console.log("verify-demo: the app reproduces results/demo.json");
