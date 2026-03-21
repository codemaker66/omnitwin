import { describe, it, expect } from "vitest";
import {
  getFullRoomBounds,
  clampBoxFace,
  boxValueToReal,
  faceToPercent,
  percentToFace,
  faceLabel,
  BOX_FACES,
  MIN_BOX_EXTENT,
} from "../section-box.js";
import type { BoxBounds } from "../section-box.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { RENDER_SCALE } from "../../constants/scale.js";

const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("section-box constants", () => {
  it("BOX_FACES has 6 entries", () => {
    expect(BOX_FACES).toHaveLength(6);
    expect(BOX_FACES).toContain("minX");
    expect(BOX_FACES).toContain("maxX");
    expect(BOX_FACES).toContain("minY");
    expect(BOX_FACES).toContain("maxY");
    expect(BOX_FACES).toContain("minZ");
    expect(BOX_FACES).toContain("maxZ");
  });

  it("MIN_BOX_EXTENT is positive", () => {
    expect(MIN_BOX_EXTENT).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getFullRoomBounds
// ---------------------------------------------------------------------------

describe("getFullRoomBounds", () => {
  it("returns bounds matching room dimensions", () => {
    const bounds = getFullRoomBounds();
    expect(bounds.minX).toBe(-width / 2);
    expect(bounds.maxX).toBe(width / 2);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(height);
    expect(bounds.minZ).toBe(-length / 2);
    expect(bounds.maxZ).toBe(length / 2);
  });

  it("minX < maxX, minY < maxY, minZ < maxZ", () => {
    const bounds = getFullRoomBounds();
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
    expect(bounds.maxZ).toBeGreaterThan(bounds.minZ);
  });
});

// ---------------------------------------------------------------------------
// clampBoxFace
// ---------------------------------------------------------------------------

describe("clampBoxFace", () => {
  const fullBounds = getFullRoomBounds();

  it("clamps minX to not exceed maxX - MIN_BOX_EXTENT", () => {
    const result = clampBoxFace("minX", fullBounds.maxX + 10, fullBounds);
    expect(result).toBe(fullBounds.maxX - MIN_BOX_EXTENT);
  });

  it("clamps minX to not go below room minX", () => {
    const result = clampBoxFace("minX", -1000, fullBounds);
    expect(result).toBe(fullBounds.minX);
  });

  it("clamps maxX to not go below minX + MIN_BOX_EXTENT", () => {
    const result = clampBoxFace("maxX", fullBounds.minX - 10, fullBounds);
    expect(result).toBe(fullBounds.minX + MIN_BOX_EXTENT);
  });

  it("clamps maxX to not exceed room maxX", () => {
    const result = clampBoxFace("maxX", 1000, fullBounds);
    expect(result).toBe(fullBounds.maxX);
  });

  it("clamps minY to [0, maxY - MIN_BOX_EXTENT]", () => {
    expect(clampBoxFace("minY", -5, fullBounds)).toBe(0);
    expect(clampBoxFace("minY", 100, fullBounds)).toBe(fullBounds.maxY - MIN_BOX_EXTENT);
  });

  it("clamps maxY to [minY + MIN_BOX_EXTENT, room maxY]", () => {
    expect(clampBoxFace("maxY", -5, fullBounds)).toBe(fullBounds.minY + MIN_BOX_EXTENT);
    expect(clampBoxFace("maxY", 100, fullBounds)).toBe(fullBounds.maxY);
  });

  it("clamps minZ correctly", () => {
    expect(clampBoxFace("minZ", -1000, fullBounds)).toBe(fullBounds.minZ);
    expect(clampBoxFace("minZ", 1000, fullBounds)).toBe(fullBounds.maxZ - MIN_BOX_EXTENT);
  });

  it("clamps maxZ correctly", () => {
    expect(clampBoxFace("maxZ", -1000, fullBounds)).toBe(fullBounds.minZ + MIN_BOX_EXTENT);
    expect(clampBoxFace("maxZ", 1000, fullBounds)).toBe(fullBounds.maxZ);
  });

  it("allows valid values within range", () => {
    const result = clampBoxFace("minX", 0, fullBounds);
    expect(result).toBe(0);
  });

  it("prevents box inversion with partially closed bounds", () => {
    const narrow: BoxBounds = {
      ...fullBounds,
      minX: 5,
      maxX: 6,
    };
    // Trying to set minX past maxX
    const result = clampBoxFace("minX", 10, narrow);
    expect(result).toBe(6 - MIN_BOX_EXTENT);
  });
});

// ---------------------------------------------------------------------------
// boxValueToReal
// ---------------------------------------------------------------------------

describe("boxValueToReal", () => {
  it("Y values are not scaled (height is real)", () => {
    expect(boxValueToReal("minY", 3.5)).toBe(3.5);
    expect(boxValueToReal("maxY", 7)).toBe(7);
  });

  it("X values are divided by RENDER_SCALE", () => {
    expect(boxValueToReal("minX", 10)).toBeCloseTo(10 / RENDER_SCALE);
    expect(boxValueToReal("maxX", -6)).toBeCloseTo(-6 / RENDER_SCALE);
  });

  it("Z values are divided by RENDER_SCALE", () => {
    expect(boxValueToReal("minZ", 8)).toBeCloseTo(8 / RENDER_SCALE);
    expect(boxValueToReal("maxZ", -4)).toBeCloseTo(-4 / RENDER_SCALE);
  });
});

// ---------------------------------------------------------------------------
// faceToPercent / percentToFace
// ---------------------------------------------------------------------------

describe("faceToPercent", () => {
  const bounds = getFullRoomBounds();

  it("min value → 0%", () => {
    expect(faceToPercent("minX", bounds.minX)).toBeCloseTo(0);
    expect(faceToPercent("minY", bounds.minY)).toBeCloseTo(0);
    expect(faceToPercent("minZ", bounds.minZ)).toBeCloseTo(0);
  });

  it("max value → 100%", () => {
    expect(faceToPercent("maxX", bounds.maxX)).toBeCloseTo(100);
    expect(faceToPercent("maxY", bounds.maxY)).toBeCloseTo(100);
    expect(faceToPercent("maxZ", bounds.maxZ)).toBeCloseTo(100);
  });

  it("midpoint → 50%", () => {
    expect(faceToPercent("minX", 0)).toBeCloseTo(50);
    expect(faceToPercent("minZ", 0)).toBeCloseTo(50);
  });
});

describe("percentToFace", () => {
  const bounds = getFullRoomBounds();

  it("0% → min value", () => {
    expect(percentToFace("minX", 0)).toBeCloseTo(bounds.minX);
    expect(percentToFace("minY", 0)).toBeCloseTo(bounds.minY);
  });

  it("100% → max value", () => {
    expect(percentToFace("maxX", 100)).toBeCloseTo(bounds.maxX);
    expect(percentToFace("maxY", 100)).toBeCloseTo(bounds.maxY);
  });

  it("round-trip: percent → face → percent", () => {
    const percent = 37.5;
    const value = percentToFace("minX", percent);
    const back = faceToPercent("minX", value);
    expect(back).toBeCloseTo(percent);
  });
});

// ---------------------------------------------------------------------------
// faceLabel
// ---------------------------------------------------------------------------

describe("faceLabel", () => {
  it("returns human-readable labels for all faces", () => {
    expect(faceLabel("minX")).toBe("Left");
    expect(faceLabel("maxX")).toBe("Right");
    expect(faceLabel("minY")).toBe("Bottom");
    expect(faceLabel("maxY")).toBe("Top");
    expect(faceLabel("minZ")).toBe("Back");
    expect(faceLabel("maxZ")).toBe("Front");
  });
});
