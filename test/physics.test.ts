import { describe, expect, it } from "vitest";
import { DEPOSIT_TIMES_S, ETA0, P_MAX, SAT_FRACTION, SETPOINTS, SIGMA_ETA, T_WALL, pLoss } from "../src/domain/params";
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
