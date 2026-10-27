import { afterEach, describe, expect, it } from "vitest";
import { probeGpu, resetGpuProbeForTests } from "../gpu-class.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { governedRender, nextQualityRung, profilePixelRatio, readRenderDeviceContext, rebuildsPipeline, RENDER_PROFILES, selectRenderProfile, type QualityRung, type RenderProfile } from "../render-quality.js";

/** Every rung a profile gives up, in order, when each step is held up by `held`. */
function ladder(profile: RenderProfile, baseRatio: number, held: "cpu" | "gpu"): QualityRung[] {
  const given: QualityRung[] = [];
  for (let rung = nextQualityRung(profile, baseRatio, given, held); rung !== null; rung = nextQualityRung(profile, baseRatio, given, held)) {
    given.push(rung);
  }
  return given;
}

describe("bloom in motion", () => {
  it("pauses on phones only, whose slowed CPUs spend half a frame on its passes", () => {
    expect(RENDER_PROFILES.phone.bloomInMotion).toBe(false);
    expect(RENDER_PROFILES.tablet.bloomInMotion).toBe(true);
    expect(RENDER_PROFILES.desktop.bloomInMotion).toBe(true);
  });
});

describe("nextQualityRung", () => {
  it("gives up a GPU-bound phone's resolution to 1, and keeps multisampling and its still view's bloom", () => {
    expect(ladder(RENDER_PROFILES.phone, 2, "gpu")).toEqual(["resolution", "resolution", "resolution", "resolution"]);
  });

  it("gives up a GPU-bound tablet's occlusion, its resolution to 1.5, then bloom, then resolution to 1", () => {
    expect(ladder(RENDER_PROFILES.tablet, 2, "gpu")).toEqual(["ambientOcclusion", "resolution", "resolution", "bloom", "resolution", "resolution"]);
  });

  it("gives up ambient occlusion first where a profile has it", () => {
    expect(nextQualityRung(RENDER_PROFILES.desktop, 2, [], "gpu")).toBe("ambientOcclusion");
  });

  it("leaves a desktop at 1x a resolution rung, to 0.75, once occlusion and bloom are given up", () => {
    expect(ladder(RENDER_PROFILES.desktop, 1, "gpu")).toEqual(["ambientOcclusion", "bloom", "resolution"]);
    expect(nextQualityRung(RENDER_PROFILES.desktop, 1, ["ambientOcclusion", "bloom"], "gpu")).toBe("resolution");
    expect(nextQualityRung(RENDER_PROFILES.desktop, 1, ["ambientOcclusion", "bloom", "resolution"], "gpu")).toBeNull();
    expect(ladder(RENDER_PROFILES.office, 1, "gpu")).toEqual(["bloom", "resolution"]);
  });

  it("gives up passes, never pixels, for frames held up by the CPU", () => {
    expect(ladder(RENDER_PROFILES.desktop, 2, "cpu")).toEqual(["bloom", "ambientOcclusion"]);
    // Once the CPU's passes are gone, a GPU-held frame still finds its pixels.
    expect(nextQualityRung(RENDER_PROFILES.desktop, 2, ["bloom", "ambientOcclusion"], "gpu")).toBe("resolution");
  });

  it("never gives up bloom where it pauses in motion: the frames it judges were drawn without it", () => {
    expect(ladder(RENDER_PROFILES.phone, 2, "cpu")).toEqual([]);
    expect(nextQualityRung(RENDER_PROFILES.phone, 2, [], "gpu")).toBe("resolution");
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

  it("never draws below the profile's floor, nor below a base already under it", () => {
    const nine = Array.from({ length: 9 }, (): QualityRung => "resolution");
    expect(governedRender(RENDER_PROFILES.phone, 2, nine).pixelRatio).toBe(1);
    expect(governedRender(RENDER_PROFILES.desktop, 1, nine).pixelRatio).toBe(0.75);
    expect(governedRender(RENDER_PROFILES.office, 1, ["resolution"]).pixelRatio).toBe(0.75);
    expect(governedRender(RENDER_PROFILES.desktop, 0.5, nine).pixelRatio).toBe(0.5);
  });
});

describe("selectRenderProfile", () => {
  it("gives a mouse-driven screen the desktop profile", () => {
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 390, override: null }).name).toBe("desktop");
  });

  it("starts a desktop on integrated graphics or WebGL2 on the office profile, never a phone or a tablet", () => {
    const office = selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: null, weakGpu: true });
    expect(office.name).toBe("office");
    expect(office.ambientOcclusion).toBeNull();
    expect(office.antiAlias).toBe("temporal");
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: null, weakGpu: false }).name).toBe("desktop");
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 393, override: null, weakGpu: true }).name).toBe("phone");
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 820, override: null, weakGpu: true }).name).toBe("tablet");
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "office" }).name).toBe("office");
  });

  it("tells phones from tablets by the screen's shorter side", () => {
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 393, override: null }).name).toBe("phone");
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 820, override: null }).name).toBe("tablet");
  });

  it("honours a known override and ignores an unknown one", () => {
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "phone" }).name).toBe("phone");
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "ultra" }).name).toBe("desktop");
  });

  it("keeps a phone's bloom in motion until the lean motion pipeline is switched on", () => {
    const phone = { coarsePointer: true, shortSide: 393, override: null } as const;
    const kept = selectRenderProfile(phone);
    expect(kept.name).toBe("phone");
    expect(kept.bloomInMotion).toBe(true);
    expect(selectRenderProfile({ ...phone, leanMotion: false })).toBe(kept);
    expect(selectRenderProfile({ ...phone, leanMotion: true })).toBe(RENDER_PROFILES.phone);
    expect(selectRenderProfile({ coarsePointer: false, shortSide: 1080, override: "phone", leanMotion: true })).toBe(RENDER_PROFILES.phone);
    // A profile that draws bloom in motion anyway is the same either way.
    expect(selectRenderProfile({ coarsePointer: true, shortSide: 820, override: null, leanMotion: false })).toBe(RENDER_PROFILES.tablet);
  });
});

