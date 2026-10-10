import { describe, expect, it } from "vitest";
import { profilePixelRatio, RENDER_PROFILES, selectRenderProfile } from "../render-quality.js";

describe("selectRenderProfile", () => {
  it("gives a mouse-driven screen the desktop profile", () => {
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 390, override: null }).name).toBe("desktop");
  });

  it("tells phones from tablets by the screen's shorter side", () => {
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 393, override: null }).name).toBe("phone");
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 820, override: null }).name).toBe("tablet");
  });

  it("honours a known override and ignores an unknown one", () => {
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "phone" }).name).toBe("phone");
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "ultra" }).name).toBe("desktop");
  });
});

describe("profilePixelRatio", () => {
  it("caps a 3x phone at 2x when its budget would allow more", () => {
    // 393 x 852 CSS pixels: the 2.2 MP budget alone would allow about 2.56x.
    expect(profilePixelRatio(RENDER_PROFILES.phone, 3, 393, 852)).toBe(2);
  });

  it("lowers density to keep a large canvas within the pixel budget", () => {
    const ratio = profilePixelRatio(RENDER_PROFILES.phone, 2, 1000, 1000);
    expect(ratio).toBeCloseTo(Math.sqrt(2.2), 6);
    expect(ratio * ratio * 1000 * 1000).toBeLessThanOrEqual(2_200_000 + 1e-6);
  });

  it("never draws below 1x from a native 1x or above, nor above native", () => {
    expect(profilePixelRatio(RENDER_PROFILES.phone, 1, 4000, 3000)).toBe(1);
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 0.75, 1600, 900)).toBe(0.75);
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 1.5, 1600, 900)).toBe(1.5);
  });

  it("gives the desktop profile no budget, only the 2x cap", () => {
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 2, 3840, 2160)).toBe(2);
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 3, 1600, 900)).toBe(2);
  });
});

describe("RENDER_PROFILES", () => {
  it("never multisamples a scene pass whose depth another pass reads", () => {
    for (const profile of Object.values(RENDER_PROFILES)) {
      const readsDepth = profile.ambientOcclusion !== null || profile.antiAlias === "temporal";
      if (readsDepth) expect(profile.sceneSamples).toBe(0);
    }
  });

  it("converges temporal anti-aliasing only where it is used", () => {
    for (const profile of Object.values(RENDER_PROFILES)) {
      if (profile.antiAlias !== "temporal") expect(profile.convergenceFrames).toBe(0);
    }
  });
});
