import { RunAccumulator } from "./accumulator";
import {
  DT_S,
  EA_EV,
  ETA0,
  HEAT_CAPACITY,
  K0,
  KC,
  KELVIN,
  K_B,
  NOISE_FLOW,
  NOISE_PRESSURE,
  NOISE_TEMP,
  ONSET_RUN,
  P_BASE_NOM,
  P_MAX,
  PUMPDOWN_AMPLITUDE,
  PUMPDOWN_TAU_S,
  Q0,
  R0_NM_S,
  SIGMA_ETA,
  SIGMA_K,
  SIGMA_PB,
  START_OFFSET_C,
  T0,
  TICK_MS,
  TI_S,
  mfcDriftRate,
  pLoss,
  sigmaEps,
  sigmaV,
  tcDriftRate,
} from "./params";
import { expectedFrames, stepPlan } from "./recipe";
import { Rng, TAG_RUN, TAG_VERSION, hashInts } from "./rng";
import { DEPOSIT, PUMPDOWN, type RecipeVersion, type RunFeatures, type Scenario, type StepPlanEntry, type StepSummary } from "./types";

export interface SimInput {
  seed: number;
  toolId: number;
  runIdx: number;
  versionIdx: number;
  recipe: RecipeVersion;
  scenario: Scenario;
  /** Drift rate in feature sigmas per run (ignored for "none"). */
  delta: number;
}

export interface SimOptions {
  /** Also return the 10 Hz frames (the fast path skips them). */
  frames?: boolean;
  /** Test hook: no reading noise and no run-to-run effects. */
  noiseFree?: boolean;
  /** Test hook: override the heater coupling for this run. */
  eta?: number;
  /** Test hook: override the thermocouple bias, °C. */
  bTc?: number;
}

export interface FrameArrays {
  stepIdx: Int8Array;
  tMs: Float64Array;
  heaterTemp: Float64Array;
  heaterPower: Float64Array;
  pressure: Float64Array;
  gasFlow: Float64Array;
}

export interface SimResult {
  nFrames: number;
  plan: StepPlanEntry[];
  frames?: FrameArrays;
  features: RunFeatures;
  summaries: StepSummary[];
  /** Thickness the true state would give with no recipe error and no metrology noise, nm. */
  thModel: number;
  /** The engineer's prediction for this recipe, nm. */
  target: number;
  zEps: number;
  zV: number;
  truth: { eta: number; k: number; pBase: number; bTc: number; g: number; meanTrueTempDep: number };
}

const ARR_K = EA_EV / K_B;
const INV_T0 = 1 / (T0 + KELVIN);

function arrhenius(tC: number): number {
  return Math.exp(-ARR_K * (1 / (tC + KELVIN) - INV_T0));
}

/** Predicted thickness at the recipe's setpoints with no faults (the flow exponent is 1). */
export function targetThickness(recipe: RecipeVersion): number {
  return R0_NM_S * arrhenius(recipe.tempC) * (recipe.flowSccm / Q0) * recipe.depositS;
}

/** Measured thickness at a given r: the per-version rate error and metrology noise scale with r. */
export function measuredThickness(thModel: number, zV: number, zEps: number, r: number): number {
  return thModel * (1 + sigmaV(r) * zV) * (1 + sigmaEps(r) * zEps);
}

/** Thermocouple bias (°C) and MFC gain error (fraction) for a run. */
export function driftAt(scenario: Scenario, delta: number, runIdx: number): { bTc: number; g: number } {
  const n = runIdx - ONSET_RUN + 1;
  if (n <= 0 || scenario === "none") return { bTc: 0, g: 0 };
  if (scenario === "tc_drift") return { bTc: tcDriftRate(delta) * n, g: 0 };
  return { bTc: 0, g: mfcDriftRate(delta) * n };
}

/**
 * One run of a simulated deposition chamber at 10 Hz. The true state (stage temperature,
 * delivered flow) is kept separate from the readings a tool would report, so a fault inside a
 * closed loop shows up where it would on real equipment: a thermocouple bias leaves the
 * temperature reading on setpoint and moves heater power and the film instead.
 */
