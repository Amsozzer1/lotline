import { DEPOSIT_TIMES_S, FLOW_MAX, FLOW_MIN, SETPOINTS } from "./params";
import { makeRecipe } from "./recipe";
import { Rng, TAG_PATTERN, TAG_SCHEDULE, hashInts } from "./rng";
import type { Experiment, Pattern, RecipeVersion } from "./types";

export interface ScheduledRun {
  runIdx: number;
  versionIdx: number;
  recipe: RecipeVersion;
  experimentIdx: number;
  experiment: Omit<Experiment, "id">;
  pattern: Pattern;
}

const GOALS = [
  "Thickness vs. stage temperature",
  "Flow sweep at fixed temperature",
  "Deposition time series",
  "Repeatability at a fixed recipe",
  "Short-loop recipe tuning",
];
const PATTERN_FILES = [
  "test-structures-a.gds",
  "test-structures-b.gds",
  "resistor-ladder.gds",
  "van-der-pauw.gds",
  "comb-capacitor.gds",
];
const VERSIONS_PER_EXPERIMENT = 3;

function pattern(idx: number): Pattern {
  const h = (n: number) => hashInts(TAG_PATTERN, idx, n).toString(16).padStart(8, "0");
  return { file: PATTERN_FILES[idx % PATTERN_FILES.length], sha: h(1) + h(2) + h(3) };
}

/**
 * High-mix schedule for one tool: one recipe lineage, a new version every 3-8 runs.
 * Prefix-stable: schedule(s, t, n) equals the first n entries of schedule(s, t, m) for m > n.
 * The first four versions walk a seeded permutation of the four setpoints, so the 50-run
 * Phase I always covers every setpoint.
 */
export function schedule(seed: number, toolId: number, nRuns: number): ScheduledRun[] {
  const rng = new Rng(hashInts(TAG_SCHEDULE, seed, toolId));
  const perm = [0, 1, 2, 3];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const out: ScheduledRun[] = [];
  let tempC = 0;
  let flow = 0;
  let depositS = 0;
  for (let v = 1; out.length < nRuns; v++) {
    if (v === 1) {
      tempC = SETPOINTS[perm[0]];
      flow = rng.int(FLOW_MIN, FLOW_MAX);
      depositS = DEPOSIT_TIMES_S[rng.int(0, DEPOSIT_TIMES_S.length - 1)];
    } else {
      let cT: boolean;
      let cQ: boolean;
      let cD: boolean;
      if (v <= 4) {
        cT = true;
        cQ = rng.uniform() < 0.5;
        cD = rng.uniform() < 0.5;
      } else {
        do {
          cT = rng.uniform() < 0.5;
          cQ = rng.uniform() < 0.5;
          cD = rng.uniform() < 0.5;
        } while (!cT && !cQ && !cD);
      }
      if (cT) {
        if (v <= 4) {
          tempC = SETPOINTS[perm[v - 1]];
        } else {
          const others = SETPOINTS.filter((s) => s !== tempC);
          tempC = others[rng.int(0, others.length - 1)];
        }
      }
      if (cQ) {
        let q: number;
        do q = rng.int(FLOW_MIN, FLOW_MAX);
        while (q === flow);
        flow = q;
      }
      if (cD) {
        let d: number;
        do d = DEPOSIT_TIMES_S[rng.int(0, DEPOSIT_TIMES_S.length - 1)];
        while (d === depositS);
        depositS = d;
      }
    }
    const len = rng.int(3, 8);
    const recipe = makeRecipe(v, tempC, flow, depositS);
    const experimentIdx = Math.ceil(v / VERSIONS_PER_EXPERIMENT);
    const experiment = { name: `Experiment ${experimentIdx}`, goal: GOALS[(experimentIdx - 1) % GOALS.length] };
    const pat = pattern(hashInts(seed, toolId, experimentIdx) % PATTERN_FILES.length);
    for (let i = 0; i < len && out.length < nRuns; i++) {
      out.push({ runIdx: out.length + 1, versionIdx: v, recipe, experimentIdx, experiment, pattern: pat });
    }
  }
  return out;
}
