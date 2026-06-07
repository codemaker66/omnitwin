import { describe, it, expect } from "vitest";
import {
  computeCapacityIntelligence,
  spacePerGuestStandard,
  inferSeatingStyle,
  comfortBandLabel,
  type ComfortBand,
} from "../layout-capacity.js";

// Trades Hall Grand Hall — 21m × 10.5m ≈ 220.5 m².
const GRAND_HALL_M2 = 220.5;

describe("spacePerGuestStandard", () => {
  it("returns dinner-rounds the most generous of the dining styles", () => {
    expect(spacePerGuestStandard("dinner-rounds").comfortableM2).toBe(1.5);
    expect(spacePerGuestStandard("theatre").comfortableM2).toBeLessThan(
      spacePerGuestStandard("dinner-rounds").comfortableM2,
    );
  });
});

describe("inferSeatingStyle", () => {
  it("prefers rounds, then banquet rows, then theatre, then custom", () => {
    expect(inferSeatingStyle({ roundTables: 2, banquetTables: 0, chairs: 20 })).toBe("dinner-rounds");
    expect(inferSeatingStyle({ roundTables: 0, banquetTables: 3, chairs: 30 })).toBe("dinner-banquet");
    expect(inferSeatingStyle({ roundTables: 0, banquetTables: 0, chairs: 40 })).toBe("theatre");
    expect(inferSeatingStyle({ roundTables: 0, banquetTables: 0, chairs: 0 })).toBe("custom");
  });
});

describe("computeCapacityIntelligence", () => {
  it("sizes comfortable and tight capacity from real floor area", () => {
    const c = computeCapacityIntelligence(GRAND_HALL_M2, 0, "dinner-rounds");
    expect(c.comfortableCapacity).toBe(147); // floor(220.5 / 1.5)
    expect(c.tightCapacity).toBe(200); // floor(220.5 / 1.1)
    expect(c.spacePerGuestM2).toBeNull();
    expect(c.band).toBe("open");
    expect(c.utilizationPercent).toBe(0);
  });

  it("reports a spacious band when room per guest is generous", () => {
    const c = computeCapacityIntelligence(GRAND_HALL_M2, 100, "dinner-rounds");
    expect(c.spacePerGuestM2).toBeCloseTo(2.205, 3);
    expect(c.band).toBe("spacious");
    expect(c.utilizationPercent).toBe(68);
  });

  it("reports comfortable at exactly the comfortable allowance", () => {
    const c = computeCapacityIntelligence(GRAND_HALL_M2, 147, "dinner-rounds");
    expect(c.band).toBe("comfortable");
    expect(c.utilizationPercent).toBe(100);
  });

  it("reports tight between minimum and comfortable allowances", () => {
    const c = computeCapacityIntelligence(GRAND_HALL_M2, 180, "dinner-rounds");
    expect(c.band).toBe("tight");
  });

  it("reports over-capacity below the minimum allowance", () => {
    const c = computeCapacityIntelligence(GRAND_HALL_M2, 250, "dinner-rounds");
    expect(c.band).toBe("over-capacity");
  });

  it("guards against zero/negative/NaN floor area", () => {
    for (const area of [0, -5, Number.NaN]) {
      const c = computeCapacityIntelligence(area, 50, "theatre");
      expect(c.comfortableCapacity).toBe(0);
      expect(c.utilizationPercent).toBe(0);
      expect(c.spacePerGuestM2).toBeNull();
      expect(c.band).toBe("open");
    }
  });
});

describe("comfortBandLabel", () => {
  const FORBIDDEN = [
    "production ready", "approved for occupancy", "survey-grade",
    "photoreal digital twin", "legally compliant", "certified safe", "fire approved",
  ];
  const bands: ComfortBand[] = ["open", "spacious", "comfortable", "tight", "over-capacity"];

  it("produces a label for every band without unsafe claims", () => {
    for (const band of bands) {
      const label = comfortBandLabel(band);
      expect(label.length).toBeGreaterThan(0);
      const lower = label.toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
