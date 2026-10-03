import {
  DEPOSIT_SETTLE_S,
  PUMPDOWN_S,
  PURGE_S,
  RUN_SPACING_MS,
  STABILIZE_S,
} from "./params";
import type { RecipeStep, RecipeVersion, StepPlanEntry } from "./types";

export const RECIPE_NAME = "film-dep";

export function makeRecipe(version: number, tempC: number, flowSccm: number, depositS: number): RecipeVersion {
  const steps: RecipeStep[] = [
    { name: "pumpdown", durationS: PUMPDOWN_S, settleS: 0, tempC, flowSccm: 0 },
    { name: "stabilize", durationS: STABILIZE_S, settleS: 0, tempC, flowSccm },
    { name: "deposit", durationS: depositS, settleS: DEPOSIT_SETTLE_S, tempC, flowSccm },
    { name: "purge", durationS: PURGE_S, settleS: 0, tempC, flowSccm: 0 },
  ];
  return { name: RECIPE_NAME, version, tempC, flowSccm, depositS, steps };
}

export function runStartMs(runIdx: number): number {
  return runIdx * RUN_SPACING_MS;
}

export function stepPlan(recipe: RecipeVersion, runIdx: number): StepPlanEntry[] {
  let t = runStartMs(runIdx);
  return recipe.steps.map((s) => {
    const e = { name: s.name, startMs: t, durationMs: s.durationS * 1000, settleMs: s.settleS * 1000 };
    t += e.durationMs;
    return e;
  });
}

export function expectedFrames(recipe: RecipeVersion): number {
  return recipe.steps.reduce((n, s) => n + s.durationS * 10, 0);
}
