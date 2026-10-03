import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { tempBound } from "../../src/domain/label";
import { fetchRun, getJson, type Health } from "./api";
import { Chips } from "./Chips";
import { navigate } from "./router";

// One fixed-width column; every chart shares the same margins, Y-axis width and numeric run axis.
export const WIDTH = 960;
export const MARGIN = { top: 14, right: 28, bottom: 2, left: 4 };
export const Y_W = 56;
const PLOT_LEFT = MARGIN.left + Y_W;
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right - Y_W;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : x * 100);

const xPx = (axisValue: number, n: number) => PLOT_LEFT + ((axisValue - 0.5) / n) * PLOT_W;

/** A single labelled marker (circle or diamond) with a surface-coloured halo behind the text. */
function marker(kind: "circle" | "diamond", fill: string, text: string, below: boolean, testId?: string) {
  return function Shape(p: { cx?: number; cy?: number; payload?: Record<string, unknown>; dataKey?: string }) {
    if (p.cx === undefined || p.cy === undefined || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) return <g />;
    const cx = p.cx;
    const cy = p.cy;
    const ty = below ? cy + 24 : cy - 16;
    return (
      <g data-testid={testId} style={{ cursor: "pointer" }}>
        {kind === "circle" ? (
          <circle cx={cx} cy={cy} r={7} fill={fill} stroke="var(--surface-1)" strokeWidth={2} />
        ) : (
          <path d={`M ${cx} ${cy - 9} L ${cx + 9} ${cy} L ${cx} ${cy + 9} L ${cx - 9} ${cy} Z`} fill={fill} stroke="var(--surface-1)" strokeWidth={2} />
        )}
        <text x={cx} y={ty} textAnchor="middle" fontSize={12} fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth={4} paintOrder="stroke" style={{ fontWeight: 600 }}>
          {text}
        </text>
      </g>
    );
  };
}

function dot(r: number, fill: string, ring = false) {
  return function Dot(p: { cx?: number; cy?: number }) {
    if (p.cx === undefined || p.cy === undefined || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) return <g />;
    return <circle cx={p.cx} cy={p.cy} r={r} fill={fill} stroke={ring ? "var(--surface-1)" : undefined} strokeWidth={ring ? 1.5 : undefined} />;
  };
}

function niceTicks(max: number): number[] {
  const steps = [0.5, 1, 2, 2.5, 5, 10, 20];
  const step = steps.find((s) => max / s <= 3) ?? 20;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = -top; v <= top + 1e-9; v += step) out.push(Number(v.toFixed(2)));
  return out;
}

interface Row {
  run: number;
  runId: string;
  version: number;
  tempC: number;
  flowSccm: number;
  thk: number | null;
  idx: number | null;
  ewma: number | null;
  /** Marker series: a value only on the run they mark, null elsewhere (one row per run keeps tooltips aligned). */
  thkOos: number | null;
  trendMark: number | null;
  oosMark: number | null;
  flagMark: number | null;
}

function RunTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="tooltip">
      <div>
        <b>Run {r.run}</b> · v{r.version} · {r.tempC} °C · {r.flowSccm} sccm
      </div>
      {r.thk !== null && <div>thickness vs target {r.thk.toFixed(2)}%</div>}
      {r.idx !== null && <div>tool health {r.idx.toFixed(2)}%</div>}
    </div>
  );
}

const xAxis = (n: number, hide: boolean, ticks: number[]) => (
  <XAxis
    type="number"
    dataKey="run"
    domain={[0.5, n + 0.5]}
    allowDataOverflow
    ticks={ticks}
    hide={hide}
    tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
    stroke="var(--rule)"
  />
);

