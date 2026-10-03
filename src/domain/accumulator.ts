import { BASE_WINDOW_S, P_MAX, SAT_FRACTION, TICK_MS } from "./params";
import { CHANNELS, DEPOSIT, PUMPDOWN, type RunFeatures, type StepPlanEntry, type StepSummary } from "./types";

const NC = CHANNELS.length;
// Module-level copies so the per-tick path never goes through imported bindings.
const SAT_POWER = SAT_FRACTION * P_MAX;
const DEPOSIT_IDX = DEPOSIT;
const PUMPDOWN_IDX = PUMPDOWN;

/**
 * Per-run statistics over each step's stable window, fed one tick at a time.
 * The simulator's fast path and the ingest handler both use this class, in tick order,
 * so the eval and the app compute features with identical arithmetic.
 */
export class RunAccumulator {
  private readonly n: Float64Array;
  private readonly mean: Float64Array;
  private readonly m2: Float64Array;
  private readonly stableFrom: number[];
  private readonly baseFrom: number;
  private baseN = 0;
  private baseMean = 0;
  private satTicks = 0;
  private satMax = 0;

  constructor(private readonly plan: StepPlanEntry[]) {
    const size = plan.length * NC;
    this.n = new Float64Array(size);
    this.mean = new Float64Array(size);
    this.m2 = new Float64Array(size);
    this.stableFrom = plan.map((s) => s.startMs + s.settleMs);
    const pd = plan[PUMPDOWN];
    this.baseFrom = pd.startMs + pd.durationMs - BASE_WINDOW_S * 1000;
  }

  push(stepIdx: number, tMs: number, temp: number, power: number, pressure: number, flow: number): void {
    if (stepIdx === DEPOSIT_IDX) {
      if (power > SAT_POWER) {
        this.satTicks++;
        if (this.satTicks > this.satMax) this.satMax = this.satTicks;
      } else {
        this.satTicks = 0;
      }
    } else if (stepIdx === PUMPDOWN_IDX && tMs >= this.baseFrom) {
      this.baseN++;
      this.baseMean += (pressure - this.baseMean) / this.baseN;
    }
    if (tMs >= this.stableFrom[stepIdx]) {
      const o = stepIdx * NC;
      this.update(o, temp);
      this.update(o + 1, power);
      this.update(o + 2, pressure);
      this.update(o + 3, flow);
    }
  }

  private update(i: number, x: number): void {
    const n = this.n[i] + 1;
    this.n[i] = n;
    const d = x - this.mean[i];
    this.mean[i] += d / n;
    this.m2[i] += d * (x - this.mean[i]);
  }

  summaries(): StepSummary[] {
    const out: StepSummary[] = [];
    this.plan.forEach((s, stepIdx) => {
      const expectedN = (s.durationMs - s.settleMs) / TICK_MS;
      CHANNELS.forEach((channel, c) => {
        const i = stepIdx * NC + c;
        const n = this.n[i];
        out.push({
          stepIdx,
          channel,
          mean: this.mean[i],
          std: n > 1 ? Math.sqrt(this.m2[i] / (n - 1)) : 0,
          n,
          expectedN,
        });
      });
    });
    return out;
  }

  features(flowSetpoint: number): RunFeatures {
    const o = DEPOSIT * NC;
    const pressureMeanDep = this.mean[o + 2];
    return {
      pDep: this.mean[o + 1],
      k: (pressureMeanDep - this.baseMean) / flowSetpoint,
      basePressure: this.baseMean,
      satDepS: (this.satMax * TICK_MS) / 1000,
      tempMeanDep: this.mean[o],
      flowMeanDep: this.mean[o + 3],
      pressureMeanDep,
    };
  }
}
