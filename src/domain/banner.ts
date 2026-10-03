import type { FamilyAlarm } from "./spc";

export interface VersionInfo {
  version: number;
  firstRun: number;
  tempC: number;
  flowSccm: number;
  depositS: number;
}

export interface BannerInput {
  runIdx: number;
  phaseIRuns: number;
  /** The lotline alarm on this run, if any. */
  alarm: FamilyAlarm | null;
  /** Chart index series (0 = heater power, 1 = pressure rise per sccm), index 0 = run 1. */
  index: ArrayLike<number>[];
  /** EWMA per chart, after update and before reset (NaN before monitoring). */
  ewma: ArrayLike<number>[];
  versionOfRun: ArrayLike<number>;
  tempOfRun: ArrayLike<number>;
  versions: Map<number, VersionInfo>;
  toolConfigVersion: number;
  toolConfigSinceRun: number;
}

const CHART_TEXT = [
  { noun: "heater power", basis: " for each run's setpoint" },
  { noun: "pressure rise per sccm", basis: "" },
];

function fmtPct(x: number): string {
  return `${Math.abs(x * 100).toFixed(1)}%`;
}

function healthLine(inp: BannerInput, alarm: FamilyAlarm): string {
  const c = alarm.charts.includes(0) ? 0 : alarm.charts[0];
  const xIdx = inp.runIdx - 1;
  const z = inp.ewma[c];
  const sign = Math.sign(z[xIdx]) || Math.sign(inp.index[c][xIdx]);
  let n = inp.runIdx;
  while (n - 1 > inp.phaseIRuns && Math.sign(z[n - 2]) === sign) n--;
  let sum = 0;
  const byVersion = new Map<number, { sum: number; count: number }>();
  let tLo = Infinity;
  let tHi = -Infinity;
  for (let run = n; run <= inp.runIdx; run++) {
    const v = inp.versionOfRun[run - 1];
    const x = inp.index[c][run - 1];
    sum += x;
    const e = byVersion.get(v) ?? { sum: 0, count: 0 };
    e.sum += x;
    e.count++;
    byVersion.set(v, e);
    tLo = Math.min(tLo, inp.tempOfRun[run - 1]);
    tHi = Math.max(tHi, inp.tempOfRun[run - 1]);
  }
  const m = sum / (inp.runIdx - n + 1);
  const word = m < 0 ? "below" : "above";
  const k = [...byVersion.values()].filter((e) => Math.sign(e.sum) === Math.sign(m)).length;
  const versions = [...byVersion.keys()];
  const vA = Math.min(...versions);
  const vB = Math.max(...versions);
  const temps = tLo === tHi ? `${tLo} °C` : `${tLo}–${tHi} °C`;
  const { noun, basis } = CHART_TEXT[c];
  const scope =
    versions.length === 1
      ? `within recipe version v${vB} (${temps})`
      : `in ${k} of ${versions.length} recipe versions (v${vA}–v${vB}, ${temps})`;
  return `Tool health: ${noun} ${fmtPct(m)} ${word} expected${basis} over runs ${n}–${inp.runIdx}, ${scope}; flagged at run ${inp.runIdx}.`;
}

function recipeLine(inp: BannerInput): string {
  const b = inp.versionOfRun[inp.runIdx - 1];
  const cur = inp.versions.get(b)!;
  const prev = inp.versions.get(b - 1);
  if (!prev) return `Recipe: v${b} (first version)`;
  const changed: string[] = [];
  const same: string[] = [];
  if (cur.tempC !== prev.tempC) changed.push(`deposit ${prev.tempC} → ${cur.tempC} °C`);
  else same.push("temperature");
  if (cur.flowSccm !== prev.flowSccm) changed.push(`flow ${prev.flowSccm} → ${cur.flowSccm} sccm`);
  else same.push("flow");
  if (cur.depositS !== prev.depositS) changed.push(`deposit time ${prev.depositS} → ${cur.depositS} s`);
  else same.push("deposit time");
  const tail = same.length > 0 ? `, ${same.join(" and ")} unchanged` : "";
  return `Recipe: v${b} (edited from v${b - 1} at run ${cur.firstRun}: ${changed.join(", ")}${tail})`;
}

/**
 * Banner on the run page. Line 1 (tool health) only on flagged, monitored runs; the recipe and
 * tool lines always show. Built from stored data only; it never names a cause.
 */
export function bannerLines(inp: BannerInput): string[] {
  const lines: string[] = [];
  if (inp.alarm && inp.runIdx > inp.phaseIRuns) lines.push(healthLine(inp, inp.alarm));
  lines.push(recipeLine(inp));
  lines.push(`Tool: config v${inp.toolConfigVersion}, unchanged since run ${inp.toolConfigSinceRun}`);
  return lines;
}
