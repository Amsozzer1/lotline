/**
 * pnpm check-live: live-ingest checks against a running `pnpm demo` (MQTT subscribed).
 * Runs `pnpm sim` twice for the healthy demo tool and checks, for each run: the tool shows
 * "running" with a step while frames stream in; the run lands with count(frame) = expected_frames;
 * its stored features equal the eval fast path's; its page has traces and the recipe and tool
 * banner lines. Then the demo numbers are unchanged.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schedule } from "../src/domain/schedule";
import { simulateRun } from "../src/domain/sim";
import { createPool } from "../src/server/db";

const base = process.env.LOTLINE_URL ?? "http://localhost:8787";
const demo = JSON.parse(readFileSync(join(import.meta.dirname, "..", "results", "demo.json"), "utf8"));
const healthy = demo.tools.find((t: { scenario: string }) => t.scenario === "none");
const pool = createPool();
let ok = true;
const check = (cond: boolean, msg: string) => {
  ok &&= cond;
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
};
const tools = async () => (await (await fetch(`${base}/api/tools`)).json()) as { id: string; runCount: number; live: { state: string; stepIdx: number | null; runIdx: number | null } }[];

for (let k = 0; k < 2; k++) {
  const before = (await tools()).find((t) => t.id === healthy.displayId)!.runCount;
  const sim = spawn("pnpm", ["sim", "--tool", healthy.displayId, "--speed", "20"], { stdio: ["ignore", "pipe", "inherit"] });
  const steps = new Set<number>();
  const done = new Promise<number>((resolve) => sim.on("exit", (code) => resolve(code ?? 1)));
  let exited = false;
  done.then(() => (exited = true));
  while (!exited) {
    const t = (await tools()).find((x) => x.id === healthy.displayId)!;
    if (t.live.state === "running" && t.live.stepIdx !== null) steps.add(t.live.stepIdx);
    await new Promise((r) => setTimeout(r, 250));
  }
  check((await done) === 0, `pnpm sim run ${k + 1} exited cleanly`);
  check(steps.size >= 2, `tool showed "running step N" during the run (steps seen: ${[...steps].map((s) => s + 1).join(", ")})`);
  // wait for the run to be finalized
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) {
    await new Promise((r) => setTimeout(r, 250));
    after = (await tools()).find((x) => x.id === healthy.displayId)!.runCount;
  }
  check(after === before + 1, `run count went from ${before} to ${after}`);
  const runId = `${healthy.displayId}-r${String(after).padStart(4, "0")}`;
  const { rows } = await pool.query(
    "select r.expected_frames, count(f.run_id)::int as n from run r left join frame f on f.run_id = r.id where r.id = $1 group by r.expected_frames",
    [runId],
  );
  check(rows.length === 1 && rows[0].n === rows[0].expected_frames, `${runId}: ${rows[0]?.n} frames stored of ${rows[0]?.expected_frames} expected`);
  const s = schedule(healthy.seed, healthy.simToolId, after)[after - 1];
  const fast = simulateRun({ seed: healthy.seed, toolId: healthy.simToolId, runIdx: after, versionIdx: s.versionIdx, recipe: s.recipe, scenario: "none", delta: 0 }).features;
  const hf = (await pool.query("select p_dep, k, base_pressure, sat_dep_s from health_features where run_id = $1", [runId])).rows[0];
  check(!!hf && hf.p_dep === fast.pDep && hf.k === fast.k && hf.base_pressure === fast.basePressure && hf.sat_dep_s === fast.satDepS, `${runId}: features over MQTT equal the eval fast path exactly`);
  const page = await (await fetch(`${base}/api/runs/${runId}`)).json();
  check(page.frames.tMs.length === rows[0]?.expected_frames && page.banner.some((l: string) => l.startsWith("Recipe:")) && page.banner.some((l: string) => l.startsWith("Tool:")), `${runId}: page has traces and the recipe and tool lines`);
}
await pool.end();
const verify = spawn("pnpm", ["verify-demo"], { stdio: "inherit" });
check((await new Promise<number>((r) => verify.on("exit", (c) => r(c ?? 1)))) === 0, "verify-demo still passes");
if (!ok) process.exit(1);
console.log("check-live: all checks passed");
