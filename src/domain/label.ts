/** The generated label under the lotline chart, and what the chart shades and marks. */

export interface LabelInput {
  /** First lotline alarm at or after onset (X), or null. */
  flagRun: number | null;
  trendRun: number | null;
  firstOosRun: number | null;
  onsetRun: number;
  lastRun: number;
}

export interface LabelOutput {
  text: string;
  /** Shaded band [X, firstOosRun], only when B > 0. The trend alarm never changes it. */
  shading: [number, number] | null;
  flagMarker: number | null;
  trendMarker: number | null;
  oosMarker: number | null;
}

const runs = (n: number) => (n === 1 ? "1 run" : `${n} runs`);

export function lotlineLabel(inp: LabelInput): LabelOutput {
  const { flagRun: x, trendRun, firstOosRun, onsetRun, lastRun } = inp;
  const markers = { flagMarker: x, trendMarker: trendRun, oosMarker: firstOosRun };
  if (x === null) {
    return { text: `no lotline flag through run ${lastRun}`, shading: null, ...markers };
  }
  const b = firstOosRun === null ? null : firstOosRun - x;
  const a = trendRun === null ? null : trendRun - x;

  let text: string;
  if (b === null) text = `flagged at run ${x}; no out-of-spec wafer by run ${lastRun}`;
  else if (b > 0) text = `flagged ${runs(b)} before the first out-of-spec wafer`;
  else if (b === 0) text = "flagged on the same run as the first out-of-spec wafer";
  else text = `flagged ${runs(-b)} after the first out-of-spec wafer`;

  if (a === null) text += `; the thickness trend had not alarmed between run ${onsetRun} and run ${lastRun}`;
  else if (a > 0 && b !== null && b > 0) text += `, ${a} before the thickness trend`;
  else if (a > 0) text += `; ${runs(a)} before the thickness trend`;
  else if (a === 0) text += "; flagged on the same run as the thickness trend";
  else text += `; the thickness trend alarmed ${runs(-a)} earlier`;

  const shading: [number, number] | null = b !== null && b > 0 ? [x, firstOosRun as number] : null;
  return { text, shading, ...markers };
}
