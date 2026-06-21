import { describe, it, expect } from "vitest";
import {
  slantDistanceM,
  luxAtDistance,
  luxAtDistanceAndAngle,
  beamFootprintDiameterM,
  requiredBeamAngleDeg,
  isGrazingIncidence,
  GRAZING_INCIDENCE_THRESHOLD_DEG,
  assessIlluminance,
  illuminanceBasisLabel,
  ILLUMINANCE_PRESETS,
  LIGHTING_FIXTURE_FAMILIES,
  PHOTOMETRIC_PLANNING_DISCLAIMER,
  type IlluminanceBasis,
} from "../photometrics.js";

// ---------------------------------------------------------------------------
// Photometrics — planning-grade lighting coverage math (Epic 6 foundation).
// ---------------------------------------------------------------------------

describe("slant distance", () => {
  it("is the 3D distance fixture→target, not the vertical drop", () => {
    // 6 m trim, target 3 m across + 4 m along, 1.2 m table height
    expect(slantDistanceM({ x: 0, y: 6, z: 0 }, { x: 3, y: 1.2, z: 4 })).toBeCloseTo(6.931, 3);
  });
});

describe("illuminance (inverse-square + cosine)", () => {
  it("E = I / d²", () => {
    expect(luxAtDistance(10000, 5)).toBe(400);
  });
  it("is 0 at zero distance (guard against divide-by-zero)", () => {
    expect(luxAtDistance(10000, 0)).toBe(0);
  });
  it("applies cosine for incidence angle", () => {
    expect(luxAtDistanceAndAngle(10000, 5, 0)).toBeCloseTo(400, 5);
    expect(luxAtDistanceAndAngle(10000, 5, 60)).toBeCloseTo(200, 5); // cos60 = 0.5
  });
  it("never produces negative lux from a beyond-90° angle", () => {
    expect(luxAtDistanceAndAngle(10000, 5, 120)).toBe(0);
  });
});

describe("beam geometry", () => {
  it("footprint Ø = 2·d·tan(beam/2)", () => {
    expect(beamFootprintDiameterM(5, 30)).toBeCloseTo(2.6795, 3);
  });
  it("requiredBeamAngle is the inverse of footprint", () => {
    const footprint = beamFootprintDiameterM(5, 30);
    expect(requiredBeamAngleDeg(footprint, 5)).toBeCloseTo(30, 5);
  });
  it("returns 0 beam for zero distance", () => {
    expect(requiredBeamAngleDeg(2, 0)).toBe(0);
  });
});

describe("grazing incidence warning", () => {
  it("flags angles at/over the threshold", () => {
    expect(isGrazingIncidence(GRAZING_INCIDENCE_THRESHOLD_DEG)).toBe(true);
    expect(isGrazingIncidence(70)).toBe(true);
    expect(isGrazingIncidence(45)).toBe(false);
  });
});

describe("illuminance presets", () => {
  it("every preset has a sane band and a known plane/basis", () => {
    const planes = new Set(["horizontal", "vertical"]);
    const bases = new Set<IlluminanceBasis>(["standard", "camera-guideline", "event-heuristic"]);
    for (const preset of Object.values(ILLUMINANCE_PRESETS)) {
      expect(preset.minLux).toBeGreaterThan(0);
      expect(preset.maxLux).toBeGreaterThanOrEqual(preset.minLux);
      expect(planes.has(preset.plane)).toBe(true);
      expect(bases.has(preset.basis)).toBe(true);
      expect(preset.note.length).toBeGreaterThan(0);
    }
  });
  it("faces presets target the vertical plane", () => {
    expect(ILLUMINANCE_PRESETS["lectern-faces"].plane).toBe("vertical");
    expect(ILLUMINANCE_PRESETS["video-conference"].plane).toBe("vertical");
  });
  it("the dance-floor value is honestly tagged a heuristic, not a standard", () => {
    expect(ILLUMINANCE_PRESETS["dance-social"].basis).toBe("event-heuristic");
  });
  it("assesses a measured value against a band", () => {
    const preset = ILLUMINANCE_PRESETS["banquet-service"]; // 50–100
    expect(assessIlluminance(40, preset)).toBe("below");
    expect(assessIlluminance(75, preset)).toBe("within");
    expect(assessIlluminance(150, preset)).toBe("above");
  });
  it("labels every provenance basis", () => {
    for (const basis of ["standard", "camera-guideline", "event-heuristic"] as const) {
      expect(illuminanceBasisLabel(basis).length).toBeGreaterThan(0);
    }
  });
});

describe("fixture taxonomy", () => {
  it("separates beam-quality families", () => {
    expect(LIGHTING_FIXTURE_FAMILIES).toContain("profile");
    expect(LIGHTING_FIXTURE_FAMILIES).toContain("wash");
    expect(LIGHTING_FIXTURE_FAMILIES).toContain("par");
    expect(new Set(LIGHTING_FIXTURE_FAMILIES).size).toBe(LIGHTING_FIXTURE_FAMILIES.length);
  });
});

describe("claim safety", () => {
  it("disclaimer keeps presets editable and disclaims certified levels", () => {
    expect(PHOTOMETRIC_PLANNING_DISCLAIMER).toMatch(/not certified levels/i);
    expect(PHOTOMETRIC_PLANNING_DISCLAIMER).toMatch(/indicative/i);
  });
});
