import { describe, expect, it } from "vitest";
import { fitPhaseI, expectedPower, flowIndex, heaterIndex } from "../src/domain/features";
import { holdSources, rowAt } from "../src/domain/hold";
import {
  DEPOSIT_TIMES_S,
  ETA0,
  NONE_TRAJECTORY_RUNS,
  ONSET_RUN,
  P_MAX,
  SAT_FRACTION,
  SETPOINTS,
  SIGMA_ETA,
  T_WALL,
  dTSpec,
  hwRel,
  pLoss,
} from "../src/domain/params";
import { seriesAt, simulateTrajectory } from "../src/domain/trajectory";
import { makeRecipe } from "../src/domain/recipe";
import { simulateRun } from "../src/domain/sim";
import { DEPOSIT, PUMPDOWN } from "../src/domain/types";

function quietRun(tempC: number, depositS: number, eta: number) {
  return simulateRun(
    { seed: 1, toolId: 1, runIdx: 1, versionIdx: 1, recipe: makeRecipe(1, tempC, 50, depositS), scenario: "none", delta: 0 },
    { frames: true, noiseFree: true, eta },
  );
}

describe("test 3(a): settling is deterministic and inside the window", () => {
  for (const tempC of SETPOINTS) {
    for (const depositS of [60, 90, 120]) {
      for (const etaScale of [0.97, 1, 1.03]) {
        it(`${tempC} °C, ${depositS} s, eta x${etaScale}`, () => {
          const eta = ETA0 * etaScale;
          const res = quietRun(tempC, depositS, eta);
          const err = Math.abs((res.features.pDep * eta) / pLoss(tempC) - 1);
          expect(err).toBeLessThan(0.05 * SIGMA_ETA);
          const f = res.frames!;
          let maxDeposit = 0;
          let maxLatePumpdown = 0;
          for (let i = 0; i < res.nFrames; i++) {
            if (f.stepIdx[i] === DEPOSIT) maxDeposit = Math.max(maxDeposit, f.heaterPower[i]);
            const tInRun = f.tMs[i] - res.plan[0].startMs;
            if (f.stepIdx[i] === PUMPDOWN && tInRun >= 5000) maxLatePumpdown = Math.max(maxLatePumpdown, f.heaterPower[i]);
          }
          expect(maxDeposit).toBeLessThan(SAT_FRACTION * P_MAX);
          expect(maxLatePumpdown).toBeLessThan(SAT_FRACTION * P_MAX);
          expect(res.features.satDepS).toBe(0);
        });
      }
    }
  }
  it("covers every deposit time the schedule can pick", () => {
    expect(DEPOSIT_TIMES_S[0]).toBe(60);
    expect(DEPOSIT_TIMES_S[DEPOSIT_TIMES_S.length - 1]).toBe(120);
  });
});

describe("test 3(c): raw W/°C is not recipe-independent", () => {
  it("differs between 350 °C and 425 °C by more than 5 sigma", () => {
    const raw = (tempC: number) => quietRun(tempC, 90, ETA0).features.pDep / (tempC - T_WALL);
    const rel = raw(425) / raw(350) - 1;
    expect(Math.abs(rel)).toBeGreaterThan(5 * SIGMA_ETA);
  });
});

describe("test 3(b): the Phase I heat-loss fit is unbiased", () => {
  it("mean of P_loss / (eta0 P-hat) - 1 is within 3 SE of 0 at every setpoint, over 200 tools", () => {
    const perSetpoint = new Map<number, number[]>(SETPOINTS.map((t) => [t, []]));
    for (let seed = 1; seed <= 200; seed++) {
      const tr = simulateTrajectory(seed, 1, 50, "none", 0);
      const m = fitPhaseI(seriesAt(tr, 4));
      for (const t of SETPOINTS) perSetpoint.get(t)!.push(pLoss(t) / (ETA0 * expectedPower(m, t)) - 1);
    }
    for (const [, xs] of perSetpoint) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
      expect(Math.abs(mean)).toBeLessThan((3 * sd) / Math.sqrt(xs.length));
    }
  });
});

describe("test 3(d): faults hide in the readings", () => {
  it("tc_drift: the temperature reading stays in band while heater_index moves", () => {
    const tr = simulateTrajectory(1, 1, 260, "tc_drift", 0.2);
    const s = seriesAt(tr, 4);
    const m = fitPhaseI(s);
    const h = heaterIndex(s, m);
    for (let i = ONSET_RUN - 1; i < 260; i++) expect(Math.abs(s.tempMeanDep[i] - s.tempC[i])).toBeLessThan(dTSpec(4));
    const tail = Array.from(h.slice(250)).reduce((a, b) => a + b, 0) / 10;
    expect(tail).toBeLessThan(-5 * m.sigmaHeater);
  });
  it("mfc_gain_drift: the flow reading stays on setpoint while flow_index moves", () => {
    const tr = simulateTrajectory(2, 1, 260, "mfc_gain_drift", 0.2);
    const s = seriesAt(tr, 4);
    const m = fitPhaseI(s);
    const f = flowIndex(s, m);
    for (let i = ONSET_RUN - 1; i < 260; i++) expect(Math.abs(s.flowMeanDep[i] / s.flowSccm[i] - 1)).toBeLessThan(hwRel(4));
    const tail = Array.from(f.slice(250)).reduce((a, b) => a + b, 0) / 10;
    expect(tail).toBeGreaterThan(5 * m.sigmaFlow);
  });
  it("the hold's saturation source never fires on an in-control run", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = seriesAt(simulateTrajectory(seed, 1, NONE_TRAJECTORY_RUNS, "none", 0), 4);
      for (let i = 0; i < s.n; i++) expect(holdSources(rowAt(s, i), 4)).not.toContain("saturation");
    }
  });
});
