import { FA_TARGET, L1, LAMBDA, PHASE_I_RUNS } from "./params";

export const EWMA_FACTOR = Math.sqrt(LAMBDA / (2 - LAMBDA));
export const L1_LIMIT = L1;
export const MONITOR_FROM_RUN = PHASE_I_RUNS + 1;

export interface FamilyAlarm {
  run: number;
  /** Indices (into the family) of the charts that fired on this run. */
  charts: number[];
  rule1: boolean;
  ewma: boolean;
}

export interface FamilyTrace {
  alarms: FamilyAlarm[];
  /** EWMA per chart per run, after the update and before any reset (NaN before monitoring starts). */
  z: Float64Array[];
}

/**
 * A family of individuals charts (center 0) watched together: rule 1 at L1 sigma, or the EWMA
 * beyond L_e sigma (asymptotic limits). Monitoring starts at run 51 with every EWMA at 0.
 * Any alarm resets every EWMA in the family, so each alarm is one episode.
 */
export function runFamily(
  charts: ArrayLike<number>[],
  sigmas: number[],
  le: number,
  n: number,
  from = MONITOR_FROM_RUN,
): FamilyTrace {
  const m = charts.length;
  const z = new Float64Array(m);
  const zTrace = charts.map(() => new Float64Array(n).fill(NaN));
  const alarms: FamilyAlarm[] = [];
  for (let i = from - 1; i < n; i++) {
    const fired: number[] = [];
    let r1 = false;
    let ew = false;
    for (let c = 0; c < m; c++) {
      const x = charts[c][i];
      const sd = sigmas[c];
      z[c] = LAMBDA * x + (1 - LAMBDA) * z[c];
      zTrace[c][i] = z[c];
      const a = Math.abs(x) > L1 * sd;
      const b = Math.abs(z[c]) > le * sd * EWMA_FACTOR;
      if (a || b) {
        fired.push(c);
        r1 ||= a;
        ew ||= b;
      }
    }
    if (fired.length > 0) {
      alarms.push({ run: i + 1, charts: fired, rule1: r1, ewma: ew });
      z.fill(0);
    }
  }
  return { alarms, z: zTrace };
}

/** Alarm count over runs from..to (inclusive), same rules as runFamily, without allocations. */
export function countFamilyAlarms(
  charts: ArrayLike<number>[],
  sigmas: number[],
  le: number,
  to: number,
  from = MONITOR_FROM_RUN,
): number {
  const m = charts.length;
  const z = new Float64Array(m);
  const r1Lim = new Float64Array(m);
  const ewLim = new Float64Array(m);
  for (let c = 0; c < m; c++) {
    r1Lim[c] = L1 * sigmas[c];
    ewLim[c] = le * sigmas[c] * EWMA_FACTOR;
  }
  let count = 0;
  for (let i = from - 1; i < to; i++) {
    let any = false;
    for (let c = 0; c < m; c++) {
      const x = charts[c][i];
      const zc = LAMBDA * x + (1 - LAMBDA) * z[c];
      z[c] = zc;
      if (Math.abs(x) > r1Lim[c] || Math.abs(zc) > ewLim[c]) any = true;
    }
    if (any) {
      count++;
      z.fill(0);
    }
  }
  return count;
}

/**
 * Smallest L_e whose pooled false-alarm rate is at or below the target. `rate(le)` must be the
 * pooled per-tool, per-monitored-run alarm rate on in-control data. Throws if rule 1 alone
 * (L_e = infinity) already exceeds the target, instead of silently pinning at a bound.
 */
export function calibrate(rate: (le: number) => number, target = FA_TARGET): number {
  const r1Only = rate(Infinity);
  if (r1Only > target) {
    throw new Error(`calibration infeasible: rule 1 alone gives ${r1Only} > target ${target}`);
  }
  let lo = 0;
  let hi = 1;
  while (rate(hi) > target) {
    lo = hi;
    hi *= 2;
    if (hi > 1e6) throw new Error("calibration did not bracket the target");
  }
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) <= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
