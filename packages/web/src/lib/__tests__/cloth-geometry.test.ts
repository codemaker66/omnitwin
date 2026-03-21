import { describe, it, expect } from "vitest";
import {
  computeRoundClothGeometry,
  computeRectClothGeometry,
  computeFoldDisplacement,
  computeFoldDerivative,
  smoothstep,
  CLOTH_COLOR,
  FOLD_COUNT,
} from "../cloth-geometry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("cloth constants", () => {
  it("CLOTH_COLOR is a hex string", () => {
    expect(CLOTH_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("FOLD_COUNT is a positive integer", () => {
    expect(FOLD_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(FOLD_COUNT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// smoothstep
// ---------------------------------------------------------------------------

describe("smoothstep", () => {
  it("returns 0 below edge0", () => {
    expect(smoothstep(0, 0.2, 0.8)).toBe(0);
  });

  it("returns 1 above edge1", () => {
    expect(smoothstep(1, 0.2, 0.8)).toBe(1);
  });

  it("returns 0.5 at midpoint", () => {
    expect(smoothstep(0.5, 0, 1)).toBe(0.5);
  });

  it("returns 0 at edge0", () => {
    expect(smoothstep(0.2, 0.2, 0.8)).toBe(0);
  });

  it("returns 1 at edge1", () => {
    expect(smoothstep(0.8, 0.2, 0.8)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeFoldDisplacement
// ---------------------------------------------------------------------------

describe("computeFoldDisplacement", () => {
  it("returns 0 when amplitude is 0", () => {
    expect(computeFoldDisplacement(1.0, 0)).toBe(0);
  });

  it("oscillates with non-zero amplitude", () => {
    const values = Array.from({ length: 32 }, (_, i) =>
      computeFoldDisplacement((i / 32) * Math.PI * 2, 0.05),
    );
    const hasPositive = values.some((v) => v > 0.001);
    const hasNegative = values.some((v) => v < -0.001);
    expect(hasPositive).toBe(true);
    expect(hasNegative).toBe(true);
  });

  it("displacement magnitude scales with amplitude", () => {
    const small = Math.abs(computeFoldDisplacement(1.0, 0.01));
    const large = Math.abs(computeFoldDisplacement(1.0, 0.10));
    expect(large).toBeGreaterThan(small);
  });
});

// ---------------------------------------------------------------------------
// computeFoldDerivative
// ---------------------------------------------------------------------------

describe("computeFoldDerivative", () => {
  it("returns 0 when amplitude is 0", () => {
    expect(computeFoldDerivative(1.0, 0)).toBeCloseTo(0);
  });

  it("returns non-zero for non-zero amplitude", () => {
    expect(Math.abs(computeFoldDerivative(0.5, 0.05))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeRoundClothGeometry
// ---------------------------------------------------------------------------

describe("computeRoundClothGeometry", () => {
  const radSegs = 16;
  const discRings = 4;
  const skirtRings = 8;
  const result = computeRoundClothGeometry(1.83, 0.76, radSegs, discRings, skirtRings, 0.05);

  it("returns Float32Array for positions", () => {
    expect(result.positions).toBeInstanceOf(Float32Array);
  });

  it("returns Float32Array for normals", () => {
    expect(result.normals).toBeInstanceOf(Float32Array);
  });

  it("returns Float32Array for uvs", () => {
    expect(result.uvs).toBeInstanceOf(Float32Array);
  });

  it("returns Uint32Array for indices", () => {
    expect(result.indices).toBeInstanceOf(Uint32Array);
  });

  it("has correct total vertex count", () => {
    const stride = radSegs + 1;
    const discVerts = (discRings + 1) * stride;
    const skirtVerts = skirtRings * stride;
    expect(result.positions.length).toBe((discVerts + skirtVerts) * 3);
  });

  it("normals same length as positions", () => {
    expect(result.normals.length).toBe(result.positions.length);
  });

  it("uvs has 2/3 the entries of positions", () => {
    expect(result.uvs.length).toBe((result.positions.length / 3) * 2);
  });

  it("no NaN in positions", () => {
    for (let i = 0; i < result.positions.length; i++) {
      expect(Number.isNaN(result.positions[i])).toBe(false);
    }
  });

  it("no NaN in normals", () => {
    for (let i = 0; i < result.normals.length; i++) {
      expect(Number.isNaN(result.normals[i])).toBe(false);
    }
  });

  it("centre disc vertex is at table height", () => {
    // First vertex (ring=0, seg=0) should be at centre
    const y = result.positions[1];
    expect(y).toBeDefined();
    expect(y as number).toBeGreaterThan(0.76);
    expect(y as number).toBeLessThan(0.80);
  });

  it("bottom skirt vertices are near floor", () => {
    // Last ring of skirt should be at y ≈ 0
    const lastVertStart = result.positions.length - (radSegs + 1) * 3;
    const y = result.positions[lastVertStart + 1];
    expect(y).toBeDefined();
    expect(y as number).toBeCloseTo(0, 1);
  });

  it("skirt vertices have radius near table radius", () => {
    // First skirt ring vertex (just after disc)
    const stride = radSegs + 1;
    const discVerts = (discRings + 1) * stride;
    const idx = discVerts * 3;
    const x = result.positions[idx] as number;
    const z = result.positions[idx + 2] as number;
    const r = Math.sqrt(x * x + z * z);
    // Should be close to table radius (1.83) with small fold displacement
    expect(r).toBeGreaterThan(1.7);
    expect(r).toBeLessThan(2.0);
  });
});

// ---------------------------------------------------------------------------
// computeRectClothGeometry
// ---------------------------------------------------------------------------

describe("computeRectClothGeometry", () => {
  const segX = 8;
  const segZ = 8;
  const skirtRings = 8;
  const result = computeRectClothGeometry(3.66, 1.52, 0.74, segX, segZ, skirtRings, 0.04);

  it("returns Float32Array for positions", () => {
    expect(result.positions).toBeInstanceOf(Float32Array);
  });

  it("returns Uint32Array for indices", () => {
    expect(result.indices).toBeInstanceOf(Uint32Array);
  });

  it("no NaN in positions", () => {
    for (let i = 0; i < result.positions.length; i++) {
      expect(Number.isNaN(result.positions[i])).toBe(false);
    }
  });

  it("no NaN in normals", () => {
    for (let i = 0; i < result.normals.length; i++) {
      expect(Number.isNaN(result.normals[i])).toBe(false);
    }
  });

  it("centre top vertex is at table height", () => {
    // Centre of top grid: row segZ/2, col segX/2
    const stride = segX + 1;
    const centreIdx = ((segZ / 2) * stride + segX / 2) * 3 + 1;
    const y = result.positions[centreIdx];
    expect(y).toBeDefined();
    expect(y as number).toBeGreaterThan(0.74);
    expect(y as number).toBeLessThan(0.78);
  });
});
