import type pg from "pg";
import type { VersionInfo } from "../domain/banner";
import { fitPhaseI, flowIndex, heaterIndex, thicknessIndex, type PhaseIModel, type RunSeries } from "../domain/features";
import { holdSources, isOutOfSpec, rowAt, runHold, type HoldAlarm } from "../domain/hold";
import { lotlineLabel, type LabelOutput } from "../domain/label";
import { PHASE_I_RUNS } from "../domain/params";
import { EWMA_FACTOR, L1_LIMIT, runFamily, type FamilyAlarm } from "../domain/spc";
import { DEPOSIT, type RecipeStep } from "../domain/types";

export interface ToolRunRow {
  runId: string;
  runIdx: number;
  version: number;
  toolConfigVersion: number;
  tempC: number;
  flowSccm: number;
  depositS: number;
  pDep: number;
  k: number;
  basePressure: number;
  satDepS: number;
  tempMeanDep: number;
  flowMeanDep: number;
  pressureMeanDep: number;
  thickness: number;
  target: number;
  specHw: number;
}

/** Finished runs of a tool, in order, stopping at the first gap. */
export async function loadToolRuns(pool: pg.Pool, toolId: string): Promise<ToolRunRow[]> {
  const { rows } = await pool.query(
    `select r.id, r.run_idx, r.recipe_version, r.tool_config_version, rv.steps,
            hf.p_dep, hf.k, hf.base_pressure, hf.sat_dep_s,
            m.thickness, m.target, m.spec_hw,
            st.mean as temp_mean, sf.mean as flow_mean, sp.mean as pressure_mean
       from run r
       join recipe_version rv on rv.tool_id = r.tool_id and rv.version = r.recipe_version
       join health_features hf on hf.run_id = r.id
       join measurement m on m.run_id = r.id
       join step_summary st on st.run_id = r.id and st.step_idx = $2 and st.channel = 'heater_temp'
       join step_summary sf on sf.run_id = r.id and sf.step_idx = $2 and sf.channel = 'gas_flow'
       join step_summary sp on sp.run_id = r.id and sp.step_idx = $2 and sp.channel = 'pressure'
      where r.tool_id = $1 and r.end_ms is not null
      order by r.run_idx`,
    [toolId, DEPOSIT],
  );
  const out: ToolRunRow[] = [];
  for (const x of rows) {
    if (x.run_idx !== out.length + 1) break;
    const dep = (x.steps as RecipeStep[])[DEPOSIT];
    out.push({
      runId: x.id,
      runIdx: x.run_idx,
      version: x.recipe_version,
      toolConfigVersion: x.tool_config_version,
      tempC: dep.tempC,
      flowSccm: dep.flowSccm,
      depositS: dep.durationS,
      pDep: x.p_dep,
      k: x.k,
      basePressure: x.base_pressure,
      satDepS: x.sat_dep_s,
      tempMeanDep: x.temp_mean,
      flowMeanDep: x.flow_mean,
      pressureMeanDep: x.pressure_mean,
      thickness: x.thickness,
      target: x.target,
      specHw: x.spec_hw,
    });
  }
  return out;
}

export function toSeries(rows: ToolRunRow[]): RunSeries {
  const col = (f: (r: ToolRunRow) => number) => Float64Array.from(rows, f);
  return {
    n: rows.length,
    tempC: col((r) => r.tempC),
    flowSccm: col((r) => r.flowSccm),
    versionIdx: col((r) => r.version),
    pDep: col((r) => r.pDep),
    k: col((r) => r.k),
    satDepS: col((r) => r.satDepS),
    tempMeanDep: col((r) => r.tempMeanDep),
    flowMeanDep: col((r) => r.flowMeanDep),
    pressureMeanDep: col((r) => r.pressureMeanDep),
    thickness: col((r) => r.thickness),
    target: col((r) => r.target),
  };
}

export interface DetectorConfig {
  r: number;
  s: number;
  leLotline: number;
  leTrend: number;
}

