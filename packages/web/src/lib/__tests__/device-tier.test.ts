import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyDevice,
  getQualitySettings,
  getGpuRenderer,
  readDeviceEnvironment,
  type DeviceEnvironment,
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
// The device, not just the string
//
// A renderer string cannot tell a phone from a desktop, and on the two
// families that matter it actively misleads: Safari reports "Apple GPU" for an
// iPhone and for an M-series Mac alike. These pin the rule that separates
// them, in BOTH directions - a phone must come down, and a desktop must never
// be dragged down with it.
// ---------------------------------------------------------------------------

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function deviceEnv(over: Partial<DeviceEnvironment> = {}): DeviceEnvironment {
  return {
    userAgent: WINDOWS_UA,
    coarsePointer: false,
    maxTouchPoints: 0,
    deviceMemoryGb: null,
    ...over,
  };
}

describe("classifyDevice - the device behind the string", () => {
  it("leaves every verdict alone when no environment is offered", () => {
    // The planner path passes nothing, and must stay byte-identical.
    expect(classifyDevice("Apple GPU")).toBe("high");
    expect(classifyDevice("Adreno (TM) 730")).toBe("high");
    expect(classifyDevice("NVIDIA GeForce RTX 4090")).toBe("high");
  });

  it("puts an iPhone reporting Apple GPU on the mobile tier", () => {
    const tier = classifyDevice("Apple GPU", deviceEnv({
      userAgent: IPHONE_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
      deviceMemoryGb: null, // iOS does not implement it
    }));
    expect(tier).toBe("mobile");
  });

  it("leaves an M-series Mac reporting the SAME string on high", () => {
    expect(classifyDevice("Apple GPU", deviceEnv({ userAgent: MAC_UA }))).toBe("high");
  });

  it("catches an iPad even though it sends a Mac user agent", () => {
    // iPadOS's desktop-class Safari is indistinguishable by UA; the five touch
    // points and the coarse pointer are the whole tell.
    expect(classifyDevice("Apple GPU", deviceEnv({
      userAgent: IPAD_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
    }))).toBe("mobile");
  });

  it("puts an Adreno 7xx flagship phone on mobile rather than high", () => {
    expect(classifyDevice("Adreno (TM) 730", deviceEnv({
      userAgent: ANDROID_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
      deviceMemoryGb: 8,
    }))).toBe("mobile");
  });

  it("holds a low-memory Android at low, below the phone tier", () => {
    expect(classifyDevice("Adreno (TM) 730", deviceEnv({
      userAgent: ANDROID_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
      deviceMemoryGb: 3,
    }))).toBe("low");
  });

  it("never demotes a touchscreen desktop", () => {
    // A Surface in tablet mode reports a coarse pointer and ten touch points.
    // Its GPU is not a phone GPU and its UA is not a phone UA, so nothing here
    // may touch it - this is the rule's guard rail, not a nicety.
    expect(classifyDevice("NVIDIA GeForce RTX 4090", deviceEnv({
      userAgent: WINDOWS_UA,
      coarsePointer: true,
      maxTouchPoints: 10,
      deviceMemoryGb: 32,
    }))).toBe("high");
    expect(classifyDevice("Intel(R) Iris(R) Xe Graphics", deviceEnv({
      userAgent: WINDOWS_UA,
      coarsePointer: true,
      maxTouchPoints: 10,
      deviceMemoryGb: 16,
    }))).toBe("medium");
  });

  it("never demotes a mobile GPU behind a mouse", () => {
    // An Android emulator, or a phone on a desk with a bluetooth mouse,
    // reports a fine pointer. Demoting on the GPU alone would catch
    // developers' machines; the PAIR of signals is the rule.
    expect(classifyDevice("Adreno (TM) 730", deviceEnv({
      userAgent: ANDROID_UA,
      coarsePointer: false,
      maxTouchPoints: 0,
    }))).toBe("high");
  });

  it("never RAISES a tier", () => {
    // The environment is a demotion rule and nothing else: a weak GPU in a
    // phone stays exactly as weak as its string said.
    expect(classifyDevice("Mali-G52 MC2", deviceEnv({
      userAgent: ANDROID_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
      deviceMemoryGb: 8,
    }))).toBe("low");
    expect(classifyDevice("Google SwiftShader", deviceEnv({
      userAgent: ANDROID_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
    }))).toBe("poster");
  });

  it("still returns poster for an empty string whatever the device is", () => {
    expect(classifyDevice("", deviceEnv({
      userAgent: IPHONE_UA,
      coarsePointer: true,
      maxTouchPoints: 5,
    }))).toBe("poster");
  });
});

