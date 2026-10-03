import { describe, expect, it } from "vitest";
import { fexp, flog } from "../src/domain/fmath";

function ulpDiff(a: number, b: number): number {
  const buf = new DataView(new ArrayBuffer(16));
  buf.setFloat64(0, a);
  buf.setFloat64(8, b);
  return Number(buf.getBigInt64(0) - buf.getBigInt64(8));
}

describe("portable exp and log", () => {
  it("match the engine's exp within 1 ulp over the simulator's range", () => {
    for (let i = 0; i <= 20000; i++) {
      const x = -30 + (i / 20000) * 32;
      expect(Math.abs(ulpDiff(fexp(x), Math.exp(x)))).toBeLessThanOrEqual(1);
    }
  });
  it("match the engine's log within 1 ulp on (0, 1]", () => {
    for (let i = 1; i <= 20000; i++) {
      const x = i / 20000;
      expect(Math.abs(ulpDiff(flog(x), Math.log(x)))).toBeLessThanOrEqual(1);
      expect(Math.abs(ulpDiff(flog(x * 1e-6), Math.log(x * 1e-6)))).toBeLessThanOrEqual(1);
    }
  });
  it("handles edge values", () => {
    expect(fexp(0)).toBe(1);
    expect(flog(1)).toBe(0);
    expect(flog(0)).toBe(-Infinity);
    expect(fexp(-1000)).toBe(0);
  });
});