export interface ToolHealth {
  n: number;
  phaseIRuns: number;
  phaseIComplete: boolean;
  s: number;
  rows: ToolRunRow[];
  model: PhaseIModel | null;
  index: { heater: Float64Array; flow: Float64Array; thickness: Float64Array } | null;
  ewma: { heater: Float64Array; flow: Float64Array; thickness: Float64Array } | null;
  limits: { heater: { rule1: number; ewma: number }; flow: { rule1: number; ewma: number }; thickness: { rule1: number; ewma: number } } | null;
  signals: { lotline: FamilyAlarm[]; trend: FamilyAlarm[]; hold: HoldAlarm[] };
  oosRuns: number[];
  versions: (VersionInfo & { lastRun: number })[];
  /** Tolerance and saturation excursions over runs 1-N (the "tool alarms" a tool would show). */
  toolAlarmCount: number;
  /** Max over runs 1-N of |deposit-stable-window mean heater_temp - setpoint|, °C. */
  maxTempDev: number;
  firsts: { flagRun: number | null; flagCharts: number[] | null; trendRun: number | null; firstOosRun: number | null };
  label: LabelOutput;
}

export function versionsOf(rows: ToolRunRow[]): (VersionInfo & { lastRun: number })[] {
  const out: (VersionInfo & { lastRun: number })[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.version === r.version) last.lastRun = r.runIdx;
    else out.push({ version: r.version, firstRun: r.runIdx, lastRun: r.runIdx, tempC: r.tempC, flowSccm: r.flowSccm, depositS: r.depositS });
  }
  return out;
}

/** Every detector, run on read over the tool's stored runs (the same functions pnpm eval uses). */
export function toolHealth(rows: ToolRunRow[], cfg: DetectorConfig): ToolHealth {
  const n = rows.length;
  const series = toSeries(rows);
  const oosRuns: number[] = [];
  let toolAlarmCount = 0;
  let maxTempDev = 0;
  for (let i = 0; i < n; i++) {
    if (isOutOfSpec(series.thickness[i], series.target[i], cfg.r)) oosRuns.push(i + 1);
    if (holdSources(rowAt(series, i), cfg.r).some((s) => s !== "metrology")) toolAlarmCount++;
    maxTempDev = Math.max(maxTempDev, Math.abs(series.tempMeanDep[i] - series.tempC[i]));
  }
  const phaseIComplete = n >= PHASE_I_RUNS;
  let model: PhaseIModel | null = null;
  let index: ToolHealth["index"] = null;
  let ewma: ToolHealth["ewma"] = null;
  let limits: ToolHealth["limits"] = null;
  let lot: FamilyAlarm[] = [];
  let trend: FamilyAlarm[] = [];
  let hold: HoldAlarm[] = [];
  if (phaseIComplete) {
    model = fitPhaseI(series);
    const h = heaterIndex(series, model);
    const f = flowIndex(series, model);
    const t = thicknessIndex(series);
    const lt = runFamily([h, f], [model.sigmaHeater, model.sigmaFlow], cfg.leLotline, n);
    const tt = runFamily([t], [model.sigmaThickness], cfg.leTrend, n);
    lot = lt.alarms;
    trend = tt.alarms;
    hold = runHold(series, cfg.r);
    index = { heater: h, flow: f, thickness: t };
    ewma = { heater: lt.z[0], flow: lt.z[1], thickness: tt.z[0] };
    const lim = (sd: number, le: number) => ({ rule1: L1_LIMIT * sd, ewma: le * sd * EWMA_FACTOR });
    limits = {
      heater: lim(model.sigmaHeater, cfg.leLotline),
      flow: lim(model.sigmaFlow, cfg.leLotline),
      thickness: lim(model.sigmaThickness, cfg.leTrend),
    };
  }
  const flag = lot.find((a) => a.run >= cfg.s) ?? null;
  const firsts = {
    flagRun: flag?.run ?? null,
    flagCharts: flag?.charts ?? null,
    trendRun: trend.find((a) => a.run >= cfg.s)?.run ?? null,
    firstOosRun: oosRuns.find((r) => r >= cfg.s) ?? null,
  };
  return {
    n,
    phaseIRuns: PHASE_I_RUNS,
    phaseIComplete,
    s: cfg.s,
    rows,
    model,
    index,
    ewma,
    limits,
    signals: { lotline: lot, trend, hold },
    oosRuns,
    versions: versionsOf(rows),
    toolAlarmCount,
    maxTempDev,
    firsts,
    label: lotlineLabel({ flagRun: firsts.flagRun, trendRun: firsts.trendRun, firstOosRun: firsts.firstOosRun, onsetRun: cfg.s, lastRun: n }),
  };
}