describe("readDeviceEnvironment", () => {
  it("reads the four signals off the browser", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(pointer: coarse)" }));
    vi.stubGlobal("matchMedia", matchMedia);
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    Object.defineProperty(navigator, "deviceMemory", { value: 8, configurable: true });

    const environment = readDeviceEnvironment();
    expect(environment).not.toBeNull();
    expect(environment?.coarsePointer).toBe(true);
    expect(environment?.maxTouchPoints).toBe(5);
    expect(environment?.deviceMemoryGb).toBe(8);
    expect(environment?.userAgent).toBe(navigator.userAgent);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");

    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "deviceMemory");
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  });

  it("reports deviceMemory as null where the engine does not implement it", () => {
    // Safari on iOS. A null here is a real answer, not a failure, and the
    // memory rule must simply not fire.
    Reflect.deleteProperty(navigator, "deviceMemory");
    expect(readDeviceEnvironment()?.deviceMemoryGb).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quality settings
// ---------------------------------------------------------------------------

describe("getQualitySettings", () => {
  const tiers: readonly DeviceTier[] = ["poster", "low", "mobile", "medium", "high"];

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
    const mobile = getQualitySettings("mobile").maxTriangles;
    const medium = getQualitySettings("medium").maxTriangles;
    const high = getQualitySettings("high").maxTriangles;
    expect(poster).toBeLessThan(low);
    expect(low).toBeLessThan(mobile);
    expect(mobile).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("targets 60fps for medium and high tiers", () => {
    expect(getQualitySettings("medium").targetFrameTimeMs).toBeCloseTo(16.67, 0);
    expect(getQualitySettings("high").targetFrameTimeMs).toBeCloseTo(16.67, 0);
  });

  it("targets 30fps for poster, low and mobile tiers", () => {
    expect(getQualitySettings("poster").targetFrameTimeMs).toBeCloseTo(33.33, 0);
    expect(getQualitySettings("low").targetFrameTimeMs).toBeCloseTo(33.33, 0);
    // 30 is the honest target on a phone. Claiming 60 there would be a number
    // nobody has measured; see MOBILE_SETTINGS.
    expect(getQualitySettings("mobile").targetFrameTimeMs).toBeCloseTo(33.33, 0);
  });

  it("mobile sits between low and medium without borrowing high's extras", () => {
    const mobile = getQualitySettings("mobile");
    expect(mobile.dpr).toEqual([1, 1.5]);
    expect(mobile.antialias).toBe(false);
    expect(mobile.envMap).toBe(false);
    expect(mobile.textureScale).toBeGreaterThan(getQualitySettings("low").textureScale);
    expect(mobile.textureScale).toBeLessThan(getQualitySettings("high").textureScale);
  });
});

// ---------------------------------------------------------------------------
// getGpuRenderer
// ---------------------------------------------------------------------------

describe("getGpuRenderer", () => {
  it("returns null when WEBGL_debug_renderer_info is unavailable", () => {
    const gl = {
      getExtension: () => null,
      getParameter: () => null,
    };
    expect(getGpuRenderer(gl)).toBeNull();
  });

  it("returns renderer string when extension is available", () => {
    const gl = {
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 } as const),
      getParameter: (param: number) => {
        if (param === 0x9246) return "NVIDIA GeForce RTX 4090";
        return null;
      },
    };
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
