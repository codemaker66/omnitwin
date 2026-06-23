import { describe, it, expect } from "vitest";
import { assessRigging, legTensionKg, type BridleInput } from "../rigging.js";

const base: BridleInput = {
  suspendedLoadKg: 200,
  bridleLegs: 1,
  legAngleFromHorizontalDeg: 90,
  pointWllKg: 500,
  permittedUse: "manual-hoist",
  loadKind: "static",
};

describe("legTensionKg", () => {
  it("a single point carries the whole load", () => {
    expect(legTensionKg(200, 1, 90)).toBe(200);
  });

  it("a two-leg bridle shares the load by 1/(2·sinθ)", () => {
    expect(legTensionKg(200, 2, 90)).toBeCloseTo(100, 3); // vertical legs → half each
    expect(legTensionKg(200, 2, 30)).toBeCloseTo(200, 3); // 30° → tension = load
    expect(legTensionKg(200, 2, 15)).toBeGreaterThan(380); // shallow → climbs fast
  });
});

describe("assessRigging", () => {
  it("reports headroom and stays clean within WLL", () => {
    const a = assessRigging(base);
    expect(a.legTensionKg).toBe(200);
    expect(a.utilizationPercent).toBe(40); // 200 / 500
    expect(a.headroomKg).toBe(300);
    expect(a.withinWll).toBe(true);
    expect(a.warnings).toHaveLength(0);
  });

  it("warns and flags over-WLL when tension exceeds the point limit", () => {
    const a = assessRigging({ ...base, suspendedLoadKg: 600 });
    expect(a.withinWll).toBe(false);
    expect(a.headroomKg).toBe(-100);
    expect(a.warnings.some((w) => /exceeds the point WLL/.test(w))).toBe(true);
  });

  it("warns on a shallow bridle angle", () => {
    const a = assessRigging({ ...base, bridleLegs: 2, legAngleFromHorizontalDeg: 20 });
    expect(a.warnings.some((w) => /Shallow bridle angle/.test(w))).toBe(true);
  });

  it("forbids a hoist on a static-only point", () => {
    const a = assessRigging({ ...base, permittedUse: "static-only", loadKind: "power-hoist" });
    expect(a.warnings.some((w) => /static-only point must NOT anchor a hoist/.test(w))).toBe(true);
  });

  it("warns when a power hoist hangs on a manual-rated point", () => {
    const a = assessRigging({ ...base, permittedUse: "manual-hoist", loadKind: "power-hoist" });
    expect(a.warnings.some((w) => /Power hoist on a manual-rated point/.test(w))).toBe(true);
  });

  it("allows a static load on a static-only point", () => {
    const a = assessRigging({ ...base, permittedUse: "static-only", loadKind: "static" });
    expect(a.warnings).toHaveLength(0);
  });
});
