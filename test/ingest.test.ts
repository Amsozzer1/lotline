import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FrameMsg } from "../src/domain/messages";
import { fitPhaseI, flowIndex, heaterIndex, thicknessIndex } from "../src/domain/features";
import { schedule } from "../src/domain/schedule";
import { runFamily } from "../src/domain/spc";
import { seriesAt, simulateTrajectory } from "../src/domain/trajectory";
import { createPool, resetDb } from "../src/server/db";
import { loadToolRuns, toolHealth } from "../src/server/health";
import { loadRunHistory } from "../src/server/history";
import { Ingestor } from "../src/server/ingest";
import { runId, runMessages, type ToolIdentity } from "../src/sim/runMessages";

const pool = createPool();
const N = 100;
const R = 4;
const cfg = { r: R, s: 61, leLotline: 3.4, leTrend: 4.2 };
const tools: ToolIdentity[] = [
  { displayId: "t-tc", seed: 3, simToolId: 1, scenario: "tc_drift", delta: 0.2 },
  { displayId: "t-mfc", seed: 4, simToolId: 1, scenario: "mfc_gain_drift", delta: 0.2 },
];
let dropped = 0;

beforeAll(async () => {
  await resetDb(pool);
  const ing = new Ingestor(pool);
  for (const tool of tools) {
    for (const s of schedule(tool.seed, tool.simToolId, N)) {
      let last: FrameMsg | null = null;
      for (const msg of runMessages(tool, s, R)) {
        await ing.handle(msg);
        if (msg.kind === "frame") {
          last = msg;
          if (msg.seq % 97 === 0) await ing.handle(msg); // duplicate frame right after its original
        } else {
          await ing.handle(msg); // duplicate RunStart / RunEnd right after the original
          if (msg.kind === "run_end" && last) await ing.handle(last); // late frame after RunEnd
        }
      }
    }
  }
  await ing.close();
  dropped = ing.dropped;
}, 600_000);
afterAll(() => pool.end());

const relErr = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

describe("test 4: parity and history (handler + Postgres vs the eval's fast path)", () => {
  it("dropped every injected duplicate and late message", () => {
    expect(dropped).toBeGreaterThan(2 * N * 3);
  });

  for (const tool of tools) {
    describe(tool.scenario, () => {
      it("stores features equal to the fast path (relative error <= 1e-12)", async () => {
        const rows = await loadToolRuns(pool, tool.displayId);
        const tr = simulateTrajectory(tool.seed, tool.simToolId, N, tool.scenario, tool.delta);
        const fast = seriesAt(tr, R);
        expect(rows.length).toBe(N);
        for (let i = 0; i < N; i++) {
          expect(relErr(rows[i].pDep, tr.pDep[i])).toBeLessThanOrEqual(1e-12);
          expect(relErr(rows[i].k, tr.k[i])).toBeLessThanOrEqual(1e-12);
          expect(relErr(rows[i].basePressure, tr.basePressure[i])).toBeLessThanOrEqual(1e-12);
          expect(rows[i].satDepS).toBe(tr.satDepS[i]);
          expect(relErr(rows[i].tempMeanDep, tr.tempMeanDep[i])).toBeLessThanOrEqual(1e-12);
          expect(relErr(rows[i].thickness, fast.thickness[i])).toBeLessThanOrEqual(1e-12);
        }
      });

      it("gives the same first alarms as the fast path", async () => {
        const h = toolHealth(await loadToolRuns(pool, tool.displayId), cfg);
        const fast = seriesAt(simulateTrajectory(tool.seed, tool.simToolId, N, tool.scenario, tool.delta), R);
        const m = fitPhaseI(fast);
        const lot = runFamily([heaterIndex(fast, m), flowIndex(fast, m)], [m.sigmaHeater, m.sigmaFlow], cfg.leLotline, N).alarms;
        const trend = runFamily([thicknessIndex(fast)], [m.sigmaThickness], cfg.leTrend, N).alarms;
        expect(h.firsts.flagRun).toBe(lot.find((a) => a.run >= cfg.s)?.run ?? null);
        expect(h.firsts.trendRun).toBe(trend.find((a) => a.run >= cfg.s)?.run ?? null);
        expect(h.firsts.flagRun).not.toBeNull();
      });

      it("stores exactly expected_frames frames for every run", async () => {
        const { rows } = await pool.query(
          `select r.id, r.expected_frames, count(f.run_id)::int as n, count(distinct f.seq)::int as distinct_seq
             from run r left join frame f on f.run_id = r.id where r.tool_id = $1 group by r.id, r.expected_frames`,
          [tool.displayId],
        );
        expect(rows.length).toBe(N);
        for (const r of rows) {
          expect(r.n).toBe(r.expected_frames);
          expect(r.distinct_seq).toBe(r.expected_frames);
        }
      });

      it("keeps the Phase I limits through recipe edits", async () => {
        const rows = await loadToolRuns(pool, tool.displayId);
        const edits = rows.slice(50).filter((r, i, a) => i > 0 && r.version !== a[i - 1].version).length;
        expect(edits).toBeGreaterThanOrEqual(5);
        expect(toolHealth(rows, cfg).limits).toEqual(toolHealth(rows.slice(0, 50), cfg).limits);
      });

      it("returns the full history of the last run", async () => {
        const h = await loadRunHistory(pool, runId(tool.displayId, N), cfg);
        expect(h).not.toBeNull();
        expect(h!.run.runIdx).toBe(N);
        expect(h!.recipe.steps.map((s) => s.name)).toEqual(["pumpdown", "stabilize", "deposit", "purge"]);
        expect(h!.frames.tMs.length).toBe(h!.run.expectedFrames);
        expect(h!.frames.tMs[0]).toBe(h!.run.startMs);
        expect(h!.frames.tMs[h!.frames.tMs.length - 1]).toBe(h!.run.endMs! - 100);
        expect(h!.measurement).not.toBeNull();
        expect(Array.isArray(h!.recipeChanges)).toBe(true);
        expect(h!.banner.some((l) => l.startsWith("Recipe: v"))).toBe(true);
        expect(h!.banner[h!.banner.length - 1]).toBe("Tool: config v1, unchanged since run 1");
        expect(h!.stepSummaries.length).toBe(16);
      });
    });
  }
});
