import { describe, expect, it } from "vitest";
import { bannerLines, type VersionInfo } from "../src/domain/banner";
import { lotlineLabel } from "../src/domain/label";

const base = { onsetRun: 61, lastRun: 120 };

describe("test 1: generated label and shading", () => {
  const cases: [string, Parameters<typeof lotlineLabel>[0], string, [number, number] | null][] = [
    ["A > 0, B > 0", { ...base, flagRun: 73, trendRun: 75, firstOosRun: 88 }, "flagged 15 runs before the first out-of-spec wafer, 2 before the thickness trend", [73, 88]],
    ["A = 0", { ...base, flagRun: 73, trendRun: 73, firstOosRun: 88 }, "flagged 15 runs before the first out-of-spec wafer; flagged on the same run as the thickness trend", [73, 88]],
    ["A < 0", { ...base, flagRun: 73, trendRun: 70, firstOosRun: 88 }, "flagged 15 runs before the first out-of-spec wafer; the thickness trend alarmed 3 runs earlier", [73, 88]],
    ["B = 0", { ...base, flagRun: 88, trendRun: 90, firstOosRun: 88 }, "flagged on the same run as the first out-of-spec wafer; 2 runs before the thickness trend", null],
    ["B < 0", { ...base, flagRun: 90, trendRun: 89, firstOosRun: 88 }, "flagged 2 runs after the first out-of-spec wafer; the thickness trend alarmed 1 run earlier", null],
    ["trend censored", { ...base, flagRun: 73, trendRun: null, firstOosRun: 88 }, "flagged 15 runs before the first out-of-spec wafer; the thickness trend had not alarmed between run 61 and run 120", [73, 88]],
    ["OOS censored", { ...base, flagRun: 73, trendRun: 75, firstOosRun: null }, "flagged at run 73; no out-of-spec wafer by run 120; 2 runs before the thickness trend", null],
    ["no lotline flag", { ...base, flagRun: null, trendRun: 80, firstOosRun: null }, "no lotline flag through run 120", null],
    ["singular", { ...base, flagRun: 87, trendRun: 88, firstOosRun: 88 }, "flagged 1 run before the first out-of-spec wafer, 1 before the thickness trend", [87, 88]],
  ];
  for (const [name, input, text, shading] of cases) {
    it(name, () => {
      const out = lotlineLabel(input);
      expect(out.text).toBe(text);
      expect(out.shading).toEqual(shading);
      expect(out.trendMarker).toBe(input.trendRun);
      expect(out.oosMarker).toBe(input.firstOosRun);
    });
  }
  it("the trend alarm never changes the shaded band", () => {
    for (const trendRun of [null, 60, 73, 80, 88, 100]) {
      expect(lotlineLabel({ ...base, flagRun: 73, trendRun, firstOosRun: 88 }).shading).toEqual([73, 88]);
    }
  });
});

describe("test 1: banner", () => {
  // v1-v5 cover runs 1-40, v6 runs 41-50, v7 runs 51-58 (flow edit), v8 runs 59-70 (temperature edit)
  const n = 70;
  const versionOfRun = Array.from({ length: n }, (_, i) => (i < 40 ? 1 + Math.floor(i / 8) : i < 50 ? 6 : i < 58 ? 7 : 8));
  const spec: Record<number, [number, number, number]> = {
    1: [350, 50, 90], 2: [375, 50, 90], 3: [400, 50, 90], 4: [425, 50, 90], 5: [350, 50, 90],
    6: [375, 50, 90], 7: [375, 41, 90], 8: [400, 41, 90],
  };
  const tempOfRun = versionOfRun.map((v) => spec[v][0]);
  const versions = new Map<number, VersionInfo>();
  for (let v = 1; v <= 8; v++) {
    versions.set(v, { version: v, firstRun: versionOfRun.indexOf(v) + 1, tempC: spec[v][0], flowSccm: spec[v][1], depositS: spec[v][2] });
  }
  const heater = Array.from({ length: n }, (_, i) => (i >= 54 ? -0.004 : 0.001));
  const ewma = Array.from({ length: n }, (_, i) => (i < 50 ? NaN : i >= 54 ? -0.002 : 0.0005));
  const zeros = heater.map(() => 0);
  const common = { phaseIRuns: 50, index: [heater, zeros], ewma: [ewma, zeros], versionOfRun, tempOfRun, versions, toolConfigVersion: 1, toolConfigSinceRun: 1 };

  it("flagged run: tool health first, then recipe, then tool", () => {
    const lines = bannerLines({ ...common, runIdx: 66, alarm: { run: 66, charts: [0], rule1: false, ewma: true } });
    expect(lines).toEqual([
      "Tool health: heater power 0.4% below expected for each run's setpoint over runs 55–66, in 2 of 2 recipe versions (v7–v8, 375–400 °C); flagged at run 66.",
      "Recipe: v8 (edited from v7 at run 59: deposit 375 → 400 °C, flow and deposit time unchanged)",
      "Tool: config v1, unchanged since run 1",
    ]);
  });

  it("unflagged run: recipe and tool lines only", () => {
    expect(bannerLines({ ...common, runIdx: 52, alarm: null })).toEqual([
      "Recipe: v7 (edited from v6 at run 51: flow 50 → 41 sccm, temperature and deposit time unchanged)",
      "Tool: config v1, unchanged since run 1",
    ]);
  });

  it("Phase I runs never get the tool-health line", () => {
    const lines = bannerLines({ ...common, runIdx: 30, alarm: { run: 30, charts: [0], rule1: true, ewma: false } });
    expect(lines[0].startsWith("Recipe:")).toBe(true);
  });

  it("first version reads 'first version'", () => {
    expect(bannerLines({ ...common, runIdx: 3, alarm: null })[0]).toBe("Recipe: v1 (first version)");
  });

  it("single version in range uses 'within recipe version'", () => {
    const lines = bannerLines({ ...common, runIdx: 58, alarm: { run: 58, charts: [0], rule1: true, ewma: false } });
    expect(lines[0]).toBe("Tool health: heater power 0.4% below expected for each run's setpoint over runs 55–58, within recipe version v7 (375 °C); flagged at run 58.");
  });
});

describe("temperature bound", () => {
  it("never prints less than the measured max", async () => {
    const { tempBound } = await import("../src/domain/label");
    for (const x of [0, 0.0012, 0.0021, 0.01, 0.0100001, 0.03, 0.0749, 0.25, 1.234]) {
      expect(Number(tempBound(x))).toBeGreaterThanOrEqual(x);
      expect(Number(tempBound(x))).toBeGreaterThanOrEqual(0.01);
    }
    expect(tempBound(0.0021)).toBe("0.01");
  });
});
