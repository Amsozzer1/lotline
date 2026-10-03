/**
 * pnpm eval [--quick]
 *
 * Simulates every trajectory once, calibrates the detectors in memory, replays the cache for every
 * statistic, and writes results/. The full run also writes src/domain/calibration.json last (the
 * server reads it; nothing here does). --quick uses 20 eval tools and 50 calibration tools and
 * writes only to results/quick/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitPhaseI, flowIndex, heaterIndex, thicknessIndex, type RunSeries } from "../domain/features";
import { HOLD_SOURCES, isOutOfSpec, runHold, type HoldAlarm } from "../domain/hold";
import {
  DRIFT_TRAJECTORY_RUNS,
  FA_TARGET,
  HEADLINE,
  L1,
  LAMBDA,
  NONE_TRAJECTORY_RUNS,
  ONSET_RUN,
  PHASE_I_RUNS,
  SETPOINTS,
  SIGMA_ETA,
  WINDOW_RUNS,
  sigmaEps,
} from "../domain/params";
import { calibrate, countFamilyAlarms, runFamily, type FamilyAlarm } from "../domain/spc";
import { seriesAt, simulateTrajectory, type Trajectory } from "../domain/trajectory";
import type { Scenario } from "../domain/types";
import { bootstrapRateCi, fmt, fmtRuns, median, pct, quantile } from "./stats";

const quick = process.argv.includes("--quick");
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const EVAL_SEEDS = range(1, quick ? 20 : 200);
const CAL_SEEDS = range(10001, quick ? 10050 : 10500);
const OUT_DIR = quick ? join("results", "quick") : "results";
const SIM_TOOL = 1;
const SCENARIOS: Scenario[] = ["tc_drift", "mfc_gain_drift"];
const DELTAS = [0.05, 0.1, 0.2];
const R_TABLE = [2, 4, 8];
const R_FINE = range(4, 16).map((k) => k / 2); // 2, 2.5, ..., 8
const S = ONSET_RUN;
const WINDOW_END = DRIFT_TRAJECTORY_RUNS;
const MONITORED = NONE_TRAJECTORY_RUNS - PHASE_I_RUNS;
const DETECTORS = ["hold", "trend", "lotline"] as const;
type Detector = (typeof DETECTORS)[number];
const DETECTOR_LABEL: Record<Detector, string> = {
  hold: "Hold (tolerance bands, heater saturation, metrology hold)",
  trend: "Thickness trend (same SPC on measured / target)",
  lotline: "lotline (same SPC on heater power and pressure-per-flow vs expected)",
};
const AFFECTED: Record<string, number> = { tc_drift: 0, mfc_gain_drift: 1 };

const t0 = Date.now();
const log = (m: string) => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}\n`);

interface LotView {
  charts: Float64Array[];
  sig: number[];
}
function lotView(t: Trajectory): LotView {
  const s = seriesAt(t, HEADLINE.r); // heater and flow indices do not depend on r
  const m = fitPhaseI(s);
  return { charts: [heaterIndex(s, m), flowIndex(s, m)], sig: [m.sigmaHeater, m.sigmaFlow] };
}
interface ThView {
  x: Float64Array;
  sig: number;
  series: RunSeries;
}
function thView(t: Trajectory, r: number): ThView {
  const series = seriesAt(t, r);
  const x = thicknessIndex(series);
  let ss = 0;
  for (let i = 0; i < PHASE_I_RUNS; i++) ss += x[i] * x[i];
  return { x, sig: Math.sqrt(ss / PHASE_I_RUNS), series };
}
function firstAlarm<T extends { run: number }>(alarms: T[], from: number, to: number): T | null {
  for (const a of alarms) if (a.run >= from && a.run <= to) return a;
  return null;
}
function anyAlarm(alarms: { run: number }[], from: number, to: number): boolean {
  return firstAlarm(alarms, from, to) !== null;
}
function firstOos(s: RunSeries, r: number, from: number, to: number): number | null {
  for (let run = from; run <= Math.min(to, s.n); run++) {
    if (isOutOfSpec(s.thickness[run - 1], s.target[run - 1], r)) return run;
  }
  return null;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const runsWord = (x: number) => `${fmtRuns(x)} ${x === 1 ? "run" : "runs"}`;

// 1. Calibration tools (in control)
log(`simulating ${CAL_SEEDS.length} calibration tools x ${NONE_TRAJECTORY_RUNS} runs`);
const cal = CAL_SEEDS.map((seed) => simulateTrajectory(seed, SIM_TOOL, NONE_TRAJECTORY_RUNS, "none", 0));
const calLot = cal.map(lotView);
const lotRate = (le: number) =>
  sum(calLot.map((v) => countFamilyAlarms(v.charts, v.sig, le, NONE_TRAJECTORY_RUNS))) / (cal.length * MONITORED);
const leLot = calibrate(lotRate);
const lotRuleOne = lotRate(Infinity);
const leTrend = new Map<number, number>();
const trendRuleOne = new Map<number, number>();
for (const r of R_FINE) {
  const views = cal.map((t) => thView(t, r));
  const rate = (le: number) =>
    sum(views.map((v) => countFamilyAlarms([v.x], [v.sig], le, NONE_TRAJECTORY_RUNS))) / (cal.length * MONITORED);
  trendRuleOne.set(r, rate(Infinity));
  leTrend.set(r, calibrate(rate));
}
log(`calibrated: lotline L_e ${leLot.toFixed(4)}, trend L_e at r=4 ${leTrend.get(4)!.toFixed(4)}`);

// 2. Eval tools: in-control trajectories (false alarms, chance) and drift trajectories
log(`simulating ${EVAL_SEEDS.length} eval tools x ${NONE_TRAJECTORY_RUNS} runs (in control)`);
const none = EVAL_SEEDS.map((seed) => simulateTrajectory(seed, SIM_TOOL, NONE_TRAJECTORY_RUNS, "none", 0));
const noneLotView = none.map(lotView);
const noneLot = noneLotView.map((v) => runFamily(v.charts, v.sig, leLot, NONE_TRAJECTORY_RUNS).alarms);
const noneTrend = new Map<number, FamilyAlarm[][]>();
const noneHold = new Map<number, HoldAlarm[][]>();
for (const r of R_FINE) {
  noneTrend.set(r, none.map((t) => { const v = thView(t, r); return runFamily([v.x], [v.sig], leTrend.get(r)!, NONE_TRAJECTORY_RUNS).alarms; }));
  noneHold.set(r, none.map((t) => runHold(seriesAt(t, r), r)));
}
const drift = new Map<string, Trajectory[]>();
const driftLot = new Map<string, FamilyAlarm[][]>();
for (const sc of SCENARIOS) {
  for (const d of DELTAS) {
    const key = `${sc}|${d}`;
    log(`simulating ${EVAL_SEEDS.length} tools x ${DRIFT_TRAJECTORY_RUNS} runs, ${sc} at ${d} sigma/run`);
    const ts = EVAL_SEEDS.map((seed) => simulateTrajectory(seed, SIM_TOOL, DRIFT_TRAJECTORY_RUNS, sc, d));
    drift.set(key, ts);
    driftLot.set(key, ts.map((t) => { const v = lotView(t); return runFamily(v.charts, v.sig, leLot, DRIFT_TRAJECTORY_RUNS).alarms; }));
  }
}

// 3. Detection statistics per (scenario, delta, r, detector)
interface SeedResult {
  seed: number;
  first: Record<Detector, number | null>;
  lotCharts: number[] | null;
  oos: number | null;
  chance: Record<Detector, boolean>;
  preOnsetAlarm: boolean;
  oosBeforeOnset: boolean;
}
interface CellStats {
  scenario: Scenario;
  delta: number;
  r: number;
  seeds: SeedResult[];
  byDetector: Record<Detector, {
    delayMedian: number; delayP90: number; detectedPct: number;
    leadMedian: number; leadP10: number; leadP90: number; leadPosPct: number; leadExcluded: number;
    chancePct: number; affectedPct: number;
  }>;
}

function cellStats(sc: Scenario, d: number, r: number): CellStats {
  const key = `${sc}|${d}`;
  const ts = drift.get(key)!;
  const lots = driftLot.get(key)!;
  const seeds: SeedResult[] = ts.map((t, j) => {
    const tv = thView(t, r);
    const trendAlarms = runFamily([tv.x], [tv.sig], leTrend.get(r)!, DRIFT_TRAJECTORY_RUNS).alarms;
    const holdAlarms = runHold(tv.series, r);
    const oos = firstOos(tv.series, r, S, WINDOW_END);
    const all = { hold: holdAlarms, trend: trendAlarms, lotline: lots[j] };
    const chanceEnd = oos === null ? WINDOW_END : oos - 1;
    const noneAlarms = { hold: noneHold.get(r)![j], trend: noneTrend.get(r)![j], lotline: noneLot[j] };
    const lotFirst = firstAlarm(lots[j], S, WINDOW_END);
    return {
      seed: EVAL_SEEDS[j],
      first: {
        hold: firstAlarm(holdAlarms, S, WINDOW_END)?.run ?? null,
        trend: firstAlarm(trendAlarms, S, WINDOW_END)?.run ?? null,
        lotline: lotFirst?.run ?? null,
      },
      lotCharts: lotFirst?.charts ?? null,
      oos,
      chance: {
        hold: anyAlarm(noneAlarms.hold, S, chanceEnd),
        trend: anyAlarm(noneAlarms.trend, S, chanceEnd),
        lotline: anyAlarm(noneAlarms.lotline, S, chanceEnd),
      },
      preOnsetAlarm: DETECTORS.some((det) => anyAlarm(all[det], PHASE_I_RUNS + 1, S - 1)),
      oosBeforeOnset: firstOos(tv.series, r, 1, S - 1) !== null,
    };
  });
  const byDetector = {} as CellStats["byDetector"];
  for (const det of DETECTORS) {
    const delays = seeds.map((x) => (x.first[det] === null ? Infinity : x.first[det]! - S + 1));
    const leads: number[] = [];
    let excluded = 0;
    for (const x of seeds) {
      const a = x.first[det];
      if (a !== null && x.oos !== null) leads.push(x.oos - a);
      else if (a !== null) leads.push(Infinity);
      else if (x.oos !== null) leads.push(-Infinity);
      else excluded++;
    }
    const detected = seeds.filter((x) => x.first[det] !== null).length;
    const affected = seeds.filter((x) => det === "lotline" && x.lotCharts?.includes(AFFECTED[sc])).length;
    byDetector[det] = {
      delayMedian: median(delays),
      delayP90: quantile(delays, 0.9),
      detectedPct: pct(detected, seeds.length),
      leadMedian: median(leads),
      leadP10: quantile(leads, 0.1),
      leadP90: quantile(leads, 0.9),
      leadPosPct: pct(leads.filter((l) => l > 0).length, leads.length),
      leadExcluded: excluded,
      chancePct: pct(seeds.filter((x) => x.chance[det]).length, seeds.length),
      affectedPct: det === "lotline" ? pct(affected, detected) : NaN,
    };
  }
  return { scenario: sc, delta: d, r, seeds, byDetector };
}

log("computing detection statistics");
const cells: CellStats[] = [];
for (const sc of SCENARIOS) for (const d of DELTAS) for (const r of R_FINE) cells.push(cellStats(sc, d, r));
const cell = (sc: string, d: number, r: number) => cells.find((c) => c.scenario === sc && c.delta === d && c.r === r)!;

// 4. False alarms (out of sample: eval tools, in control, runs 51-1050)
interface FaRow { r: number; detector: string; source: string; alarms: number[]; }
const faRows: FaRow[] = [];
for (const r of R_TABLE) {
  faRows.push({ r, detector: "lotline", source: "any", alarms: noneLot.map((a) => a.length) });
  faRows.push({ r, detector: "trend", source: "any", alarms: noneTrend.get(r)!.map((a) => a.length) });
  faRows.push({ r, detector: "hold", source: "any", alarms: noneHold.get(r)!.map((a) => a.length) });
  for (const src of HOLD_SOURCES) {
    faRows.push({ r, detector: "hold", source: src, alarms: noneHold.get(r)!.map((a) => a.filter((x) => x.sources.includes(src)).length) });
  }
}
const runsPerTool = EVAL_SEEDS.map(() => MONITORED);
const faStats = faRows.map((f) => {
  const rate = sum(f.alarms) / sum(runsPerTool);
  const ci = bootstrapRateCi(f.alarms, runsPerTool);
  return { ...f, total: sum(f.alarms), rate, ci };
});
const fa = (r: number, det: string, src = "any") => faStats.find((x) => x.r === r && x.detector === det && x.source === src)!;

// 5. Break-even r per (scenario, delta): smallest grid r from which lotline's median lead is
//    strictly greater than the trend's at that r and every larger grid r.
interface BreakEven { scenario: Scenario; delta: number; rStar: number | null; all: boolean; none: boolean }
const breakEven: BreakEven[] = [];
for (const sc of SCENARIOS) {
  for (const d of DELTAS) {
    const wins = R_FINE.map((r) => cell(sc, d, r).byDetector.lotline.leadMedian > cell(sc, d, r).byDetector.trend.leadMedian);
    let rStar: number | null = null;
    for (let i = R_FINE.length - 1; i >= 0 && wins[i]; i--) rStar = R_FINE[i];
    breakEven.push({ scenario: sc, delta: d, rStar, all: rStar === R_FINE[0], none: rStar === null });
  }
}

// 6. Per-tool range of the per-setpoint heater_index offsets (in control, runs 51-1050)
const offsetRanges = noneLotView.map((v) => {
  const by = new Map<number, number[]>();
  const t = none[noneLotView.indexOf(v)];
  for (let i = PHASE_I_RUNS; i < NONE_TRAJECTORY_RUNS; i++) {
    const arr = by.get(t.tempC[i]) ?? [];
    arr.push(v.charts[0][i]);
    by.set(t.tempC[i], arr);
  }
  const means = SETPOINTS.filter((sp) => by.has(sp)).map((sp) => sum(by.get(sp)!) / by.get(sp)!.length);
  return (Math.max(...means) - Math.min(...means)) / v.sig[0];
});

// 7. Headline A and B, and the demo pick
const head = cell(HEADLINE.scenario, HEADLINE.delta, HEADLINE.r);
const ab = head.seeds
  .filter((x) => x.first.lotline !== null)
  .map((x) => ({
    seed: x.seed,
    a: x.first.trend === null ? Infinity : x.first.trend - x.first.lotline!,
    b: x.oos === null ? Infinity : x.oos - x.first.lotline!,
  }));
const medA = median(ab.map((x) => x.a));
const medB = median(ab.map((x) => x.b));
const pctA = pct(ab.filter((x) => x.a > 0).length, ab.length);
const pctA0 = pct(ab.filter((x) => x.a === 0).length, ab.length);
const candidates = head.seeds.filter(
  (x) =>
    !x.preOnsetAlarm &&
    !x.oosBeforeOnset &&
    x.lotCharts !== null &&
    x.lotCharts.includes(0) &&
    x.first.lotline !== null &&
    x.first.trend !== null &&
    x.oos !== null,
);
const excludedByFilter = head.seeds.length - candidates.length;
const scored = candidates.map((x) => ({
  x,
  score: Math.abs(x.first.trend! - x.first.lotline! - medA) + Math.abs(x.oos! - x.first.lotline! - medB),
}));
scored.sort((p, q) => p.score - q.score || p.x.seed - q.x.seed);
const pick = scored[0].x;
const nRuns = Math.max(120, Math.max(pick.first.lotline!, pick.first.trend!, pick.oos!) + 10);
const headIdx = EVAL_SEEDS.indexOf(pick.seed);
let healthySeedIdx = -1;
for (let j = 0; j < EVAL_SEEDS.length; j++) {
  if (j === headIdx) continue;
  if (!anyAlarm(noneLot[j], PHASE_I_RUNS + 1, nRuns)) {
    healthySeedIdx = j;
    break;
  }
}
const healthyTv = thView(none[healthySeedIdx], HEADLINE.r);
const demo = {
  delta: HEADLINE.delta,
  r: HEADLINE.r,
  s: S,
  nRuns,
  tools: [
    {
      displayId: "dep-1",
      seed: pick.seed,
      simToolId: SIM_TOOL,
      scenario: HEADLINE.scenario,
      flagRun: pick.first.lotline,
      trendRun: pick.first.trend,
      firstOosRun: pick.oos,
    },
    {
      displayId: "dep-2",
      seed: EVAL_SEEDS[healthySeedIdx],
      simToolId: SIM_TOOL,
      scenario: "none",
      flagRun: null,
      trendRun: firstAlarm(noneTrend.get(HEADLINE.r)![healthySeedIdx], S, nRuns)?.run ?? null,
      firstOosRun: firstOos(healthyTv.series, HEADLINE.r, S, nRuns),
    },
  ],
};

// 8. Generated README lines
const be = breakEven.find((b) => b.scenario === HEADLINE.scenario && b.delta === HEADLINE.delta)!;
const headLot = head.byDetector.lotline;
const P = fmt(headLot.affectedPct, 0);
const sigmaPct = (r: number) => (sigmaEps(r) * 100).toFixed(2);
let honesty = `lotline's first flag was on the chart of the subsystem that moved in ${P}% of drifts. In this sim (heater power repeats to ${(SIGMA_ETA * 100).toFixed(1)}%, 1σ; a new recipe's rate is predicted to within the same σ as run-to-run thickness): `;
if (be.all) honesty += `lotline led at every r tested, down to ${sigmaPct(R_FINE[0])}% run-to-run thickness σ.`;
else if (be.none) honesty += `the thickness trend led or tied at every r tested, up to ${sigmaPct(R_FINE[R_FINE.length - 1])}% run-to-run thickness σ; chart thickness instead.`;
else honesty += `if run-to-run thickness σ is below ${sigmaPct(be.rStar!)}%, chart thickness instead; from ${sigmaPct(be.rStar!)}% up, lotline leads.`;
const attribution = `Attribution: first flag on the moving subsystem's chart in ${P}% of drifts.`;
let limitsLine: string;
if (medA > 0) limitsLine = `At r = ${HEADLINE.r}, lotline flagged a median ${runsWord(medA)} before the thickness trend (earlier in ${fmt(pctA, 0)}% of drifts, same run in ${fmt(pctA0, 0)}%). ${attribution}`;
else if (medA === 0) limitsLine = `At r = ${HEADLINE.r}, lotline and the thickness trend flagged on the same run (median). ${attribution}`;
else limitsLine = `At r = ${HEADLINE.r}, the thickness trend alarmed a median ${runsWord(-medA)} before lotline. ${attribution}`;
const headlineRuleA = medA >= 5;

// 9. Write outputs
mkdirSync(OUT_DIR, { recursive: true });
const detLines = [
  "scenario,delta,r,detector,seeds,delay_median,delay_p90,detected_pct,lead_median,lead_p10,lead_p90,lead_pos_pct,lead_excluded,chance_pct,affected_pct",
];
for (const c of cells) {
  for (const det of DETECTORS) {
    const b = c.byDetector[det];
    detLines.push(
      [c.scenario, c.delta, c.r, det, c.seeds.length, fmtRuns(b.delayMedian), fmtRuns(b.delayP90), fmt(b.detectedPct), fmtRuns(b.leadMedian),
        fmtRuns(b.leadP10), fmtRuns(b.leadP90), fmt(b.leadPosPct), b.leadExcluded, fmt(b.chancePct), fmt(b.affectedPct)].join(","),
    );
  }
}
writeFileSync(join(OUT_DIR, "detection.csv"), detLines.join("\n") + "\n");
const faLines = ["r,detector,source,alarms,monitored_runs,rate_per_1000,ci95_lo_per_1000,ci95_hi_per_1000"];
for (const f of faStats) {
  faLines.push([f.r, f.detector, f.source, f.total, sum(runsPerTool), (f.rate * 1000).toFixed(3), (f.ci[0] * 1000).toFixed(3), (f.ci[1] * 1000).toFixed(3)].join(","));
}
writeFileSync(join(OUT_DIR, "false_alarms.csv"), faLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "demo.json"), JSON.stringify(demo, null, 2) + "\n");

const faCell = (det: Detector, r: number) => {
  const f = fa(r, det);
  return `${(f.rate * 1000).toFixed(2)} [${(f.ci[0] * 1000).toFixed(2)}, ${(f.ci[1] * 1000).toFixed(2)}]`;
};
const md: string[] = [];
md.push(`# Results summary`, "");
md.push(`Generated by \`pnpm eval${quick ? " --quick" : ""}\`. Everything is simulated. ${EVAL_SEEDS.length} eval tools (seeds ${EVAL_SEEDS[0]}-${EVAL_SEEDS[EVAL_SEEDS.length - 1]}), ${CAL_SEEDS.length} separate calibration tools (seeds ${CAL_SEEDS[0]}-${CAL_SEEDS[CAL_SEEDS.length - 1]}). Phase I is runs 1-${PHASE_I_RUNS}, drift starts at run ${S}, the window is runs ${S}-${WINDOW_END}. False alarms are counted on ${NONE_TRAJECTORY_RUNS}-run in-control trajectories (runs ${PHASE_I_RUNS + 1}-${NONE_TRAJECTORY_RUNS}).`, "");
md.push(`## Headline: ${HEADLINE.scenario}, δ = ${HEADLINE.delta} σ/run, r = ${HEADLINE.r}`, "");
md.push("| Detector | Median lead before the first out-of-spec wafer (runs) | Drifts flagged before the first out-of-spec wafer (chance) | False alarms per 1,000 in-control runs (95% CI) |");
md.push("|---|---|---|---|");
for (const det of DETECTORS) {
  const b = head.byDetector[det];
  md.push(`| ${DETECTOR_LABEL[det]} | ${fmtRuns(b.leadMedian)} | ${fmt(b.leadPosPct, 0)}% (${fmt(b.chancePct, 0)}%) | ${faCell(det, HEADLINE.r)} |`);
}
md.push("");
md.push(`## Full table`, "");
md.push("Median delay from drift onset to first alarm (p90), and % of drifts flagged before the first out-of-spec wafer.", "");
md.push("| Scenario | δ (σ/run) | r | Hold | Thickness trend | lotline | lotline first flag on the affected chart |");
md.push("|---|---|---|---|---|---|---|");
for (const sc of SCENARIOS) {
  for (const d of DELTAS) {
    for (const r of R_TABLE) {
      const c = cell(sc, d, r);
      const f = (det: Detector) => `${fmtRuns(c.byDetector[det].delayMedian)} (${fmtRuns(c.byDetector[det].delayP90)}), ${fmt(c.byDetector[det].leadPosPct, 0)}%`;
      md.push(`| ${sc} | ${d} | ${r} | ${f("hold")} | ${f("trend")} | ${f("lotline")} | ${fmt(c.byDetector.lotline.affectedPct, 0)}% |`);
    }
  }
}
md.push("");
md.push("## Calibration", "");
md.push(`Target ${FA_TARGET * 1000} false alarms per 1,000 runs per tool. Alarm = rule 1 at ${L1} σ̂ or EWMA (λ = ${LAMBDA}) beyond L_e σ̂ √(λ/(2−λ)).`, "");
md.push(`- lotline: L_e = ${leLot.toFixed(4)}; rule 1 alone gives ${(lotRuleOne * 1000).toFixed(2)} per 1,000 on the calibration tools.`);
md.push(`- Thickness trend at r = ${HEADLINE.r}: L_e = ${leTrend.get(HEADLINE.r)!.toFixed(4)}; rule 1 alone gives ${(trendRuleOne.get(HEADLINE.r)! * 1000).toFixed(2)} per 1,000.`);
md.push(`- Out-of-sample false alarms at r = ${HEADLINE.r} (eval tools): lotline ${faCell("lotline", HEADLINE.r)}, thickness trend ${faCell("trend", HEADLINE.r)}, hold ${faCell("hold", HEADLINE.r)}.`);
md.push("- Hold false alarms by source, per 1,000 runs: " + R_TABLE.map((r) => `r = ${r}: ` + HOLD_SOURCES.map((s) => `${s} ${(fa(r, "hold", s).rate * 1000).toFixed(2)}`).join(", ")).join("; ") + ".");
md.push("");
md.push("## Break-even r", "");
md.push(`Smallest r (grid 2, 2.5, ..., 8) from which lotline's median lead before the first out-of-spec wafer is strictly greater than the thickness trend's, at that r and every larger one. Run-to-run thickness σ = r × ${(sigmaEps(1) * 100).toFixed(4)}%.`, "");
md.push("| Scenario | δ (σ/run) | r* | Run-to-run thickness σ at r* |");
md.push("|---|---|---|---|");
for (const b of breakEven) {
  const txt = b.none ? "trend leads or ties at every r" : b.all ? "lotline leads at every r" : String(b.rStar);
  md.push(`| ${b.scenario} | ${b.delta} | ${txt} | ${b.rStar === null ? "n/a" : sigmaPct(b.rStar) + "%"} |`);
}
md.push("");
md.push("## Other checks", "");
md.push(`- Per-tool range of the per-setpoint heater_index means (in control), in units of that tool's σ̂: median ${median(offsetRanges).toFixed(2)}, p90 ${quantile(offsetRanges, 0.9).toFixed(2)}.`);
md.push(`- Headline cell, lotline vs thickness trend: A = trend alarm − lotline flag. Median A ${fmtRuns(medA)}, A > 0 in ${fmt(pctA, 0)}% of drifts, A = 0 in ${fmt(pctA0, 0)}%. B = first out-of-spec wafer − lotline flag, median ${fmtRuns(medB)}.`);
md.push(`- Demo seed ${pick.seed}: flag at run ${pick.first.lotline}, thickness trend at ${pick.first.trend}, first out-of-spec wafer at ${pick.oos} (A = ${pick.first.trend! - pick.first.lotline!}, B = ${pick.oos! - pick.first.lotline!}). ${excludedByFilter} of ${head.seeds.length} seeds were excluded by the demo filter (an alarm in runs ${PHASE_I_RUNS + 1}-${S - 1}, an out-of-spec wafer before run ${S}, a first flag not on heater power, or an event outside the window). Healthy tool: seed ${EVAL_SEEDS[healthySeedIdx]}, the lowest seed with no lotline alarm in runs ${PHASE_I_RUNS + 1}-${nRuns}.`);
md.push("");
md.push("## Generated README lines", "");
md.push(`- Honesty line: ${honesty}`);
md.push(`- Limits line: ${limitsLine}`);
md.push(`- Headline rule: median A ${headlineRuleA ? "≥ 5, so the lead over the thickness trend may be a headline" : "< 5, so the lead over the thickness trend is not a headline"}.`);
md.push("");
writeFileSync(join(OUT_DIR, "summary.md"), md.join("\n"));

if (!quick) {
  const byR: Record<string, { lotline: number; trend: number }> = {};
  for (const r of R_FINE) byR[String(r)] = { lotline: leLot, trend: leTrend.get(r)! };
  const calibration = {
    note: "Written by pnpm eval (full run). The server reads byR[demo.r]; the eval never reads this file.",
    faTarget: FA_TARGET,
    l1: L1,
    lambda: LAMBDA,
    calibrationSeeds: [CAL_SEEDS[0], CAL_SEEDS[CAL_SEEDS.length - 1]],
    evalSeeds: [EVAL_SEEDS[0], EVAL_SEEDS[EVAL_SEEDS.length - 1]],
    byR,
    outOfSample: Object.fromEntries(
      R_TABLE.map((r) => [String(r), Object.fromEntries(DETECTORS.map((det) => [det, { perThousand: fa(r, det).rate * 1000, ci95: fa(r, det).ci.map((x) => x * 1000) }]))]),
    ),
  };
  writeFileSync(join("src", "domain", "calibration.json"), JSON.stringify(calibration, null, 2) + "\n");
}
log(`done: wrote ${OUT_DIR}${quick ? "" : " and src/domain/calibration.json"}`);
