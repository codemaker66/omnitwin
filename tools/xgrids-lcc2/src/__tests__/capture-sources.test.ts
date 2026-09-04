import { describe, expect, it } from "vitest";
import { FLOOR_OFFSET_INSTRUMENT, TRADES_HALL_CAPTURE_SOURCES } from "../capture-sources.js";

describe("TRADES_HALL_CAPTURE_SOURCES floor offsets", () => {
  it("names the instrument and the date the offsets were measured", () => {
    expect(FLOOR_OFFSET_INSTRUMENT).toContain("sog-floor-census.py");
    expect(FLOOR_OFFSET_INSTRUMENT).toMatch(/[0-9]{4}-[0-9]{2}-[0-9]{2}/u);
  });

  it("carries a measured Gaussian floor offset for every room, within a metre", () => {
    for (const source of TRADES_HALL_CAPTURE_SOURCES) {
      expect(source.floorOffsetM).toBeGreaterThanOrEqual(0);
      expect(source.floorOffsetM).toBeLessThanOrEqual(1);
    }
  });

  it("lifts the Grand Hall by the 0.55 m its finest Gaussians measured", () => {
    const hall = TRADES_HALL_CAPTURE_SOURCES.find((source) => source.roomSlug === "grand-hall");
    expect(hall?.floorOffsetM).toBe(0.55);
  });
});
