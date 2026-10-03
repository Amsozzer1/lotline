export interface ToolSummary {
  id: string;
  displayName: string;
  runCount: number;
  live: { state: "idle" | "running"; runIdx: number | null; stepIdx: number | null };
  lastRunFlagged: boolean;
  lastSignalRun: number | null;
}

export interface ToolRunRow {
  runId: string;
  runIdx: number;
  version: number;
  tempC: number;
  flowSccm: number;
  depositS: number;
  thickness: number;
  target: number;
  specHw: number;
}

export interface FamilyAlarm {
  run: number;
  charts: number[];
  rule1: boolean;
  ewma: boolean;
}

type Series = (number | null)[];

export interface Health {
  n: number;
  phaseIRuns: number;
  phaseIComplete: boolean;
  s: number;
  rows: ToolRunRow[];
  index: { heater: Series; flow: Series; thickness: Series } | null;
  ewma: { heater: Series; flow: Series; thickness: Series } | null;
  limits: Record<"heater" | "flow" | "thickness", { rule1: number; ewma: number }> | null;
  signals: { lotline: FamilyAlarm[]; trend: FamilyAlarm[]; hold: { run: number; sources: string[] }[] };
  oosRuns: number[];
  versions: { version: number; firstRun: number; lastRun: number; tempC: number; flowSccm: number; depositS: number }[];
  toolAlarmCount: number;
  maxTempDev: number;
  simulatedDriftStart: number | null;
  firsts: { flagRun: number | null; flagCharts: number[] | null; trendRun: number | null; firstOosRun: number | null };
  label: {
    text: string;
    shading: [number, number] | null;
    flagMarker: number | null;
    trendMarker: number | null;
    oosMarker: number | null;
  };
}

export interface RunHistory {
  run: { id: string; runIdx: number; toolId: string; startMs: number; endMs: number | null; expectedFrames: number | null };
  tool: { id: string; displayName: string };
  toolConfig: { version: number; notes: string };
  wafer: { id: string; patternFile: string; patternSha: string };
  experiment: { id: string; name: string; goal: string };
  recipe: { name: string; version: number; steps: { name: string; durationS: number; settleS: number; tempC: number; flowSccm: number }[] };
  recipeChanges: { field: string; from: number; to: number; unit: string }[];
  frames: { stepIdx: number[]; tMs: number[]; heaterTemp: number[]; heaterPower: number[]; pressure: number[]; gasFlow: number[] };
  measurement: { thickness: number; target: number; specHw: number; deviation: number; outOfSpec: boolean } | null;
  banner: string[];
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const runRequests = new Map<string, Promise<RunHistory>>();
/** Runs already loaded, so a page opened from a prefetched link renders without a loading state. */
export const loadedRuns = new Map<string, RunHistory>();

export function fetchRun(id: string): Promise<RunHistory> {
  let p = runRequests.get(id);
  if (!p) {
    p = getJson<RunHistory>(`/api/runs/${id}`).then((r) => {
      loadedRuns.set(id, r);
      return r;
    });
    p.catch(() => runRequests.delete(id));
    runRequests.set(id, p);
  }
  return p;
}
