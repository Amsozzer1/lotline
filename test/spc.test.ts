import { describe, expect, it } from "vitest";
import { EWMA_FACTOR, calibrate, countFamilyAlarms, runFamily } from "../src/domain/spc";

function series(n: number, at: Record<number, number>, fill = 0): Float64Array {
  const s = new Float64Array(n).fill(fill);
  for (const [run, v] of Object.entries(at)) s[Number(run) - 1] = v;
  return s;
}

describe("test 1: SPC", () => {
  it("rule 1 fires at |x| > 4 sigma and nowhere else", () => {
    const x = series(100, { 70: 4.01, 80: -3.99, 90: -4.5 });
    const t = runFamily([x], [1], Infinity, 100);
    expect(t.alarms.map((a) => a.run)).toEqual([70, 90]);
    expect(t.alarms.every((a) => a.rule1 && !a.ewma)).toBe(true);
  });

  it("EWMA matches hand-computed values and limits", () => {
    // x = 1.5 from run 51: z = 0.3, 0.54, 0.732, 0.8856, 1.00848; limit 3 * sqrt(0.2/1.8) = 1.0
    const x = new Float64Array(60);
    for (let i = 50; i < 60; i++) x[i] = 1.5;
    const t = runFamily([x], [1], 3, 60);
    expect(EWMA_FACTOR).toBeCloseTo(Math.sqrt(0.2 / 1.8), 15);
    expect(Array.from(t.z[0].slice(50, 55))).toEqual([0.30000000000000004, 0.54, 0.7320000000000001, 0.8856000000000002, 1.0084800000000003]);
    expect(t.alarms[0]).toEqual({ run: 55, charts: [0], rule1: false, ewma: true });
    // after the alarm the EWMA restarts at 0, so the next alarm is 5 runs later
    expect(t.alarms[1].run).toBe(60);
  });

  it("an alarm on one chart resets the whole family", () => {
    const a = series(70, { 60: 5 });
    const b = new Float64Array(70);
    for (let i = 50; i < 70; i++) b[i] = 0.5;
    const t = runFamily([a, b], [1, 1], 10, 70);
    expect(t.alarms.map((x) => [x.run, x.charts])).toEqual([[60, [0]]]);
    expect(t.z[1][59]).toBeGreaterThan(0.4); // value before the reset
    expect(t.z[1][60]).toBeCloseTo(0.2 * 0.5, 15); // restarted from 0 at run 61
  });

  it("never signals during Phase I (runs 1-50)", () => {
    const x = series(60, { 1: 100, 25: -100, 50: 100 });
    const t = runFamily([x], [1], 0.1, 60);
    expect(t.alarms.length).toBe(0);
    expect(Number.isNaN(t.z[0][49])).toBe(true);
    expect(countFamilyAlarms([x], [1], 0.1, 60)).toBe(0);
  });

  it("countFamilyAlarms agrees with runFamily", () => {
    const x = new Float64Array(400);
    for (let i = 0; i < 400; i++) x[i] = Math.sin(i * 0.37) * 2.2;
    for (const le of [1, 2, 3, Infinity]) {
      expect(countFamilyAlarms([x, x.map((v) => -v * 0.8)], [1, 1], le, 400)).toBe(runFamily([x, x.map((v) => -v * 0.8)], [1, 1], le, 400).alarms.length);
    }
  });

  it("calibrate finds the smallest L_e at the target", () => {
    const rate = (le: number) => 0.001 + 0.01 * Math.exp(-le);
    const le = calibrate(rate, 0.005);
    expect(le).toBeCloseTo(Math.log(0.01 / 0.004), 9);
    expect(rate(le)).toBeLessThanOrEqual(0.005);
  });

  it("calibrate throws when rule 1 alone already exceeds the target", () => {
    expect(() => calibrate(() => 0.006, 0.005)).toThrow(/infeasible/);
  });
});
