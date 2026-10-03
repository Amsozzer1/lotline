export type Scenario = "none" | "tc_drift" | "mfc_gain_drift";

export type StepName = "pumpdown" | "stabilize" | "deposit" | "purge";
export const STEP_NAMES: readonly StepName[] = ["pumpdown", "stabilize", "deposit", "purge"];
export const PUMPDOWN = 0;
export const DEPOSIT = 2;

export interface RecipeStep {
  name: StepName;
  durationS: number;
  settleS: number;
  tempC: number;
  /** Process gas setpoint, sccm (0 when the gas is off). */
  flowSccm: number;
}

export interface RecipeVersion {
  name: string;
  version: number;
  tempC: number;
  flowSccm: number;
  depositS: number;
  steps: RecipeStep[];
}

export interface StepPlanEntry {
  name: StepName;
  startMs: number;
  durationMs: number;
  settleMs: number;
}

export interface Experiment {
  id: string;
  name: string;
  goal: string;
}

export interface Pattern {
  file: string;
  sha: string;
}

export const CHANNELS = ["heater_temp", "heater_power", "pressure", "gas_flow"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface StepSummary {
  stepIdx: number;
  channel: Channel;
  mean: number;
  std: number;
  n: number;
  expectedN: number;
}

/** Per-run features, computed from the readings only (what a real tool would report). */
export interface RunFeatures {
  /** Mean heater power over the deposit stable window, W. */
  pDep: number;
  /** (deposit pressure - base pressure) / flow setpoint, mTorr/sccm. */
  k: number;
  basePressure: number;
  /** Longest continuous stretch in deposit with heater power above 95% of P_max, s. */
  satDepS: number;
  tempMeanDep: number;
  flowMeanDep: number;
  pressureMeanDep: number;
}
