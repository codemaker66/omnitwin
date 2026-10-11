import { describe, expect, it } from "vitest";
import { governedRender, nextQualityRung, profilePixelRatio, rebuildsPipeline, RENDER_PROFILES, selectRenderProfile, type QualityRung, type RenderProfile } from "../render-quality.js";

/** Every rung a profile gives up, in order, when each step is held up by `held`. */
function ladder(profile: RenderProfile, baseRatio: number, held: "cpu" | "gpu"): QualityRung[] {
  const given: QualityRung[] = [];
  for (let rung = nextQualityRung(profile, baseRatio, given, held); rung !== null; rung = nextQualityRung(profile, baseRatio, given, held)) {
    given.push(rung);
  }
  return given;
}

describe("nextQualityRung", () => {
  it("gives up a GPU-bound phone's resolution to 1.5, then bloom, then resolution to 1, and keeps multisampling", () => {
    expect(ladder(RENDER_PROFILES.phone, 2, "gpu")).toEqual(["resolution", "resolution", "bloom", "resolution", "resolution"]);
  });

  it("gives up ambient occlusion first where a profile has it", () => {
    expect(nextQualityRung(RENDER_PROFILES.desktop, 2, [], "gpu")).toBe("ambientOcclusion");
    expect(ladder(RENDER_PROFILES.desktop, 1, "gpu")).toEqual(["ambientOcclusion", "bloom"]);
  });

  it("gives up passes, never pixels, for frames held up by the CPU", () => {
    expect(ladder(RENDER_PROFILES.phone, 2, "cpu")).toEqual(["bloom"]);
    expect(ladder(RENDER_PROFILES.desktop, 2, "cpu")).toEqual(["bloom", "ambientOcclusion"]);
    // Once the CPU's passes are gone, a GPU-held frame still finds its pixels.
    expect(nextQualityRung(RENDER_PROFILES.phone, 2, ["bloom"], "gpu")).toBe("resolution");
  });

  it("has nothing to give up from a plain scene at 1x", () => {
    expect(nextQualityRung(RENDER_PROFILES.off, 1, [], "gpu")).toBeNull();
  });

  it("knows which rungs rebuild the pipeline and must wait for a still view", () => {
    expect(rebuildsPipeline("resolution")).toBe(false);
    expect(rebuildsPipeline("bloom")).toBe(true);
    expect(rebuildsPipeline("ambientOcclusion")).toBe(true);
  });
});

describe("governedRender", () => {
  it("keeps the same profile through resolution steps, so the pipeline is not rebuilt", () => {
    const phone = RENDER_PROFILES.phone;
    expect(governedRender(phone, 2, [])).toEqual({ profile: phone, pixelRatio: 2 });
    const two = governedRender(phone, 2, ["resolution", "resolution"]);
    expect(two.profile).toBe(phone);
    expect(two.pixelRatio).toBe(1.5);
  });

  it("drops an effect once it is given up, with one derived profile per set of effects", () => {
    const phone = RENDER_PROFILES.phone;
    const noBloom = governedRender(phone, 2, ["resolution", "resolution", "bloom"]);
    expect(noBloom.profile.bloom).toBeNull();
    expect(noBloom.profile.sceneSamples).toBe(phone.sceneSamples);
    // A resolution step after it keeps the same derived profile.
    expect(governedRender(phone, 2, ["bloom", "resolution", "resolution", "resolution"]).profile).toBe(noBloom.profile);
    expect(governedRender(phone, 2, ["resolution", "resolution", "bloom", "resolution", "resolution"]).pixelRatio).toBe(1);
    expect(governedRender(RENDER_PROFILES.desktop, 2, ["ambientOcclusion"]).profile.ambientOcclusion).toBeNull();
  });

  it("keeps the profile when a rung names an effect it never had, so nothing is rebuilt", () => {
    expect(governedRender(RENDER_PROFILES.phone, 2, ["ambientOcclusion"]).profile).toBe(RENDER_PROFILES.phone);
  });

  it("never draws below 1x, nor below a base already under it", () => {
    const nine = Array.from({ length: 9 }, (): QualityRung => "resolution");
    expect(governedRender(RENDER_PROFILES.phone, 2, nine).pixelRatio).toBe(1);
    expect(governedRender(RENDER_PROFILES.desktop, 0.75, nine).pixelRatio).toBe(0.75);
  });
});

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