describe("readRenderDeviceContext", () => {
  afterEach(() => { setPlannerFeaturesForTesting(null); });

  afterEach(() => { resetGpuProbeForTests(); });

  it("reads whether the graphics are weak once the probe has answered (lib/gpu-class.ts)", async () => {
    const adapter = { info: { vendor: "intel", architecture: "gen-9", description: "Intel(R) UHD Graphics 620" } };
    Object.defineProperty(navigator, "gpu", { configurable: true, value: { requestAdapter: () => Promise.resolve(adapter) } });
    try {
      expect(readRenderDeviceContext(false).weakGpu, "no answer yet: the desktop profile as before").toBe(false);
      await probeGpu();
      const device = readRenderDeviceContext(false);
      expect(device.weakGpu).toBe(true);
      // The office PC at a 1080p screen scaled to 125 %: no occlusion, and within the office budget.
      const profile = selectRenderProfile(device);
      expect(profile.ambientOcclusion).toBeNull();
      const ratio = profilePixelRatio(profile, 1.25, 1536, 864);
      expect(1536 * 864 * ratio * ratio).toBeLessThanOrEqual((profile.pixelBudget ?? 0) + 1);
    } finally {
      Reflect.deleteProperty(navigator, "gpu");
    }
  });

  it("reads the lean motion pipeline's switch (lib/planner-features.ts)", () => {
    setPlannerFeaturesForTesting({ leanMotionPipeline: true });
    expect(readRenderDeviceContext(false).leanMotion).toBe(true);
    setPlannerFeaturesForTesting({ leanMotionPipeline: false });
    expect(readRenderDeviceContext(false).leanMotion).toBe(false);
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

  it("keeps a desktop within about 5 MP, never below 1x", () => {
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 2, 3840, 2160)).toBe(1);
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 3, 1600, 900)).toBeCloseTo(Math.sqrt(5_000_000 / (1600 * 900)), 6);
    expect(profilePixelRatio(RENDER_PROFILES.desktop, 1, 1920, 1080)).toBe(1);
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
