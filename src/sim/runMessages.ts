import type { SourceMsg } from "../domain/messages";
import { hwRel } from "../domain/params";
import { stepPlan } from "../domain/recipe";
import type { ScheduledRun } from "../domain/schedule";
import { measuredThickness, simulateRun } from "../domain/sim";
import type { Scenario } from "../domain/types";

export interface ToolIdentity {
  displayId: string;
  seed: number;
  simToolId: number;
  scenario: Scenario;
  delta: number;
}

export const runId = (toolId: string, runIdx: number) => `${toolId}-r${String(runIdx).padStart(4, "0")}`;
export const waferId = (toolId: string, runIdx: number) => `${toolId}-w${String(runIdx).padStart(4, "0")}`;
export const experimentId = (toolId: string, idx: number) => `${toolId}-e${String(idx).padStart(3, "0")}`;

/** Everything a simulated tool publishes about one run, in order: RunStart, frames, RunEnd. */
export function* runMessages(tool: ToolIdentity, s: ScheduledRun, r: number): Generator<SourceMsg> {
  const res = simulateRun(
    { seed: tool.seed, toolId: tool.simToolId, runIdx: s.runIdx, versionIdx: s.versionIdx, recipe: s.recipe, scenario: tool.scenario, delta: tool.delta },
    { frames: true },
  );
  const id = runId(tool.displayId, s.runIdx);
  const plan = stepPlan(s.recipe, s.runIdx);
  yield {
    kind: "run_start",
    seq: 0,
    runId: id,
    runIdx: s.runIdx,
    tool: { id: tool.displayId, displayName: tool.displayId.toUpperCase(), simSeed: tool.seed, simToolId: tool.simToolId },
    toolConfig: { version: 1, notes: "As built" },
    wafer: {
      id: waferId(tool.displayId, s.runIdx),
      experiment: { id: experimentId(tool.displayId, s.experimentIdx), ...s.experiment },
      pattern: s.pattern,
    },
    recipeVersion: { name: s.recipe.name, version: s.recipe.version, steps: s.recipe.steps },
    startMs: plan[0].startMs,
    stepPlan: plan,
  };
  const f = res.frames!;
  for (let i = 0; i < res.nFrames; i++) {
    yield {
      kind: "frame",
      seq: i + 1,
      runId: id,
      stepIdx: f.stepIdx[i],
      tMs: f.tMs[i],
      heaterTemp: f.heaterTemp[i],
      heaterPower: f.heaterPower[i],
      pressure: f.pressure[i],
      gasFlow: f.gasFlow[i],
    };
  }
  yield {
    kind: "run_end",
    seq: res.nFrames + 1,
    runId: id,
    expectedFrames: res.nFrames,
    measurement: { thickness: measuredThickness(res.thModel, res.zV, res.zEps, r), target: res.target, specHw: hwRel(r) },
  };
}
