/**
 * Simulator and detector parameters. Everything here is generic and illustrative: a first-order
 * model of a small deposition chamber, not a model of any real tool or process.
 */

export const KELVIN = 273.15;
/** Boltzmann constant, eV/K. */
export const K_B = 8.617333262e-5;

// Clock
export const TICK_MS = 100; // 10 Hz process telemetry
export const DT_S = TICK_MS / 1000;
export const RUN_SPACING_MS = 300_000; // virtual time between run starts

// Heater stage: C dT/dt = eta P - (T - T_wall)/R_th - epsSigmaA (T^4 - T_wall^4)
export const T_WALL = 25; // °C
export const SETPOINTS = [350, 375, 400, 425] as const; // °C
export const T_REF = 400; // °C, linearisation and reference point
export const HEAT_CAPACITY = 20; // J/K
export const R_TH = 3.75; // K/W, conductive loss
export const EPS_SIGMA_A = 5.065e-10; // W/K^4, radiative loss
export const ETA0 = 0.8; // nominal heater-to-stage coupling
export const SIGMA_ETA = 0.005; // run-to-run heater repeatability (1 sigma, relative)
export const START_OFFSET_C = -10; // a piece lands on a hot stage: each run starts 10 °C below setpoint

const k4 = (tC: number) => {
  const tk = tC + KELVIN;
  const t2 = tk * tk;
  return t2 * t2;
};
const T_WALL_K4 = k4(T_WALL);

/** Heat loss from the stage at temperature tC, W. */
export function pLoss(tC: number): number {
  return (tC - T_WALL) / R_TH + EPS_SIGMA_A * (k4(tC) - T_WALL_K4);
}

/** d pLoss / dT, W/K. */
export function dPLossDT(tC: number): number {
  const tk = tC + KELVIN;
  return 1 / R_TH + 4 * EPS_SIGMA_A * tk * tk * tk;
}

// PI loop on the temperature reading, tuned on the plant linearised at T_REF (critically damped).
export const R_EFF = 1 / dPLossDT(T_REF); // K/W
export const TAU_S = HEAT_CAPACITY * R_EFF;
export const LOOP_GAIN = 20;
export const KC = LOOP_GAIN / (ETA0 * R_EFF); // W/K
export const TI_S = (4 * TAU_S * LOOP_GAIN) / ((LOOP_GAIN + 1) * (LOOP_GAIN + 1));
export const P_MAX = pLoss(425) / ETA0 / 0.8; // 80% duty at the highest setpoint
export const SAT_FRACTION = 0.95;

// Chamber with a fixed throttle: p = p_base + k * Q_delivered
export const K0 = 0.2; // mTorr/sccm
export const P_BASE_NOM = 5; // mTorr
export const PUMPDOWN_AMPLITUDE = 50; // mTorr
export const PUMPDOWN_TAU_S = 1;
export const FLOW_MIN = 30; // sccm
export const FLOW_MAX = 80;

// Reading noise per tick (1 sigma)
export const NOISE_TEMP = 0.1; // °C
export const NOISE_FLOW = 0.05; // sccm
export const NOISE_PRESSURE = 0.02; // mTorr

// Steps
export const PUMPDOWN_S = 20;
export const STABILIZE_S = 60;
export const PURGE_S = 10;
export const DEPOSIT_TIMES_S = [60, 70, 80, 90, 100, 110, 120] as const;
export const DEPOSIT_SETTLE_S = 10;
export const BASE_WINDOW_S = 5; // base pressure = mean over the last 5 s of pumpdown

// Metrology: thickness = r0 exp(-(Ea/kB)(1/T - 1/T0)) (Q/Q0)^a t_dep, from the true state
export const EA_EV = 0.5; // apparent activation energy, intermediate regime
export const A_FLOW = 1; // flow exponent (the simulator multiplies by Q/Q0 directly)
export const R0_NM_S = 1; // deposition rate at T0 and Q0, nm/s
export const T0 = 400; // °C
export const Q0 = 50; // sccm

// Derived, not tuned. r = how many feature sigmas the spec edge sits from nominal.
export const DLNP_DT = dPLossDT(T_REF) / pLoss(T_REF); // 1/K
export const ARRHENIUS_SENS = EA_EV / (K_B * (T_REF + KELVIN) * (T_REF + KELVIN)); // 1/K
/** Run-to-run thickness sigma (relative). */
export function sigmaEps(r: number): number {
  return (r * SIGMA_ETA * ARRHENIUS_SENS) / (4 * Math.SQRT2 * DLNP_DT);
}
/** Per-version recipe prediction error sigma (relative). */
export function sigmaV(r: number): number {
  return sigmaEps(r);
}
/** Metrology spec half-width (relative): in-control Cpk = 1.33. */
export function hwRel(r: number): number {
  const se = sigmaEps(r);
  const sv = sigmaV(r);
  return 4 * Math.sqrt(se * se + sv * sv);
}
export const SIGMA_K = hwRel(4) / (4 * A_FLOW); // frozen at r = 4
export const SIGMA_PB = 0.55 * K0 * FLOW_MIN * SIGMA_K; // mTorr, frozen at r = 4
/** Heater temperature tolerance (°C) derived from the spec through the Arrhenius sensitivity. */
export function dTSpec(r: number): number {
  return hwRel(r) / ARRHENIUS_SENS;
}
/** Thermocouple bias growth, K per run. */
export function tcDriftRate(delta: number): number {
  return (delta * SIGMA_ETA) / DLNP_DT;
}
/** MFC gain drift growth, fraction per run. */
export function mfcDriftRate(delta: number): number {
  return delta * SIGMA_K;
}

// Run protocol
export const PHASE_I_RUNS = 50;
export const ONSET_RUN = 61;
export const WINDOW_RUNS = 200;
export const DRIFT_TRAJECTORY_RUNS = ONSET_RUN - 1 + WINDOW_RUNS; // 260
export const NONE_TRAJECTORY_RUNS = 1050;

// SPC
export const L1 = 4.0; // rule 1, in sigma-hat
export const LAMBDA = 0.2; // EWMA weight
export const FA_TARGET = 5 / 1000; // per tool, per monitored run

export const HEADLINE = { scenario: "tc_drift", delta: 0.1, r: 4 } as const;
