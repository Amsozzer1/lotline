import type { Pattern, RecipeStep, StepPlanEntry } from "./types";

/** Everything a tool sends about one run, on one ordered topic per tool (tool/<id>/run). */
export interface RunStartMsg {
  kind: "run_start";
  seq: 0;
  runId: string;
  runIdx: number;
  tool: { id: string; displayName: string; simSeed: number; simToolId: number };
  toolConfig: { version: number; notes: string };
  wafer: { id: string; experiment: { id: string; name: string; goal: string }; pattern: Pattern };
  recipeVersion: { name: string; version: number; steps: RecipeStep[] };
  startMs: number;
  stepPlan: StepPlanEntry[];
}

export interface FrameMsg {
  kind: "frame";
  seq: number;
  runId: string;
  stepIdx: number;
  tMs: number;
  heaterTemp: number;
  heaterPower: number;
  pressure: number;
  gasFlow: number;
}

export interface RunEndMsg {
  kind: "run_end";
  seq: number;
  runId: string;
  expectedFrames: number;
  measurement: { thickness: number; target: number; specHw: number };
}

export type SourceMsg = RunStartMsg | FrameMsg | RunEndMsg;
