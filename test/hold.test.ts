import { describe, expect, it } from "vitest";
import { holdSources, type HoldRow } from "../src/domain/hold";
import { A_FLOW, K0, P_BASE_NOM, dTSpec, hwRel } from "../src/domain/params";

const r = 4;
const nominal: HoldRow = {
  tempC: 400,
  flowSccm: 50,
  tempMeanDep: 400,
  flowMeanDep: 50,
  pressureMeanDep: P_BASE_NOM + K0 * 50,
  satDepS: 0,
  thickness: 100,
  target: 100,
};

describe("hold", () => {
  it("is silent on a nominal run", () => {
    expect(holdSources(nominal, r)).toEqual([]);
  });
  it("fires each source just past its band, and not just inside it", () => {
    const hw = hwRel(r);
    const cases: [Partial<HoldRow>, Partial<HoldRow>, string][] = [
      [{ tempMeanDep: 400 + dTSpec(r) * 1.01 }, { tempMeanDep: 400 + dTSpec(r) * 0.99 }, "temp"],
      [{ flowMeanDep: 50 * (1 + (hw / A_FLOW) * 1.01) }, { flowMeanDep: 50 * (1 + (hw / A_FLOW) * 0.99) }, "flow"],
      [
        { pressureMeanDep: P_BASE_NOM + K0 * 50 * (1 + (hw / A_FLOW) * 1.01) },
        { pressureMeanDep: P_BASE_NOM + K0 * 50 * (1 + (hw / A_FLOW) * 0.99) },
        "pressure",
      ],
      [{ satDepS: 1.1 }, { satDepS: 1.0 }, "saturation"],
      [{ thickness: 100 * (1 - hw * 1.01) }, { thickness: 100 * (1 - hw * 0.99) }, "metrology"],
    ];
    for (const [out, inside, src] of cases) {
      expect(holdSources({ ...nominal, ...out }, r)).toEqual([src]);
      expect(holdSources({ ...nominal, ...inside }, r)).toEqual([]);
    }
  });
});
