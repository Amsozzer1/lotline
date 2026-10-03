import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { getJson, type RunHistory } from "./api";
import { Chips } from "./Chips";
import { Link } from "./router";
import { MARGIN, WIDTH, Y_W } from "./ToolPage";

const STEP_NAMES = ["pumpdown", "stabilize", "deposit", "purge"];

function Trace({ data, dataKey, title, unit, steps }: { data: { t: number }[]; dataKey: string; title: string; unit: string; steps: { t: number; name: string }[] }) {
  return (
    <>
      <h2 style={{ marginTop: 10 }}>{title}</h2>
      <ComposedChart width={WIDTH} height={170} data={data} margin={{ ...MARGIN, bottom: 18 }} syncId="trace">
        <XAxis type="number" dataKey="t" domain={[0, "dataMax"]} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} stroke="var(--rule)" tickFormatter={(v) => `${v} s`} />
        <YAxis width={Y_W} domain={["auto", "auto"]} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} stroke="var(--rule)" tickFormatter={(v) => `${Math.round(v)}`} />
        {steps.map((s) => (
          <ReferenceLine key={s.name} x={s.t} stroke="var(--rule)" label={{ value: s.name, position: "insideTopLeft", fontSize: 11, fill: "var(--text-muted)" }} />
        ))}
        <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} ${unit}`, title]} labelFormatter={(t) => `${t} s`} />
        <Line dataKey={dataKey} stroke="var(--series-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </>
  );
}

export function RunPage({ id }: { id: string }) {
  const [h, setH] = useState<RunHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<RunHistory>(`/api/runs/${id}`).then(setH, (e) => setErr(String(e)));
  }, [id]);
  const traces = useMemo(() => {
    if (!h) return null;
    const t0 = h.run.startMs;
    const f = h.frames;
    const data = f.tMs.map((t, i) => ({ t: Math.round((t - t0) / 100) / 10, temp: f.heaterTemp[i], power: f.heaterPower[i] }));
    const steps: { t: number; name: string }[] = [];
    f.stepIdx.forEach((s, i) => {
      if (i === 0 || f.stepIdx[i - 1] !== s) steps.push({ t: Math.round((f.tMs[i] - t0) / 100) / 10, name: STEP_NAMES[s] });
    });
    return { data, steps };
  }, [h]);

  if (err) return <p className="muted">{err}</p>;
  if (!h || !traces) return <p className="muted">Loading…</p>;
  const dep = h.recipe.steps[2];
  const m = h.measurement;
  const [health, ...rest] = h.banner[0]?.startsWith("Tool health") ? h.banner : [null, ...h.banner];
  return (
    <>
      <Chips active={h.tool.id} />
      <div className="card">
        <Link to={`/tools/${h.tool.id}`}>← {h.tool.displayName}</Link>
        <h1 style={{ marginTop: 6 }}>
          Run {h.run.runIdx} <span className="muted">· {h.tool.displayName}</span>
        </h1>
      </div>
      <div className="card banner" data-testid="banner">
        {health && <p className="health">{health}</p>}
        {rest.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <div className="card">
        <dl className="meta">
          <dt>Wafer</dt>
          <dd>{h.wafer.id}</dd>
          <dt>Experiment</dt>
          <dd>
            {h.experiment.name}: {h.experiment.goal}
          </dd>
          <dt>Pattern</dt>
          <dd>
            {h.wafer.patternFile} <span className="muted">({h.wafer.patternSha.slice(0, 12)})</span>
          </dd>
          <dt>Recipe</dt>
          <dd>
            {h.recipe.name} v{h.recipe.version}: deposit {dep.tempC} °C, {dep.flowSccm} sccm, {dep.durationS} s
          </dd>
          <dt>Tool config</dt>
          <dd>
            v{h.toolConfig.version} ({h.toolConfig.notes})
          </dd>
        </dl>
        <Trace data={traces.data} dataKey="temp" title="heater_temp (°C)" unit="°C" steps={traces.steps} />
        <Trace data={traces.data} dataKey="power" title="heater_power (W)" unit="W" steps={traces.steps} />
        {m && (
          <p style={{ marginTop: 10 }} data-testid="metrology">
            <b>Metrology:</b> {m.thickness.toFixed(1)} nm vs target {m.target.toFixed(1)} ± {(m.specHw * 100).toFixed(1)}% ({m.deviation >= 0 ? "+" : ""}
            {(m.deviation * 100).toFixed(2)}%, {m.outOfSpec ? "out of spec" : "in spec"})
          </p>
        )}
      </div>
    </>
  );
}