export function simulateRun(inp: SimInput, opts: SimOptions = {}): SimResult {
  const { seed, toolId, runIdx, versionIdx, recipe } = inp;
  const rng = new Rng(hashInts(TAG_RUN, seed, toolId, runIdx));
  const zEta = rng.normal();
  const zK = rng.normal();
  const zPb = rng.normal();
  const zEps = rng.normal();
  const zV = new Rng(hashInts(TAG_VERSION, seed, toolId, versionIdx)).normal();

  const noisy = !opts.noiseFree;
  const eta = opts.eta ?? (noisy ? ETA0 * (1 + SIGMA_ETA * zEta) : ETA0);
  const k = noisy ? K0 * (1 + SIGMA_K * zK) : K0;
  const pBase = noisy ? P_BASE_NOM + SIGMA_PB * zPb : P_BASE_NOM;
  const drift = driftAt(inp.scenario, inp.delta, runIdx);
  const bTc = opts.bTc ?? drift.bTc;
  const g = drift.g;

  const sp = recipe.tempC;
  const plan = stepPlan(recipe, runIdx);
  const acc = new RunAccumulator(plan);
  const total = expectedFrames(recipe);
  const fr: FrameArrays | undefined = opts.frames
    ? {
        stepIdx: new Int8Array(total),
        tMs: new Float64Array(total),
        heaterTemp: new Float64Array(total),
        heaterPower: new Float64Array(total),
        pressure: new Float64Array(total),
        gasFlow: new Float64Array(total),
      }
    : undefined;

  // Hot-loop constants as locals (imported bindings can compile to getters under some loaders).
  const pMax = P_MAX;
  const kc = KC;
  const nTemp = noisy ? NOISE_TEMP : 0;
  const nPressure = noisy ? NOISE_PRESSURE : 0;
  const nFlow = noisy ? NOISE_FLOW : 0;
  const pumpAmp = PUMPDOWN_AMPLITUDE;
  const pumpTau = PUMPDOWN_TAU_S;
  const tickMs = TICK_MS;
  const dt = DT_S;
  const r0 = R0_NM_S;
  const q0 = Q0;
  const depositIdx = DEPOSIT;
  const pumpdownIdx = PUMPDOWN;

  let T = sp + START_OFFSET_C;
  let integ = pLoss(sp) / ETA0; // feedforward preload
  const kiDt = (KC * DT_S) / TI_S;
  const dtOverC = DT_S / HEAT_CAPACITY;
  let th = 0;
  let tSum = 0;
  let tN = 0;
  let pLast = pBase;
  let f = 0;

  for (let s = 0; s < plan.length; s++) {
    const step = recipe.steps[s];
    const ticks = step.durationS * 10;
    const start = plan[s].startMs;
    const qSet = step.flowSccm;
    const qDel = qSet * (1 + g);
    for (let i = 0; i < ticks; i++) {
      const tMs = start + i * tickMs;
      const tStep = i * dt;
      // Readings
      const temp = T + bTc + (noisy ? nTemp * rng.normal() : 0);
      // PI on the reading, with conditional integration (no windup while saturated)
      const e = sp - temp;
      const uRaw = integ + kc * e;
      const u = uRaw < 0 ? 0 : uRaw > pMax ? pMax : uRaw;
      if (uRaw > 0 && uRaw < pMax) integ += kiDt * e;
      let p: number;
      if (s === pumpdownIdx) {
        p = pBase + pumpAmp * Math.exp(-tStep / pumpTau);
      } else if (qSet > 0) {
        p = pBase + k * qDel;
        pLast = p;
      } else {
        p = pBase + (pLast - pBase) * Math.exp(-tStep / pumpTau);
      }
      const pressure = p + (noisy ? nPressure * rng.normal() : 0);
      const flow = qSet + (noisy ? nFlow * rng.normal() : 0);

      acc.push(s, tMs, temp, u, pressure, flow);
      if (fr) {
        fr.stepIdx[f] = s;
        fr.tMs[f] = tMs;
        fr.heaterTemp[f] = temp;
        fr.heaterPower[f] = u;
        fr.pressure[f] = pressure;
        fr.gasFlow[f] = flow;
      }
      // True film growth
      if (s === depositIdx) {
        th += r0 * arrhenius(T) * (qDel / q0) * dt;
        tSum += T;
        tN++;
      }
      // Plant
      T += dtOverC * (eta * u - pLoss(T));
      f++;
    }
  }

  return {
    nFrames: f,
    plan,
    frames: fr,
    features: acc.features(recipe.flowSccm),
    summaries: acc.summaries(),
    thModel: th,
    target: targetThickness(recipe),
    zEps,
    zV,
    truth: { eta, k, pBase, bTc, g, meanTrueTempDep: tSum / tN },
  };
}
