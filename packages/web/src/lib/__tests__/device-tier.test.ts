import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyDevice,
  getQualitySettings,
  getGpuRenderer,
  type DeviceTier,
} from "../device-tier.js";
import { useDeviceStore } from "../../stores/device-store.js";

// ---------------------------------------------------------------------------
// Real GPU strings → expected tier (from research)
// ---------------------------------------------------------------------------

describe("classifyDevice — real GPU strings", () => {
  const cases: readonly [string, DeviceTier][] = [
    // --- Poster tier ---
    ["Google SwiftShader", "poster"],
    ["SwiftShader", "poster"],
    ["llvmpipe (LLVM 12.0.0, 256 bits)", "poster"],
    ["Mesa Software Rasterizer", "poster"],

    // --- Low tier ---
    ["Mali-G68 MP2", "low"],
    ["Mali-G52 MC2", "low"],
    ["Mali-T880", "low"],
    ["Adreno (TM) 530", "low"],
    ["Adreno (TM) 512", "low"],
    ["PowerVR Rogue GE8320", "low"],
    ["Intel(R) HD Graphics 400", "low"],

    // --- Medium tier ---
    ["Intel(R) HD Graphics 630", "medium"],
    ["Intel(R) HD Graphics 520", "medium"],
    ["Intel(R) UHD Graphics 620", "medium"],
    ["Intel(R) UHD Graphics 770", "medium"],
    ["Intel(R) Iris(R) Xe Graphics", "medium"],
    ["Intel(R) Iris(TM) Plus Graphics 640", "medium"],
    ["Adreno (TM) 650", "medium"],
    ["Adreno (TM) 660", "medium"],
    ["Mali-G78 MP24", "medium"],
    ["Mali-G72 MP12", "medium"],

    // --- High tier ---
    ["Apple GPU", "high"],
    ["Apple M1 Pro", "high"],
    ["Apple M2 Max", "high"],
    ["NVIDIA GeForce RTX 4080", "high"],
    ["NVIDIA GeForce RTX 3060 Ti", "high"],
    ["NVIDIA GeForce GTX 1660 Super", "high"],
    ["NVIDIA GeForce RTX 2070", "high"],
    ["AMD Radeon RX 6800 XT", "high"],
    ["AMD Radeon RX 7900 XTX", "high"],
    ["AMD Radeon Pro 5500M", "high"],
    ["Adreno (TM) 730", "high"],
  ];

  for (const [gpu, expected] of cases) {
    it(`"${gpu}" → ${expected}`, () => {
      expect(classifyDevice(gpu)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("classifyDevice — edge cases", () => {
  it("returns poster for empty string", () => {
    expect(classifyDevice("")).toBe("poster");
  });

  it("returns poster for whitespace-only string", () => {
    expect(classifyDevice("   ")).toBe("poster");
  });

  it("returns low for unrecognised GPU", () => {
    expect(classifyDevice("Unknown Vendor Mystery GPU")).toBe("low");
  });

  it("is case-insensitive", () => {
    expect(classifyDevice("nvidia geforce rtx 4090")).toBe("high");
    expect(classifyDevice("SWIFTSHADER")).toBe("poster");
    expect(classifyDevice("apple gpu")).toBe("high");
  });

  it("handles leading/trailing whitespace", () => {
    expect(classifyDevice("  NVIDIA GeForce RTX 3080  ")).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Quality settings
// ---------------------------------------------------------------------------

describe("getQualitySettings", () => {
  const tiers: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

  for (const tier of tiers) {
    it(`returns valid settings for ${tier} tier`, () => {
      const settings = getQualitySettings(tier);
      expect(settings.dpr[0]).toBeGreaterThanOrEqual(1);
      expect(settings.dpr[1]).toBeGreaterThanOrEqual(settings.dpr[0]);
      expect(settings.maxTriangles).toBeGreaterThanOrEqual(0);
      expect(settings.textureScale).toBeGreaterThan(0);
      expect(settings.textureScale).toBeLessThanOrEqual(1);
      expect(settings.targetFrameTimeMs).toBeGreaterThan(0);
    });
  }

  it("poster has zero maxTriangles (static image only)", () => {
    const settings = getQualitySettings("poster");
    expect(settings.maxTriangles).toBe(0);
    expect(settings.envMap).toBe(false);
    expect(settings.antialias).toBe(false);
  });

  it("low has no antialiasing and no env map", () => {
    const settings = getQualitySettings("low");
    expect(settings.antialias).toBe(false);
    expect(settings.envMap).toBe(false);
  });

  it("high has full DPR range, antialiasing, and env map", () => {
    const settings = getQualitySettings("high");
    expect(settings.dpr).toEqual([1, 2]);
    expect(settings.antialias).toBe(true);
    expect(settings.envMap).toBe(true);
    expect(settings.textureScale).toBe(1.0);
  });

  it("maxTriangles increases with tier", () => {
    const poster = getQualitySettings("poster").maxTriangles;
    const low = getQualitySettings("low").maxTriangles;
    const medium = getQualitySettings("medium").maxTriangles;
    const high = getQualitySettings("high").maxTriangles;
    expect(poster).toBeLessThan(low);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("targets 60fps for medium and high tiers", () => {
    expect(getQualitySettings("medium").targetFrameTimeMs).toBeCloseTo(16.67, 0);
    expect(getQualitySettings("high").targetFrameTimeMs).toBeCloseTo(16.67, 0);
  });

  it("targets 30fps for poster and low tiers", () => {
    expect(getQualitySettings("poster").targetFrameTimeMs).toBeCloseTo(33.33, 0);
    expect(getQualitySettings("low").targetFrameTimeMs).toBeCloseTo(33.33, 0);
  });
});

// ---------------------------------------------------------------------------
// getGpuRenderer
// ---------------------------------------------------------------------------

describe("getGpuRenderer", () => {
  it("returns null when WEBGL_debug_renderer_info is unavailable", () => {
    const gl = {
      getExtension: () => null,
    } as unknown as WebGLRenderingContext;
    expect(getGpuRenderer(gl)).toBeNull();
  });

  it("returns renderer string when extension is available", () => {
    const gl = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
      getParameter: (param: number) => {
        if (param === 0x9246) return "NVIDIA GeForce RTX 4090";
        return null;
      },
    } as unknown as WebGLRenderingContext;
    expect(getGpuRenderer(gl)).toBe("NVIDIA GeForce RTX 4090");
  });
});

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

describe("useDeviceStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useDeviceStore.setState({
      tier: "low",
      quality: getQualitySettings("low"),
      gpuRenderer: null,
      detected: false,
    });
  });

  it("defaults to low tier before detection", () => {
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("low");
    expect(state.detected).toBe(false);
    expect(state.gpuRenderer).toBeNull();
  });

  it("detect() classifies GPU string and updates state", () => {
    useDeviceStore.getState().detect("NVIDIA GeForce RTX 4080");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("high");
    expect(state.detected).toBe(true);
    expect(state.gpuRenderer).toBe("NVIDIA GeForce RTX 4080");
    expect(state.quality.dpr).toEqual([1, 2]);
  });

  it("detect() with SwiftShader sets poster tier", () => {
    useDeviceStore.getState().detect("Google SwiftShader");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("poster");
    expect(state.quality.maxTriangles).toBe(0);
  });

  it("override() sets tier without GPU string", () => {
    useDeviceStore.getState().override("high");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("high");
    expect(state.detected).toBe(true);
    expect(state.gpuRenderer).toBeNull();
    expect(state.quality.envMap).toBe(true);
  });

  it("override() replaces previously detected tier", () => {
    useDeviceStore.getState().detect("Google SwiftShader");
    expect(useDeviceStore.getState().tier).toBe("poster");

    useDeviceStore.getState().override("medium");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("medium");
    expect(state.quality.antialias).toBe(true);
  });

  it("quality settings match the detected tier", () => {
    useDeviceStore.getState().detect("Intel(R) UHD Graphics 620");
    const state = useDeviceStore.getState();
    expect(state.tier).toBe("medium");
    expect(state.quality).toEqual(getQualitySettings("medium"));
  });
});
