import { schedule } from "../domain/schedule";
import { runMessages, type ToolIdentity } from "../sim/runMessages";
import type { Ingestor } from "./ingest";

/** The backfill TelemetrySource: simulates runs in-process and feeds the same handler as MQTT. */
export async function backfillTool(ing: Ingestor, tool: ToolIdentity, nRuns: number, r: number, fromRun = 1): Promise<void> {
  for (const s of schedule(tool.seed, tool.simToolId, nRuns)) {
    if (s.runIdx < fromRun) continue;
    for (const msg of runMessages(tool, s, r)) await ing.handle(msg);
  }
}
