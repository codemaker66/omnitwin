import { describe, it, expect } from "vitest";
import {
  occupantLoadAdb,
  occupantLoadNfpa,
  requiredExitWidthMmAdb,
  requiredWidthMmNfpa,
  minExitsAdb,
  adbSingleRouteAcceptable,
  adbExitRedundancy,
  nfpaExitRedundancy,
  travelDistanceCheckAdb,
  mergingFlowFinalExitWidthM,
  exitServiceRatePersonsPerSec,
  clearanceTimeSeconds,
  densityBand,
  densityBandLabel,
  egressEscalationFlags,
  EGRESS_PLANNING_DISCLAIMER,
} from "../egress.js";

// ---------------------------------------------------------------------------
// Egress / occupancy — planning-grade means-of-escape math.
// Every expected value is traced to the published factor it encodes
// (ADB Appendix D / Table 2.1; NFPA 101 Tables 7.3.1.2 / 7.3.3.1).
// ---------------------------------------------------------------------------

describe("occupant load (ADB floor-space factors)", () => {
  it("uses 1.0 m²/person for dining/lounge/meeting", () => {
    expect(occupantLoadAdb(100, "dining-lounge-meeting")).toBe(100);
  });
  it("uses 0.5 m²/person for assembly/dance (double the dining load)", () => {
    expect(occupantLoadAdb(100, "assembly-dance")).toBe(200);
  });
  it("uses 0.3 m²/person for standing/bar and rounds up", () => {
    expect(occupantLoadAdb(100, "standing-bar")).toBe(334); // ceil(333.33)
  });
  it("uses 0.7 m²/person for concourse/queue", () => {
    expect(occupantLoadAdb(100, "concourse-queue")).toBe(143); // ceil(142.86)
  });
  it("returns 0 for non-positive area", () => {
    expect(occupantLoadAdb(0, "dining-lounge-meeting")).toBe(0);
    expect(occupantLoadAdb(Number.NaN, "assembly-dance")).toBe(0);
  });
});

describe("occupant load (NFPA net ft² factors)", () => {
  it("concentrated assembly = 7 ft²/person", () => {
    // 100 m² → 1076.39 ft² → /7 = 153.8 → 154
    expect(occupantLoadNfpa(100, "concentrated")).toBe(154);
  });
  it("less concentrated = 15 ft²/person", () => {
    expect(occupantLoadNfpa(100, "less-concentrated")).toBe(72); // ceil(71.76)
  });
});

describe("required exit width (ADB stepped table)", () => {
  it("is 0 with no occupants", () => {
    expect(requiredExitWidthMmAdb(0)).toBe(0);
  });
  it("steps 750 / 850 / 1050 at 60 / 110 / 220 boundaries", () => {
    expect(requiredExitWidthMmAdb(60)).toBe(750);
    expect(requiredExitWidthMmAdb(61)).toBe(850);
    expect(requiredExitWidthMmAdb(110)).toBe(850);
    expect(requiredExitWidthMmAdb(111)).toBe(1050);
    expect(requiredExitWidthMmAdb(220)).toBe(1050);
  });
  it("is 5 mm/person above 220", () => {
    expect(requiredExitWidthMmAdb(221)).toBe(1105);
    expect(requiredExitWidthMmAdb(400)).toBe(2000);
  });
});

describe("required egress width (NFPA per-person)", () => {
  it("level components = 0.2 in/person (5.08 mm)", () => {
    expect(requiredWidthMmNfpa(100, "level")).toBeCloseTo(508, 1);
  });
  it("stairs = 0.3 in/person (7.62 mm)", () => {
    expect(requiredWidthMmNfpa(100, "stair")).toBeCloseTo(762, 1);
  });
});

describe("minimum number of exits (ADB)", () => {
  it("is 1 up to 60, 2 up to 600, 3 above", () => {
    expect(minExitsAdb(60)).toBe(1);
    expect(minExitsAdb(61)).toBe(2);
    expect(minExitsAdb(600)).toBe(2);
    expect(minExitsAdb(601)).toBe(3);
  });
  it("single route only acceptable up to 60", () => {
    expect(adbSingleRouteAcceptable(60)).toBe(true);
    expect(adbSingleRouteAcceptable(61)).toBe(false);
  });
});

describe("ADB exit redundancy (discount the largest exit)", () => {
  it("passes when remaining exits still serve the load", () => {
    const r = adbExitRedundancy([1050, 1050], 200); // required 1050, minExits 2
    expect(r.governingExitMm).toBe(1050);
    expect(r.effectiveWidthMm).toBe(1050);
    expect(r.passes).toBe(true);
  });
  it("fails when discounting the largest drops below required width", () => {
    const r = adbExitRedundancy([1050, 1050], 300); // required 1500
    expect(r.requiredWidthMm).toBe(1500);
    expect(r.effectiveWidthMm).toBe(1050);
    expect(r.passes).toBe(false);
  });
  it("fails a single exit for a load that needs two", () => {
    const r = adbExitRedundancy([2000], 100); // minExits 2, but only 1 provided
    expect(r.effectiveWidthMm).toBe(0);
    expect(r.passes).toBe(false);
  });
});

