import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectedFrames } from "../src/domain/recipe";
import { schedule } from "../src/domain/schedule";
import { simulateRun } from "../src/domain/sim";
import { SETPOINTS } from "../src/domain/params";

// SHA-256 of seed 7, tool 1, runs 1-3 (scenario none), generated under the pinned Node on arm64.
const GOLDEN = "69d3c717d42d9163237f1ea49c9c00ffb60903f38aa4e50a48114581629664ea";

function framesHash(seed: number, toolId: number, nRuns: number): string {
  const h = createHash("sha256");
  for (const s of schedule(seed, toolId, nRuns)) {
    const res = simulateRun(
      { seed, toolId, runIdx: s.runIdx, versionIdx: s.versionIdx, recipe: s.recipe, scenario: "none", delta: 0 },
      { frames: true },
    );
    const f = res.frames!;
    for (const a of [f.stepIdx, f.tMs, f.heaterTemp, f.heaterPower, f.pressure, f.gasFlow]) {
      h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
  }
  return h.digest("hex");
}

describe("determinism (test 2)", () => {
  it("matches the golden hash of seed 7's frames", () => {
    expect(framesHash(7, 1, 3)).toBe(GOLDEN);
  });

  it("gives identical frames for the same seed", () => {
    expect(framesHash(11, 2, 2)).toBe(framesHash(11, 2, 2));
  });

  it("emits the expected frame count", () => {
    const s = schedule(3, 1, 1)[0];
    const res = simulateRun({ seed: 3, toolId: 1, runIdx: 1, versionIdx: 1, recipe: s.recipe, scenario: "none", delta: 0 });
    expect(res.nFrames).toBe(expectedFrames(s.recipe));
  });

  it("has a prefix-stable schedule", () => {
    for (const seed of [1, 7, 162, 10001]) {
      expect(schedule(seed, 1, 120)).toEqual(schedule(seed, 1, 1050).slice(0, 120));
    }
  });

  it("covers all four setpoints in the first four versions", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const temps = new Set(schedule(seed, 1, 50).filter((r) => r.versionIdx <= 4).map((r) => r.recipe.tempC));
      expect([...temps].sort()).toEqual([...SETPOINTS]);
      expect(schedule(seed, 1, 50).some((r) => r.versionIdx > 4)).toBe(true);
    }
  });
});
