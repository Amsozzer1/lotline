import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { RunAccumulator } from "../domain/accumulator";
import type { FrameMsg, RunEndMsg, RunStartMsg, SourceMsg } from "../domain/messages";
import { DEPOSIT } from "../domain/types";

interface RunState {
  toolId: string;
  runIdx: number;
  lastSeq: number;
  lastTMs: number;
  flowSetpoint: number;
  acc: RunAccumulator;
}

export interface ToolLiveState {
  state: "idle" | "running";
  runIdx: number | null;
  stepIdx: number | null;
}

const COPY_SQL =
  "COPY frame (run_id, step_idx, seq, t_ms, heater_temp, heater_power, pressure, gas_flow) FROM STDIN";

/**
 * Turns the ordered message stream of each tool into stored runs. Idempotent: anything with a
 * seq at or below the last one seen for its run, or for a run already finalized, is dropped.
 * Frames are buffered and written with COPY (by size or every 250 ms); all flushes are chained,
 * and RunEnd waits for the chain before writing summaries, features and the measurement.
 */
export class Ingestor {
  private readonly runs = new Map<string, RunState>();
  private readonly finalized = new Set<string>();
  private buffer: string[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private flushErr: unknown = null;
  private readonly timer: NodeJS.Timeout;
  readonly toolState = new Map<string, ToolLiveState>();
  dropped = 0;

  constructor(
    private readonly pool: pg.Pool,
    private readonly opts: { flushMs?: number; batchSize?: number; log?: (m: string) => void } = {},
  ) {
    this.timer = setInterval(() => this.flush(), opts.flushMs ?? 250);
    this.timer.unref();
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.flush();
    await this.flushing;
  }

  async handle(msg: SourceMsg): Promise<void> {
    if (this.finalized.has(msg.runId)) {
      this.dropped++;
      return;
    }
    if (msg.kind === "run_start") return this.onRunStart(msg);
    const st = this.runs.get(msg.runId);
    if (!st || msg.seq <= st.lastSeq) {
      this.dropped++;
      return;
    }
    st.lastSeq = msg.seq;
    if (msg.kind === "frame") return this.onFrame(st, msg);
    return this.onRunEnd(st, msg);
  }

  private async onRunStart(m: RunStartMsg): Promise<void> {
    if (this.runs.has(m.runId)) {
      this.dropped++;
      return;
    }
    const existing = await this.pool.query<{ end_ms: number | null }>("select end_ms from run where id = $1", [m.runId]);
    if (existing.rowCount) {
      if (existing.rows[0].end_ms !== null) this.finalized.add(m.runId);
      this.dropped++;
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into tool (id, display_name, sim_seed, sim_tool_id) values ($1, $2, $3, $4) on conflict do nothing",
        [m.tool.id, m.tool.displayName, m.tool.simSeed, m.tool.simToolId],
      );
      await client.query(
        "insert into tool_config (tool_id, version, notes) values ($1, $2, $3) on conflict do nothing",
        [m.tool.id, m.toolConfig.version, m.toolConfig.notes],
      );
      const e = m.wafer.experiment;
      await client.query("insert into experiment (id, name, goal) values ($1, $2, $3) on conflict do nothing", [e.id, e.name, e.goal]);
      await client.query(
        "insert into recipe_version (tool_id, version, name, steps) values ($1, $2, $3, $4) on conflict do nothing",
        [m.tool.id, m.recipeVersion.version, m.recipeVersion.name, JSON.stringify(m.recipeVersion.steps)],
      );
      await client.query(
        "insert into wafer (id, experiment_id, pattern_file, pattern_sha) values ($1, $2, $3, $4) on conflict do nothing",
        [m.wafer.id, e.id, m.wafer.pattern.file, m.wafer.pattern.sha],
      );
      await client.query(
        "insert into run (id, tool_id, run_idx, wafer_id, tool_config_version, recipe_version, start_ms) values ($1, $2, $3, $4, $5, $6, $7)",
        [m.runId, m.tool.id, m.runIdx, m.wafer.id, m.toolConfig.version, m.recipeVersion.version, m.startMs],
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    this.runs.set(m.runId, {
      toolId: m.tool.id,
      runIdx: m.runIdx,
      lastSeq: 0,
      lastTMs: m.startMs,
      flowSetpoint: m.recipeVersion.steps[DEPOSIT].flowSccm,
      acc: new RunAccumulator(m.stepPlan),
    });
    this.toolState.set(m.tool.id, { state: "running", runIdx: m.runIdx, stepIdx: 0 });
  }

  private onFrame(st: RunState, f: FrameMsg): void {
    st.acc.push(f.stepIdx, f.tMs, f.heaterTemp, f.heaterPower, f.pressure, f.gasFlow);
    st.lastTMs = f.tMs;
    this.buffer.push(`${f.runId}\t${f.stepIdx}\t${f.seq}\t${f.tMs}\t${f.heaterTemp}\t${f.heaterPower}\t${f.pressure}\t${f.gasFlow}\n`);
    const ts = this.toolState.get(st.toolId);
    if (ts && ts.stepIdx !== f.stepIdx) ts.stepIdx = f.stepIdx;
    if (this.buffer.length >= (this.opts.batchSize ?? 5000)) this.flush();
  }

  /** Appends the current buffer to the flush chain. */
  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.flushing = this.flushing
      .then(() => this.copy(batch))
      .catch((e) => {
        this.flushErr = e;
        this.opts.log?.(`frame COPY failed: ${String(e)}`);
      });
  }

  private async copy(lines: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await pipeline(Readable.from(lines), client.query(copyFrom(COPY_SQL)));
    } finally {
      client.release();
    }
  }

  private async onRunEnd(st: RunState, m: RunEndMsg): Promise<void> {
    this.flush();
    await this.flushing;
    if (this.flushErr) {
      this.opts.log?.(`not finalizing ${m.runId}: an earlier frame write failed`);
      return;
    }
    const features = st.acc.features(st.flowSetpoint);
    const summaries = st.acc.summaries();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const vals: unknown[] = [];
      const rows = summaries.map((s, i) => {
        vals.push(m.runId, s.stepIdx, s.channel, s.mean, s.std, s.n, s.expectedN);
        const o = i * 7;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
      });
      await client.query(`insert into step_summary (run_id, step_idx, channel, mean, std, n, expected_n) values ${rows.join(", ")}`, vals);
      await client.query(
        "insert into health_features (run_id, p_dep, k, base_pressure, sat_dep_s) values ($1, $2, $3, $4, $5)",
        [m.runId, features.pDep, features.k, features.basePressure, features.satDepS],
      );
      await client.query(
        "insert into measurement (run_id, wafer_id, thickness, target, spec_hw) select $1, wafer_id, $2, $3, $4 from run where id = $1",
        [m.runId, m.measurement.thickness, m.measurement.target, m.measurement.specHw],
      );
      await client.query("update run set end_ms = $2, expected_frames = $3 where id = $1", [m.runId, st.lastTMs + 100, m.expectedFrames]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    this.runs.delete(m.runId);
    this.finalized.add(m.runId);
    this.toolState.set(st.toolId, { state: "idle", runIdx: st.runIdx, stepIdx: null });
  }
}