describe("NFPA exit redundancy (≥50% capacity after losing one exit)", () => {
  it("passes when half the required width survives the loss", () => {
    const r = nfpaExitRedundancy([1016, 1016], 200, "level"); // required ≈1016
    expect(r.passes).toBe(true);
  });
  it("fails a single exit (no redundancy)", () => {
    const r = nfpaExitRedundancy([2000], 200, "level");
    expect(r.passes).toBe(false);
  });
});

describe("travel distance (ADB Table 2.1, purpose group 5)", () => {
  it("seated rows: 15 m one-way, 32 m multi-direction", () => {
    expect(travelDistanceCheckAdb(30, "seated-rows", false).passes).toBe(true); // ≤32
    expect(travelDistanceCheckAdb(30, "seated-rows", true).passes).toBe(false); // >15
    expect(travelDistanceCheckAdb(30, "seated-rows", true).limitM).toBe(15);
  });
  it("assembly-other: 18 m one-way, 45 m multi-direction", () => {
    expect(travelDistanceCheckAdb(40, "assembly-other", false).passes).toBe(true);
    expect(travelDistanceCheckAdb(20, "assembly-other", true).passes).toBe(false);
  });
});

describe("merging flow at a final exit (ADB formula)", () => {
  it("computes W = ((N/2.5) + 60S) / 80 in metres", () => {
    // N=200, S=1.2 → (80 + 72)/80 = 1.9 m
    expect(mergingFlowFinalExitWidthM(200, 1.2)).toBeCloseTo(1.9, 5);
  });
  it("never returns negative width for nonsense input", () => {
    expect(mergingFlowFinalExitWidthM(-50, -2)).toBe(0);
  });
});

describe("exit service rate (from the ~80 persons/min/m flow basis)", () => {
  it("a 1 m exit serves ~1.33 persons/sec", () => {
    expect(exitServiceRatePersonsPerSec(1000)).toBeCloseTo(80 / 60, 5);
  });
});

describe("planning-grade clearance time", () => {
  it("sums pre-movement + travel + queueing", () => {
    // pre 30 + travel(24/1.2=20) + queue(100/2=50) = 100 s
    const t = clearanceTimeSeconds({
      preMovementSeconds: 30,
      maxPathMetres: 24,
      walkingSpeedMs: 1.2,
      queueDemandPersons: 100,
      serviceRatePersonsPerSec: 2,
    });
    expect(t).toBeCloseTo(100, 5);
  });
  it("falls back to 1.2 m/s and ignores a zero service rate", () => {
    const t = clearanceTimeSeconds({
      preMovementSeconds: 0,
      maxPathMetres: 12,
      walkingSpeedMs: 0,
      queueDemandPersons: 50,
      serviceRatePersonsPerSec: 0,
    });
    expect(t).toBeCloseTo(10, 5); // 12 / 1.2, queue term dropped
  });
});

describe("crowd density bands", () => {
  it("maps persons/m² to the staff descriptor", () => {
    expect(densityBand(1)).toBe("free");
    expect(densityBand(2)).toBe("channels");
    expect(densityBand(4)).toBe("restricted");
    expect(densityBand(5)).toBe("static");
    expect(densityBand(7)).toBe("crush");
    expect(densityBand(9)).toBe("crush");
  });
  it("has a label for every band", () => {
    for (const band of ["free", "channels", "restricted", "static", "crush"] as const) {
      expect(densityBandLabel(band).length).toBeGreaterThan(0);
    }
  });
});

describe("claim safety", () => {
  it("escalates for a formal occupancy decision", () => {
    const flags = egressEscalationFlags({
      nonStandardAssumptions: false,
      staffManagedEvacuation: false,
      mobilityImpairedOccupants: false,
      peakDensityPersonsPerM2: 1,
      feedsFormalOccupancyDecision: true,
    });
    expect(flags.length).toBeGreaterThan(0);
  });
  it("escalates crush-range density", () => {
    const flags = egressEscalationFlags({
      nonStandardAssumptions: false,
      staffManagedEvacuation: false,
      mobilityImpairedOccupants: false,
      peakDensityPersonsPerM2: 8,
      feedsFormalOccupancyDecision: false,
    });
    expect(flags.some((f) => f.toLowerCase().includes("density"))).toBe(true);
  });
  it("returns no flags for a benign planning context (but that is NOT 'compliant')", () => {
    const flags = egressEscalationFlags({
      nonStandardAssumptions: false,
      staffManagedEvacuation: false,
      mobilityImpairedOccupants: false,
      peakDensityPersonsPerM2: 1,
      feedsFormalOccupancyDecision: false,
    });
    expect(flags).toEqual([]);
  });
  it("disclaimer disclaims compliance and never asserts certified safety", () => {
    expect(EGRESS_PLANNING_DISCLAIMER).toMatch(/not a code-compliance determination/i);
    expect(EGRESS_PLANNING_DISCLAIMER).not.toMatch(/\bcompliant\b/i);
    expect(EGRESS_PLANNING_DISCLAIMER).not.toMatch(/certified safe/i);
  });
});
