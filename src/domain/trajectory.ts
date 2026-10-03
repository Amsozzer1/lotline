import type { RunSeries } from "./features";
import { schedule } from "./schedule";
import { measuredThickness, simulateRun } from "./sim";
import type { Scenario } from "./types";

/** Per-run values for one simulated tool, independent of r (thickness is rebuilt per r). */
export interface Trajectory {
  seed: number;
  toolId: number;
  scenario: Scenario;
  delta: number;
  n: number;
  tempC: Float64Array;
  flowSccm: Float64Array;
  depositS: Float64Array;
  versionIdx: Float64Array;
  pDep: Float64Array;
  k: Float64Array;
  basePressure: Float64Array;
  satDepS: Float64Array;
  tempMeanDep: Float64Array;
  flowMeanDep: Float64Array;
  pressureMeanDep: Float64Array;
  thModel: Float64Array;
  target: Float64Array;
  zEps: Float64Array;
  zV: Float64Array;
}

export function simulateTrajectory(seed: number, toolId: number, n: number, scenario: Scenario, delta: number): Trajectory {
  const f = () => new Float64Array(n);
  const t: Trajectory = {
    seed, toolId, scenario, delta, n,
    tempC: f(), flowSccm: f(), depositS: f(), versionIdx: f(), pDep: f(), k: f(), basePressure: f(), satDepS: f(),
    tempMeanDep: f(), flowMeanDep: f(), pressureMeanDep: f(), thModel: f(), target: f(), zEps: f(), zV: f(),
  };
  for (const s of schedule(seed, toolId, n)) {
    const i = s.runIdx - 1;
    const res = simulateRun({ seed, toolId, runIdx: s.runIdx, versionIdx: s.versionIdx, recipe: s.recipe, scenario, delta });
    const ft = res.features;
    t.tempC[i] = s.recipe.tempC;
    t.flowSccm[i] = s.recipe.flowSccm;
    t.depositS[i] = s.recipe.depositS;
    t.versionIdx[i] = s.versionIdx;
    t.pDep[i] = ft.pDep;
    t.k[i] = ft.k;
    t.basePressure[i] = ft.basePressure;
    t.satDepS[i] = ft.satDepS;
    t.tempMeanDep[i] = ft.tempMeanDep;
    t.flowMeanDep[i] = ft.flowMeanDep;
    t.pressureMeanDep[i] = ft.pressureMeanDep;
    t.thModel[i] = res.thModel;
    t.target[i] = res.target;
    t.zEps[i] = res.zEps;
    t.zV[i] = res.zV;
  }
  return t;
}

/** The detector view of a trajectory at a given r (thickness depends on r; nothing else does). */
export function seriesAt(t: Trajectory, r: number, n = t.n): RunSeries {
  const thickness = new Float64Array(n);
  for (let i = 0; i < n; i++) thickness[i] = measuredThickness(t.thModel[i], t.zV[i], t.zEps[i], r);
  return {
    n,
    tempC: t.tempC,
    flowSccm: t.flowSccm,
    versionIdx: t.versionIdx,
    pDep: t.pDep,
    k: t.k,
    satDepS: t.satDepS,
    tempMeanDep: t.tempMeanDep,
    flowMeanDep: t.flowMeanDep,
    pressureMeanDep: t.pressureMeanDep,
    thickness,
    target: t.target,
  };
}
