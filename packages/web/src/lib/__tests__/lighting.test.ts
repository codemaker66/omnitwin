import { describe, it, expect } from "vitest";
import {
  getHemisphereLightConfig,
  shouldUseLightmap,
  createPlaceholderLightmapData,
  LIGHTMAP_SIZE,
  type HemisphereLightConfig,
} from "../lighting.js";
import type { DeviceTier } from "../device-tier.js";

// ---------------------------------------------------------------------------
// Hemisphere light configuration
// ---------------------------------------------------------------------------

describe("getHemisphereLightConfig", () => {
  const tiers: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

  for (const tier of tiers) {
    it(`returns valid config for ${tier} tier`, () => {
      const config = getHemisphereLightConfig(tier);
      expect(config.skyColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(config.groundColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(config.intensity).toBeGreaterThan(0);
    });
  }

  it("intensity increases monotonically with tier", () => {
    const poster = getHemisphereLightConfig("poster").intensity;
    const low = getHemisphereLightConfig("low").intensity;
    const medium = getHemisphereLightConfig("medium").intensity;
    const high = getHemisphereLightConfig("high").intensity;
    expect(poster).toBeLessThan(low);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("all tiers share the same sky and ground colours", () => {
    const configs = tiers.map(getHemisphereLightConfig);
    const skyColors = new Set(configs.map((c: HemisphereLightConfig) => c.skyColor));
    const groundColors = new Set(configs.map((c: HemisphereLightConfig) => c.groundColor));
    expect(skyColors.size).toBe(1);
    expect(groundColors.size).toBe(1);
  });

  it("sky colour differs from ground colour", () => {
    const config = getHemisphereLightConfig("medium");
    expect(config.skyColor).not.toBe(config.groundColor);
  });

  it("poster tier intensity is positive (surfaces still visible)", () => {
    expect(getHemisphereLightConfig("poster").intensity).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// shouldUseLightmap
// ---------------------------------------------------------------------------

describe("shouldUseLightmap", () => {
  it("returns false for poster", () => {
    expect(shouldUseLightmap("poster")).toBe(false);
  });

  it("returns false for low", () => {
    expect(shouldUseLightmap("low")).toBe(false);
  });

  it("returns true for medium", () => {
    expect(shouldUseLightmap("medium")).toBe(true);
  });

  it("returns true for high", () => {
    expect(shouldUseLightmap("high")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LIGHTMAP_SIZE constant
// ---------------------------------------------------------------------------

describe("LIGHTMAP_SIZE", () => {
  it("is a positive power of 2", () => {
    expect(LIGHTMAP_SIZE).toBeGreaterThan(0);
    expect(Math.log2(LIGHTMAP_SIZE) % 1).toBe(0);
  });

  it("is at least 16 pixels (minimum useful resolution)", () => {
    expect(LIGHTMAP_SIZE).toBeGreaterThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// createPlaceholderLightmapData
// ---------------------------------------------------------------------------

describe("createPlaceholderLightmapData", () => {
  it("returns correct byte length for given dimensions", () => {
    const data = createPlaceholderLightmapData(16, 16);
    expect(data.length).toBe(16 * 16 * 4);
  });

  it("returns Uint8Array", () => {
    const data = createPlaceholderLightmapData(8, 8);
    expect(data).toBeInstanceOf(Uint8Array);
  });

  it("all pixel values are in 0–255 range", () => {
    const data = createPlaceholderLightmapData(32, 32);
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      expect(value).toBeDefined();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it("all alpha values are 255 (fully opaque)", () => {
    const data = createPlaceholderLightmapData(16, 16);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });

  it("center pixel is brighter than corner pixel", () => {
    const size = 32;
    const data = createPlaceholderLightmapData(size, size);

    const cx = Math.floor((size - 1) / 2);
    const centerIdx = (cx * size + cx) * 4;
    const cornerIdx = 0; // top-left corner

    const centerBrightness = data[centerIdx] ?? -1;
    const cornerBrightness = data[cornerIdx] ?? -1;
    expect(centerBrightness).toBeGreaterThan(cornerBrightness);
  });

  it("center pixel has maximum brightness (255)", () => {
    const size = 65; // odd size → exact center pixel
    const data = createPlaceholderLightmapData(size, size);

    const cx = (size - 1) / 2; // 32
    const centerIdx = (cx * size + cx) * 4;
    expect(data[centerIdx]).toBe(255);
  });

  it("corner pixel has minimum brightness (180)", () => {
    const size = 64;
    const data = createPlaceholderLightmapData(size, size);

    // Top-left corner (0, 0) — maximum distance from center
    expect(data[0]).toBe(180);
  });

  it("produces symmetric output (top-left equals bottom-right)", () => {
    const size = 32;
    const data = createPlaceholderLightmapData(size, size);

    const tl = 0;
    const br = ((size - 1) * size + (size - 1)) * 4;
    expect(data[tl]).toBe(data[br]);
  });

  it("produces symmetric output (top-right equals bottom-left)", () => {
    const size = 32;
    const data = createPlaceholderLightmapData(size, size);

    const tr = (size - 1) * 4;
    const bl = ((size - 1) * size) * 4;
    expect(data[tr]).toBe(data[bl]);
  });

  it("RGB channels are equal at every pixel (greyscale)", () => {
    const data = createPlaceholderLightmapData(16, 16);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(data[i + 1]); // R == G
      expect(data[i + 1]).toBe(data[i + 2]); // G == B
    }
  });

  it("handles 1×1 texture (single pixel at max brightness)", () => {
    const data = createPlaceholderLightmapData(1, 1);
    expect(data.length).toBe(4);
    expect(data[0]).toBe(255); // R
    expect(data[1]).toBe(255); // G
    expect(data[2]).toBe(255); // B
    expect(data[3]).toBe(255); // A
  });

  it("handles non-square dimensions", () => {
    const data = createPlaceholderLightmapData(8, 16);
    expect(data.length).toBe(8 * 16 * 4);
  });

  it("brightness decreases monotonically from center to edge along a row", () => {
    const size = 64;
    const data = createPlaceholderLightmapData(size, size);

    const midRow = Math.floor((size - 1) / 2);
    const midCol = Math.floor((size - 1) / 2);

    // Walk from center to right edge
    let prev = data[(midRow * size + midCol) * 4] ?? -1;
    for (let x = midCol + 1; x < size; x++) {
      const current = data[(midRow * size + x) * 4] ?? -1;
      expect(current).toBeLessThanOrEqual(prev);
      prev = current;
    }
  });

  it("brightness decreases monotonically from center to edge along a column", () => {
    const size = 64;
    const data = createPlaceholderLightmapData(size, size);

    const midRow = Math.floor((size - 1) / 2);
    const midCol = Math.floor((size - 1) / 2);

    // Walk from center to bottom edge
    let prev = data[(midRow * size + midCol) * 4] ?? -1;
    for (let y = midRow + 1; y < size; y++) {
      const current = data[(y * size + midCol) * 4] ?? -1;
      expect(current).toBeLessThanOrEqual(prev);
      prev = current;
    }
  });

  it("LIGHTMAP_SIZE produces expected data length", () => {
    const data = createPlaceholderLightmapData(LIGHTMAP_SIZE, LIGHTMAP_SIZE);
    expect(data.length).toBe(LIGHTMAP_SIZE * LIGHTMAP_SIZE * 4);
  });
});