export function ToolPage({ id }: { id: string }) {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<Health>(`/api/tools/${id}/health`).then(setH, (e) => setErr(String(e)));
  }, [id]);

  const view = useMemo(() => {
    if (!h) return null;
    const n = h.n;
    const flowChart = !!h.firsts.flagCharts && !h.firsts.flagCharts.includes(0) && h.firsts.flagCharts.includes(1);
    const key = flowChart ? "flow" : "heater";
    const rows: Row[] = h.rows.map((r, i) => ({
      run: r.runIdx,
      runId: r.runId,
      version: r.version,
      tempC: r.tempC,
      flowSccm: r.flowSccm,
      thk: pct(h.index ? h.index.thickness[i] : r.thickness / r.target - 1),
      idx: pct(h.index?.[key][i]),
      ewma: pct(h.ewma?.[key][i]),
      thkOos: null,
      trendMark: null,
      oosMark: null,
      flagMark: null,
    }));
    for (const r of rows) if (h.oosRuns.includes(r.run)) r.thkOos = r.thk;
    if (h.firsts.trendRun) rows[h.firsts.trendRun - 1].trendMark = rows[h.firsts.trendRun - 1].thk;
    if (h.firsts.firstOosRun) rows[h.firsts.firstOosRun - 1].oosMark = rows[h.firsts.firstOosRun - 1].thk;
    if (h.firsts.flagRun) rows[h.firsts.flagRun - 1].flagMark = rows[h.firsts.flagRun - 1].idx;
    const ticks: number[] = [];
    for (let t = 10; t <= n; t += 10) ticks.push(t);
    const spec = h.rows[0].specHw * 100;
    const thkMax = Math.max(spec, ...rows.map((r) => Math.abs(r.thk ?? 0))) * 1.1;
    const lim = h.limits ? h.limits[key].ewma * 100 : 0;
    const idxMax = Math.max(lim, ...rows.map((r) => Math.abs(r.idx ?? 0))) * 1.1;
    const flag = h.firsts.flagRun;
    const flagRow = flag ? rows[flag - 1] : null;
    // One strip label: the edit at or just before the flag.
    let stripLabel: { x: number; text: string } | null = null;
    if (flag) {
      const vi = h.versions.findLastIndex((v) => v.firstRun <= flag);
      const cur = h.versions[vi];
      const prev = h.versions[vi - 1];
      if (cur && prev) {
        const text =
          cur.tempC !== prev.tempC
            ? `v${cur.version}: ${prev.tempC}→${cur.tempC} °C`
            : cur.flowSccm !== prev.flowSccm
              ? `v${cur.version}: ${prev.flowSccm}→${cur.flowSccm} sccm`
              : `v${cur.version}: ${prev.depositS}→${cur.depositS} s`;
        stripLabel = { x: PLOT_LEFT + ((cur.firstRun - 1) / n) * PLOT_W, text };
      }
    }
    return { n, key, rows, ticks, spec, thkTicks: niceTicks(thkMax), idxTicks: niceTicks(idxMax), lim, flag, flagRow, stripLabel };
  }, [h]);

  // Prefetch the flagged run so the click opens its page without a loading state.
  useEffect(() => {
    if (view?.flagRow) fetchRun(view.flagRow.runId).catch(() => undefined);
  }, [view]);

  if (err) return <p className="muted">{err}</p>;
  if (!h || !view) return <p className="muted">Loading…</p>;
  const { n, rows, ticks, spec, thkTicks, idxTicks, lim, flag, flagRow, stripLabel } = view;
  const trendRow = h.firsts.trendRun ? rows[h.firsts.trendRun - 1] : null;
  const oosRow = h.firsts.firstOosRun ? rows[h.firsts.firstOosRun - 1] : null;
  const open = (p: { payload?: Row } | Row) => {
    const row = "payload" in p && p.payload ? p.payload : (p as Row);
    if (row?.runId) navigate(`/runs/${row.runId}`);
  };
  const phaseI = <ReferenceArea x1={0.5} x2={h.phaseIRuns + 0.5} fill="var(--phase-i)" fillOpacity={1} ifOverflow="hidden" />;
  const drift = h.simulatedDriftStart;
  const onset = drift ? <ReferenceLine x={drift - 0.5} stroke="var(--text-secondary)" strokeDasharray="4 3" /> : null;
  const chartTitle = view.key === "heater" ? "Heater power vs expected for its setpoint (%)" : "Pressure rise per sccm vs expected (%)";

  return (
    <>
      <Chips active={id} />
      <div className="card">
        <h1>
          {id.toUpperCase()} <span className="muted">· {n} runs · {h.versions.length} recipe versions</span>
        </h1>
        <p className="question">Was it the recipe or the tool?</p>

        <div className="strip-wrap" style={{ width: WIDTH }} data-testid="strip">
          {stripLabel && (
            <span className="strip-label" style={{ left: stripLabel.x }}>
              {stripLabel.text}
            </span>
          )}
          {h.versions.map((v, i) => (
            <div
              key={v.version}
              title={`v${v.version}: ${v.tempC} °C, ${v.flowSccm} sccm, ${v.depositS} s (runs ${v.firstRun}-${v.lastRun})`}
              style={{
                position: "absolute",
                top: 18,
                height: 12,
                left: xPx(v.firstRun - 0.5, n),
                width: ((v.lastRun - v.firstRun + 1) / n) * PLOT_W,
                background: i % 2 ? "var(--band-b)" : "var(--band-a)",
                borderRight: "1px solid var(--surface-1)",
              }}
            />
          ))}
          {flag && <div className="strip-tick" data-testid="strip-flag" style={{ left: xPx(flag, n), top: 14, height: 20 }} />}
        </div>

        <div className="chart-title">
          <h2>What you'd see today: measured thickness vs target (%)</h2>
          <div className="legend">
            <span><span className="swatch dot" style={{ background: "var(--text-muted)" }} />per wafer</span>
            <span><span className="swatch dot" style={{ background: "var(--critical)" }} />out of spec</span>
            <span><span className="swatch dot" style={{ background: "var(--series-2)" }} />thickness trend alarm</span>
          </div>
        </div>
        <p className="generated">
          Tool alarms (tolerance, saturation): {h.toolAlarmCount} · heater_temp deposit mean within {tempBound(h.maxTempDev)} °C of setpoint on all {n} runs
        </p>
        <ComposedChart width={WIDTH} height={190} data={rows} margin={MARGIN} syncId="runs" syncMethod="value">
          {xAxis(n, true, ticks)}
          <YAxis width={Y_W} domain={[thkTicks[0], thkTicks[thkTicks.length - 1]]} ticks={thkTicks} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} stroke="var(--rule)" />
          {phaseI}
          <ReferenceArea y1={-spec} y2={spec} fill="var(--spec-band)" fillOpacity={0.9} />
          <ReferenceLine y={spec} stroke="var(--text-muted)" strokeWidth={1} label={{ value: "spec", position: "insideTopRight", fontSize: 11, fill: "var(--text-muted)" }} />
          <ReferenceLine y={-spec} stroke="var(--text-muted)" strokeWidth={1} />
          {onset}
          <Tooltip content={<RunTooltip />} cursor={{ stroke: "var(--rule)" }} position={{ x: PLOT_LEFT + 8, y: 2 }} isAnimationActive={false} />
          {flag && <ReferenceLine x={flag} stroke="var(--series-1-dark)" strokeOpacity={0.35} />}
          <Scatter dataKey="thk" isAnimationActive={false} shape={dot(3, "var(--text-muted)")} onClick={open} />
          <Scatter dataKey="thkOos" isAnimationActive={false} shape={dot(4, "var(--critical)", true)} onClick={open} />
          <Scatter dataKey="trendMark" isAnimationActive={false} onClick={open} shape={marker("circle", "var(--series-2)", `thickness trend alarm · run ${trendRow?.run}`, false, "trend-marker")} />
          <Scatter dataKey="oosMark" isAnimationActive={false} onClick={open} shape={marker("circle", "var(--critical)", `first out-of-spec wafer · run ${oosRow?.run}`, (oosRow?.thk ?? 0) < 0, "oos-marker")} />
        </ComposedChart>

        <div className="chart-title">
          <h2>lotline: {chartTitle}</h2>
          <div className="legend">
            <span><span className="swatch dot" style={{ background: "var(--series-1-faint)" }} />per run</span>
            <span><span className="swatch" style={{ borderColor: "var(--series-1)" }} />EWMA</span>
            <span><span className="swatch dashed" style={{ borderColor: "var(--text-secondary)" }} />EWMA limit</span>
            <span className="muted">alarm = EWMA past its limit or |x| &gt; 4σ̂</span>
          </div>
        </div>
        {h.phaseIComplete ? (
          <ComposedChart width={WIDTH} height={220} data={rows} margin={{ ...MARGIN, bottom: 18 }} syncId="runs" syncMethod="value">
            {xAxis(n, false, ticks)}
            <YAxis width={Y_W} domain={[idxTicks[0], idxTicks[idxTicks.length - 1]]} ticks={idxTicks} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} stroke="var(--rule)" />
            {phaseI}
            {h.label.shading && <ReferenceArea x1={h.label.shading[0]} x2={h.label.shading[1]} fill="var(--shade)" fillOpacity={0.55} />}
            <ReferenceLine y={0} stroke="var(--rule)" />
            <ReferenceLine segment={[{ x: h.phaseIRuns + 0.5, y: lim }, { x: n + 0.5, y: lim }]} stroke="var(--text-secondary)" strokeDasharray="5 4" />
            <ReferenceLine segment={[{ x: h.phaseIRuns + 0.5, y: -lim }, { x: n + 0.5, y: -lim }]} stroke="var(--text-secondary)" strokeDasharray="5 4" />
            {onset}
            <Tooltip content={<RunTooltip />} cursor={{ stroke: "var(--rule)" }} position={{ x: PLOT_LEFT + 8, y: 2 }} isAnimationActive={false} />
            <Scatter dataKey="idx" isAnimationActive={false} shape={dot(3, "var(--series-1-faint)")} onClick={open} />
            <Line dataKey="ewma" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            {flag && <ReferenceLine x={flag} stroke="var(--series-1-dark)" strokeOpacity={0.35} />}
            <Scatter dataKey="flagMark" isAnimationActive={false} onClick={open} shape={marker("diamond", "var(--series-1-dark)", `lotline flag · run ${flag}`, false, "lotline-flag")} />
          </ComposedChart>
        ) : (
          <p className="muted">Phase I: {n} of {h.phaseIRuns} runs. Limits are set once Phase I is complete.</p>
        )}
        <p className="label-line" data-testid="generated-label">{h.phaseIComplete ? h.label.text : ""}</p>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Simulated tool. Runs 1–{h.phaseIRuns} are Phase I (no monitoring).{drift ? ` The dashed line marks run ${drift}, where the simulated drift starts.` : ""} Click any point to open its run.
        </p>
      </div>
    </>
  );
}
