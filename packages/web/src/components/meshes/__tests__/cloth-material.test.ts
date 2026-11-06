import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { TABLE_CLOTH_OPACITY } from "../../../lib/table-dressing.js";
import { clothSeeThrough, setClothOpacity } from "../cloth-material.js";

// A settled cloth is opaque, so the tabletop never reads through it; only a
// cloth still arriving draws see-through, without depth writes.

describe("a cloth's pass follows its opacity", () => {
  it("is see-through only below 1, and a settled cloth is opaque", () => {
    expect(clothSeeThrough(0)).toBe(true);
    expect(clothSeeThrough(0.999)).toBe(true);
    expect(clothSeeThrough(1)).toBe(false);
    expect(TABLE_CLOTH_OPACITY).toBe(1);
    expect(clothSeeThrough(TABLE_CLOTH_OPACITY)).toBe(false);
  });

  it("changes pass, and marks the material for a rebuild, only when it crosses 1", () => {
    const material = new MeshStandardMaterial();
    const fresh = material.version;
    setClothOpacity(material, 0.2);
    expect([material.transparent, material.depthWrite, material.opacity]).toEqual([true, false, 0.2]);
    const fading = material.version;
    expect(fading).toBeGreaterThan(fresh);
    // Still fading: the opacity moves, the pass and the pipeline do not.
    setClothOpacity(material, 0.6);
    expect(material.opacity).toBe(0.6);
    expect(material.version).toBe(fading);
    setClothOpacity(material, 1);
    expect([material.transparent, material.depthWrite, material.opacity]).toEqual([false, true, 1]);
    expect(material.version).toBeGreaterThan(fading);
  });
});
