import { KELVIN, PHASE_I_RUNS, T_WALL } from "./params";

/** Per-run values a detector needs, indexed by run (index 0 = run 1). */
export interface RunSeries {
  n: number;
  tempC: ArrayLike<number>;
  flowSccm: ArrayLike<number>;
  versionIdx: ArrayLike<number>;
  pDep: ArrayLike<number>;
  k: ArrayLike<number>;
  satDepS: ArrayLike<number>;
  tempMeanDep: ArrayLike<number>;
  flowMeanDep: ArrayLike<number>;
  pressureMeanDep: ArrayLike<number>;
  thickness: ArrayLike<number>;
  target: ArrayLike<number>;
}

/** What Phase I (runs 1-50) learns about a tool. Frozen afterwards; recipe edits never touch it. */
export interface PhaseIModel {
  /** Expected heater power P(T) = a (T - T_wall) + c (T^4 - T_wall^4), fitted by least squares. */
  a: number;
  c: number;
  kHat: number;
  sigmaHeater: number;
  sigmaFlow: number;
  sigmaThickness: number;
}

// Scaled regressors keep the 2x2 normal equations well conditioned.
const X_SCALE = 100;
const Y_SCALE = 1e11;
const TW4 = (T_WALL + KELVIN) ** 2 * (T_WALL + KELVIN) ** 2;
function xOf(tC: number): number {
  return (tC - T_WALL) / X_SCALE;
}
function yOf(tC: number): number {
  const t2 = (tC + KELVIN) * (tC + KELVIN);
  return (t2 * t2 - TW4) / Y_SCALE;
}

export function expectedPower(m: Pick<PhaseIModel, "a" | "c">, tC: number): number {
  return m.a * xOf(tC) + m.c * yOf(tC);
}

function rms(xs: ArrayLike<number>, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i] * xs[i];
  return Math.sqrt(s / n);
}

export function fitPhaseI(s: RunSeries, phaseRuns = PHASE_I_RUNS): PhaseIModel {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxp = 0;
  let syp = 0;
  let kSum = 0;
  for (let i = 0; i < phaseRuns; i++) {
    const x = xOf(s.tempC[i]);
    const y = yOf(s.tempC[i]);
    const p = s.pDep[i];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxp += x * p;
    syp += y * p;
    kSum += s.k[i];
  }
  const det = sxx * syy - sxy * sxy;
  const a = (sxp * syy - syp * sxy) / det;
  const c = (syp * sxx - sxp * sxy) / det;
  const model = { a, c, kHat: kSum / phaseRuns, sigmaHeater: 0, sigmaFlow: 0, sigmaThickness: 0 };
  const h = heaterIndex(s, model);
  const f = flowIndex(s, model);
  const t = thicknessIndex(s);
  model.sigmaHeater = rms(h, phaseRuns);
  model.sigmaFlow = rms(f, phaseRuns);
  model.sigmaThickness = rms(t, phaseRuns);
  return model;
}

/** Heater power vs expected for each run's setpoint, minus 1. */
export function heaterIndex(s: RunSeries, m: Pick<PhaseIModel, "a" | "c">): Float64Array {
  const out = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) out[i] = s.pDep[i] / expectedPower(m, s.tempC[i]) - 1;
  return out;
}

/** Pressure rise per sccm vs the Phase I mean, minus 1. */
export function flowIndex(s: RunSeries, m: Pick<PhaseIModel, "kHat">): Float64Array {
  const out = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) out[i] = s.k[i] / m.kHat - 1;
  return out;
}

/** Measured thickness vs the recipe's predicted thickness, minus 1. */
export function thicknessIndex(s: Pick<RunSeries, "n" | "thickness" | "target">): Float64Array {
  const out = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) out[i] = s.thickness[i] / s.target[i] - 1;
  return out;
}
