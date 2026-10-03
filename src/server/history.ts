import type pg from "pg";
import { bannerLines } from "../domain/banner";
import { DEPOSIT, type RecipeStep } from "../domain/types";
import { loadToolRuns, toolHealth, type DetectorConfig } from "./health";

export interface RecipeChange {
  field: "temperature" | "flow" | "deposit time";
  from: number;
  to: number;
  unit: string;
}

export interface RunHistory {
  run: { id: string; runIdx: number; toolId: string; startMs: number; endMs: number | null; expectedFrames: number | null };
  tool: { id: string; displayName: string };
  toolConfig: { version: number; notes: string };
  wafer: { id: string; patternFile: string; patternSha: string };
  experiment: { id: string; name: string; goal: string };
  recipe: { name: string; version: number; steps: RecipeStep[] };
  recipeChanges: RecipeChange[];
  frames: { stepIdx: number[]; tMs: number[]; heaterTemp: number[]; heaterPower: number[]; pressure: number[]; gasFlow: number[] };
  stepSummaries: { stepIdx: number; channel: string; mean: number; std: number; n: number; expectedN: number }[];
  features: { pDep: number; k: number; basePressure: number; satDepS: number } | null;
  measurement: { thickness: number; target: number; specHw: number; deviation: number; outOfSpec: boolean } | null;
  banner: string[];
}

export async function loadRunHistory(pool: pg.Pool, runId: string, cfg: DetectorConfig): Promise<RunHistory | null> {
  const r = await pool.query(
    `select r.*, t.display_name, tc.notes as config_notes, w.pattern_file, w.pattern_sha,
            e.id as experiment_id, e.name as experiment_name, e.goal as experiment_goal,
            rv.name as recipe_name, rv.steps, prev.steps as prev_steps
       from run r
       join tool t on t.id = r.tool_id
       join tool_config tc on tc.tool_id = r.tool_id and tc.version = r.tool_config_version
       join wafer w on w.id = r.wafer_id
       join experiment e on e.id = w.experiment_id
       join recipe_version rv on rv.tool_id = r.tool_id and rv.version = r.recipe_version
       left join recipe_version prev on prev.tool_id = r.tool_id and prev.version = r.recipe_version - 1
      where r.id = $1`,
    [runId],
  );
  if (r.rowCount === 0) return null;
  const x = r.rows[0];
  const [frames, summaries, features, measurement] = await Promise.all([
    pool.query(
      "select step_idx, t_ms, heater_temp, heater_power, pressure, gas_flow from frame where run_id = $1 order by t_ms, seq",
      [runId],
    ),
    pool.query("select step_idx, channel, mean, std, n, expected_n from step_summary where run_id = $1 order by step_idx, channel", [runId]),
    pool.query("select p_dep, k, base_pressure, sat_dep_s from health_features where run_id = $1", [runId]),
    pool.query("select thickness, target, spec_hw from measurement where run_id = $1", [runId]),
  ]);
  const steps = x.steps as RecipeStep[];
  const prev = x.prev_steps as RecipeStep[] | null;
  const recipeChanges: RecipeChange[] = [];
  if (prev) {
    const a = prev[DEPOSIT];
    const b = steps[DEPOSIT];
    if (a.tempC !== b.tempC) recipeChanges.push({ field: "temperature", from: a.tempC, to: b.tempC, unit: "°C" });
    if (a.flowSccm !== b.flowSccm) recipeChanges.push({ field: "flow", from: a.flowSccm, to: b.flowSccm, unit: "sccm" });
    if (a.durationS !== b.durationS) recipeChanges.push({ field: "deposit time", from: a.durationS, to: b.durationS, unit: "s" });
  }
  const m = measurement.rows[0];
  const f = features.rows[0];

  // Banner, from the tool's detectors (computed on read over its stored runs)
  const health = toolHealth(await loadToolRuns(pool, x.tool_id), cfg);
  let banner: string[] = [];
  if (x.run_idx <= health.n) {
    const versions = new Map(health.versions.map((v) => [v.version, v]));
    banner = bannerLines({
      runIdx: x.run_idx,
      phaseIRuns: health.phaseIRuns,
      alarm: health.signals.lotline.find((a) => a.run === x.run_idx) ?? null,
      index: health.index ? [health.index.heater, health.index.flow] : [[], []],
      ewma: health.ewma ? [health.ewma.heater, health.ewma.flow] : [[], []],
      versionOfRun: health.rows.map((row) => row.version),
      tempOfRun: health.rows.map((row) => row.tempC),
      versions,
      toolConfigVersion: x.tool_config_version,
      toolConfigSinceRun: 1,
    });
  }

  const col = (k: string) => frames.rows.map((row) => row[k] as number);
  return {
    run: { id: x.id, runIdx: x.run_idx, toolId: x.tool_id, startMs: x.start_ms, endMs: x.end_ms, expectedFrames: x.expected_frames },
    tool: { id: x.tool_id, displayName: x.display_name },
    toolConfig: { version: x.tool_config_version, notes: x.config_notes },
    wafer: { id: x.wafer_id, patternFile: x.pattern_file, patternSha: x.pattern_sha },
    experiment: { id: x.experiment_id, name: x.experiment_name, goal: x.experiment_goal },
    recipe: { name: x.recipe_name, version: x.recipe_version, steps },
    recipeChanges,
    frames: {
      stepIdx: col("step_idx"),
      tMs: col("t_ms"),
      heaterTemp: col("heater_temp"),
      heaterPower: col("heater_power"),
      pressure: col("pressure"),
      gasFlow: col("gas_flow"),
    },
    stepSummaries: summaries.rows.map((s) => ({ stepIdx: s.step_idx, channel: s.channel, mean: s.mean, std: s.std, n: s.n, expectedN: s.expected_n })),
    features: f ? { pDep: f.p_dep, k: f.k, basePressure: f.base_pressure, satDepS: f.sat_dep_s } : null,
    measurement: m
      ? {
          thickness: m.thickness,
          target: m.target,
          specHw: m.spec_hw,
          deviation: m.thickness / m.target - 1,
          outOfSpec: Math.abs(m.thickness / m.target - 1) > m.spec_hw,
        }
      : null,
    banner,
  };
}
