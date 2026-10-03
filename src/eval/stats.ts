import { Rng, TAG_BOOTSTRAP, hashInts } from "../domain/rng";

/** Median; an even count gives the mean of the two middle values. Infinity marks a censored value. */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank quantile (no interpolation, so censored values stay censored). */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[k];
}

export function pct(count: number, total: number): number {
  return total === 0 ? NaN : (100 * count) / total;
}

/** 95% bootstrap CI over tools of a pooled rate sum(alarms) / sum(runs). Fixed seed, 2,000 resamples. */
export function bootstrapRateCi(alarms: number[], runs: number[], resamples = 2000): [number, number] {
  const rng = new Rng(hashInts(TAG_BOOTSTRAP, alarms.length, 2000));
  const n = alarms.length;
  const rates: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let a = 0;
    let r = 0;
    for (let i = 0; i < n; i++) {
      const j = rng.int(0, n - 1);
      a += alarms[j];
      r += runs[j];
    }
    rates.push(a / r);
  }
  rates.sort((x, y) => x - y);
  return [rates[Math.floor(0.025 * resamples)], rates[Math.ceil(0.975 * resamples) - 1]];
}

export function fmt(x: number, digits = 1): string {
  if (Number.isNaN(x)) return "n/a";
  if (x === Infinity) return "censored";
  if (x === -Infinity) return "-censored";
  return x.toFixed(digits);
}

/** Integer when whole, otherwise one decimal. */
export function fmtRuns(x: number): string {
  if (x === Infinity) return ">200";
  if (x === -Infinity) return "<0";
  if (Number.isNaN(x)) return "n/a";
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
