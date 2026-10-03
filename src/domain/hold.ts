import { A_FLOW, K0, P_BASE_NOM, PHASE_I_RUNS, dTSpec, hwRel } from "./params";
import type { RunSeries } from "./features";

export type HoldSource = "temp" | "flow" | "pressure" | "saturation" | "metrology";
export const HOLD_SOURCES: readonly HoldSource[] = ["temp", "flow", "pressure", "saturation", "metrology"];

export interface HoldRow {
  tempC: number;
  flowSccm: number;
  tempMeanDep: number;
  flowMeanDep: number;
  pressureMeanDep: number;
  satDepS: number;
  thickness: number;
  target: number;
}

/**
 * What a tool and a fab procedure already give you: recipe tolerance bands on the deposit-step
 * means (derived from the metrology spec), a heater saturation alarm, and a metrology hold at
 * the first out-of-spec wafer.
 */
export function holdSources(row: HoldRow, r: number): HoldSource[] {
  const hw = hwRel(r);
  const out: HoldSource[] = [];
  if (Math.abs(row.tempMeanDep - row.tempC) > dTSpec(r)) out.push("temp");
  if (Math.abs(row.flowMeanDep / row.flowSccm - 1) > hw / A_FLOW) out.push("flow");
  const pCenter = P_BASE_NOM + K0 * row.flowSccm;
  if (Math.abs(row.pressureMeanDep - pCenter) > (K0 * row.flowSccm * hw) / A_FLOW) out.push("pressure");
  if (row.satDepS > 1) out.push("saturation");
  if (Math.abs(row.thickness / row.target - 1) > hw) out.push("metrology");
  return out;
}

export function isOutOfSpec(thickness: number, target: number, r: number): boolean {
  return Math.abs(thickness / target - 1) > hwRel(r);
}

export function rowAt(s: RunSeries, i: number): HoldRow {
  return {
    tempC: s.tempC[i],
    flowSccm: s.flowSccm[i],
    tempMeanDep: s.tempMeanDep[i],
    flowMeanDep: s.flowMeanDep[i],
    pressureMeanDep: s.pressureMeanDep[i],
    satDepS: s.satDepS[i],
    thickness: s.thickness[i],
    target: s.target[i],
  };
}

export interface HoldAlarm {
  run: number;
  sources: HoldSource[];
}

/** Every run (from run 51) on which any hold source fires. */
export function runHold(s: RunSeries, r: number, from = PHASE_I_RUNS + 1): HoldAlarm[] {
  const out: HoldAlarm[] = [];
  for (let i = from - 1; i < s.n; i++) {
    const src = holdSources(rowAt(s, i), r);
    if (src.length > 0) out.push({ run: i + 1, sources: src });
  }
  return out;
}
