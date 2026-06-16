import { describe, expect, it } from "vitest";
import { Color, NormalBlending, ShaderMaterial } from "three";
import {
  RADIAL_GLOW_TEXTURE_SIZE,
  advanceFlowRibbonTime,
  buildRadialGlowData,
  createFlowRibbonMaterial,
  getFlowRibbonMaterial,
  getRadialGlowTexture,
} from "../cockpit-overlay-materials.js";

describe("createFlowRibbonMaterial", () => {
  it("is a normal-blended, depth-test-off, transparent shader material", () => {
    const material = createFlowRibbonMaterial();
    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(NormalBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(false);
  });

  it("exposes the animation uniforms with sane defaults", () => {
    const { uniforms } = createFlowRibbonMaterial();
    expect(uniforms.uTime?.value).toBe(0);
    expect(uniforms.uColor?.value).toBeInstanceOf(Color);
    expect(uniforms.uPulseColor?.value).toBeInstanceOf(Color);
    expect((uniforms.uSpeed?.value as number) > 0).toBe(true);
    expect((uniforms.uWavelength?.value as number) > 0).toBe(true);
  });

  it("references the per-vertex arc-length attribute so the pulse keeps a constant wavelength", () => {
    const material = createFlowRibbonMaterial();
    expect(material.vertexShader).toContain("attribute float aDist");
    expect(material.fragmentShader).toContain("uWavelength");
  });
});

describe("getFlowRibbonMaterial", () => {
  it("returns the same shared instance across calls", () => {
    expect(getFlowRibbonMaterial()).toBe(getFlowRibbonMaterial());
  });
});

describe("advanceFlowRibbonTime", () => {
  it("accumulates elapsed seconds into the uTime uniform", () => {
    const material = createFlowRibbonMaterial();
    advanceFlowRibbonTime(material, 0.5);
    advanceFlowRibbonTime(material, 0.25);
    expect((material.uniforms.uTime?.value as number)).toBeCloseTo(0.75, 6);
  });
});

describe("buildRadialGlowData", () => {
  it("returns one RGBA quad per texel", () => {
    const size = RADIAL_GLOW_TEXTURE_SIZE;
    expect(buildRadialGlowData(size)).toHaveLength(size * size * 4);
  });

  it("is opaque white at the centre and transparent at the corners", () => {
    const size = 64;
    const data = buildRadialGlowData(size);
    const centre = Math.floor(size / 2);
    const centreAlpha = data[(centre * size + centre) * 4 + 3] ?? -1;
    const cornerAlpha = data[(0 * size + 0) * 4 + 3] ?? -1;
    expect(centreAlpha).toBeGreaterThan(240);
    expect(cornerAlpha).toBe(0);
    // White RGB everywhere; only alpha carries the shape.
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("falls off monotonically from centre outward along a row", () => {
    const size = 64;
    const data = buildRadialGlowData(size);
    const row = Math.floor(size / 2);
    const centre = Math.floor(size / 2);
    let prev = Infinity;
    for (let x = centre; x < size; x += 1) {
      const alpha = data[(row * size + x) * 4 + 3] ?? 0;
      expect(alpha).toBeLessThanOrEqual(prev);
      prev = alpha;
    }
  });
});

describe("getRadialGlowTexture", () => {
  it("returns a shared square texture of the configured size", () => {
    const texture = getRadialGlowTexture();
    expect(texture).toBe(getRadialGlowTexture());
    expect(texture.image.width).toBe(RADIAL_GLOW_TEXTURE_SIZE);
    expect(texture.image.height).toBe(RADIAL_GLOW_TEXTURE_SIZE);
  });
});
