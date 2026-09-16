// ---------------------------------------------------------------------------
// Device tier classification from WebGL GPU renderer string
// ---------------------------------------------------------------------------

/**
 * Device capability tiers, from lowest to highest.
 * - poster: Software rendering (SwiftShader, llvmpipe) — show static image only
 * - low: Budget mobile GPUs (Mali-G5x, Adreno 5xx, PowerVR) — minimal geometry
 * - mobile: A phone or tablet on a current mobile GPU (see MOBILE_GPU_PATTERNS)
 * - medium: Integrated desktop / mid-range mobile (Intel HD/UHD, Adreno 6xx, Mali-G7x)
 * - high: Discrete desktop / Apple Silicon (NVIDIA, AMD, Apple GPU)
 */
export type DeviceTier = "poster" | "low" | "mobile" | "medium" | "high";

/** The tiers in capability order, so one can be compared with another. */
export const DEVICE_TIER_ORDER: readonly DeviceTier[] = [
  "poster",
  "low",
  "mobile",
  "medium",
  "high",
];

/** The weaker of two tiers. */
function weakerTier(a: DeviceTier, b: DeviceTier): DeviceTier {
  return DEVICE_TIER_ORDER.indexOf(a) <= DEVICE_TIER_ORDER.indexOf(b) ? a : b;
}

// ---------------------------------------------------------------------------
// GPU pattern matching — ordered from most specific to least
// ---------------------------------------------------------------------------

interface GpuPattern {
  readonly pattern: RegExp;
  readonly tier: DeviceTier;
}

/**
 * Patterns are evaluated in order; first match wins.
 * More specific patterns must come before general ones.
 */
const GPU_PATTERNS: readonly GpuPattern[] = [
  // --- Poster tier: software renderers ---
  { pattern: /SwiftShader/i, tier: "poster" },
  { pattern: /llvmpipe/i, tier: "poster" },
  { pattern: /Software Rasterizer/i, tier: "poster" },

  // --- High tier: discrete desktop GPUs ---
  { pattern: /NVIDIA GeForce [A-Z]{2,3} [2-9]\d{2,3}/i, tier: "high" }, // RTX/GTX 2000+
  { pattern: /NVIDIA/i, tier: "high" }, // Catch-all NVIDIA
  { pattern: /Radeon RX [5-9]\d{2,3}/i, tier: "high" }, // AMD RX 5000+
  { pattern: /Radeon Pro/i, tier: "high" },

  // --- High tier: Apple Silicon ---
  { pattern: /Apple GPU/i, tier: "high" },
  { pattern: /Apple M\d/i, tier: "high" },

  // --- Medium tier: Intel integrated ---
  { pattern: /Intel.*Iris.*Xe/i, tier: "medium" },
  { pattern: /Intel.*Iris/i, tier: "medium" },
  { pattern: /Intel.*UHD/i, tier: "medium" },
  { pattern: /Intel.*HD Graphics [5-9]\d{2}/i, tier: "medium" }, // HD 520+
  { pattern: /Intel.*HD Graphics [1-4]\d{2}/i, tier: "low" }, // HD 400 and below
  { pattern: /Intel/i, tier: "medium" }, // Catch-all Intel

  // --- Medium tier: mid-range mobile ---
  { pattern: /Adreno.*6\d{2}/i, tier: "medium" }, // Adreno 6xx
  { pattern: /Adreno.*7\d{2}/i, tier: "high" }, // Adreno 7xx
  { pattern: /Mali-G7[2-9]/i, tier: "medium" }, // Mali-G72+
  { pattern: /Mali-G[8-9]\d/i, tier: "medium" }, // Mali-G8x+

  // --- Low tier: budget mobile ---
  { pattern: /Adreno.*[3-5]\d{2}/i, tier: "low" }, // Adreno 3xx-5xx
  { pattern: /Mali-G[5-6]\d/i, tier: "low" }, // Mali-G5x, G6x
  { pattern: /Mali-T/i, tier: "low" }, // Mali Midgard
  { pattern: /PowerVR/i, tier: "low" },

  // --- Low tier: older AMD ---
  { pattern: /Radeon.*R[2-7]\s/i, tier: "low" }, // AMD R2-R7 integrated
  { pattern: /Radeon/i, tier: "medium" }, // Catch-all AMD
] as const;

// ---------------------------------------------------------------------------
// Which device the renderer string is actually running on
//
// A renderer string alone cannot tell a phone from a desktop, and on the two
// families that matter most it actively misleads. Safari reports "Apple GPU"
// for an iPhone, an iPad and an M-series Mac alike, so the string that put
// every iPhone in the "high" tier is the same string an RTX-class Mac reports.
// Adreno 7xx is the same: a 2024 flagship phone and nothing else, classified
// "high" because its raw throughput deserves it and its thermal envelope,
// memory and screen do not.
//
// So the tier is a function of the string AND the device. The four signals
// below are the ones a browser will actually answer, and they are used
// together because each is defeatable alone: iPadOS sends a macOS user agent
// (maxTouchPoints is what gives it away), `deviceMemory` is unimplemented on
// iOS entirely, and a touchscreen laptop reports a coarse pointer in tablet
// mode. A device is only demoted when a MOBILE-CLASS GPU is joined by a
// touch-primary environment, so no desktop can be demoted by this rule
// whatever its pointer reports.
// ---------------------------------------------------------------------------

/** What the browser says about the device, as four plain values. */
export interface DeviceEnvironment {
  readonly userAgent: string;
  /** `matchMedia("(pointer: coarse)").matches` — the PRIMARY pointer. */
  readonly coarsePointer: boolean;
  /** `navigator.maxTouchPoints`. iPadOS sends a Mac UA and five of these. */
  readonly maxTouchPoints: number;
  /** `navigator.deviceMemory` in GiB, or null where it is not implemented. */
  readonly deviceMemoryGb: number | null;
}

/** GPUs that only ship in phones and tablets. */
const MOBILE_GPU_PATTERNS: readonly RegExp[] = [
  /Apple GPU/i,
  /Apple A\d/i,
  /Adreno/i,
  /Mali/i,
  /PowerVR/i,
];

/** User agents that name a phone or tablet outright. */
const MOBILE_UA_PATTERN = /iPhone|iPad|iPod|Android|Mobile Safari/i;

/**
 * Below this the device is held to the budget mobile tier whatever its GPU.
 *
 * A judgement, not a measurement: 4 GiB is where Android's own low-memory
 * signals start and where the Grand Hall's finest level (106,479,738 bytes
 * of tiles decoding to six million Gaussians) stops being plausible at all.
 * iOS does
 * not implement `deviceMemory`, so this never fires on an iPhone and the
 * phone tier there rests on the GPU and touch signals alone.
 */
const LOW_MEMORY_GB = 4;

/** The primary pointer is a finger, on a device that has fingers. */
function isTouchPrimary(environment: DeviceEnvironment): boolean {
  return environment.coarsePointer && environment.maxTouchPoints > 0;
}

/** Whether this string, or this user agent, names a phone or tablet. */
function isMobileClass(rendererString: string, environment: DeviceEnvironment): boolean {
  return MOBILE_GPU_PATTERNS.some((pattern) => pattern.test(rendererString))
    || MOBILE_UA_PATTERN.test(environment.userAgent);
}

/**
 * Reads the four device signals from the browser, or null off it.
 *
 * `deviceMemory` is not in the DOM lib because it is not in every engine;
 * reading it through a narrow cast is honest about that, and the null it
 * yields on iOS is a real answer rather than a failure.
 */
export function readDeviceEnvironment(): DeviceEnvironment | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    userAgent: navigator.userAgent,
    coarsePointer: typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
    deviceMemoryGb: typeof memory === "number" && Number.isFinite(memory) ? memory : null,
  };
}

/**
 * Classifies a GPU renderer string into a device tier.
 *
 * Returns "low" for unrecognised GPUs (safe fallback — better than crashing on
 * poster or wasting resources on high).
 *
 * Pass `environment` wherever one can be read. Without it the string is taken
 * at face value, which is the right reading for a desktop and the wrong one
 * for a phone: production callers should pass `readDeviceEnvironment()`.
 * The environment can only ever LOWER the tier.
 */
export function classifyDevice(
  rendererString: string,
  environment?: DeviceEnvironment | null,
): DeviceTier {
  const trimmed = rendererString.trim();
  if (trimmed === "") return "poster";

  let tier: DeviceTier = "low";
  for (const { pattern, tier: matched } of GPU_PATTERNS) {
    if (pattern.test(trimmed)) { tier = matched; break; }
  }

  if (environment === undefined || environment === null) return tier;
  if (!isTouchPrimary(environment) || !isMobileClass(trimmed, environment)) return tier;

  const demoted = weakerTier(tier, "mobile");
  return environment.deviceMemoryGb !== null && environment.deviceMemoryGb <= LOW_MEMORY_GB
    ? weakerTier(demoted, "low")
    : demoted;
}

// ---------------------------------------------------------------------------
// Quality settings per tier
// ---------------------------------------------------------------------------

export interface QualitySettings {
  /** Device pixel ratio range [min, max]. */
  readonly dpr: readonly [number, number];
  /** Maximum triangle count for LOD selection. */
  readonly maxTriangles: number;
  /** Whether to enable antialiasing. */
  readonly antialias: boolean;
  /** Texture resolution scale (1.0 = full, 0.5 = half). */
  readonly textureScale: number;
  /** Maximum number of active lights (0 = ambient only). */
  readonly maxLights: number;
  /** Whether to enable environment map reflections. */
  readonly envMap: boolean;
  /** Target frame time in ms (16.67ms = 60fps, 33.33ms = 30fps). */
  readonly targetFrameTimeMs: number;
}

const POSTER_SETTINGS: QualitySettings = {
  dpr: [1, 1],
  maxTriangles: 0,
  antialias: false,
  textureScale: 0.25,
  maxLights: 0,
  envMap: false,
  targetFrameTimeMs: 33.33,
};

const LOW_SETTINGS: QualitySettings = {
  dpr: [1, 1],
  maxTriangles: 20_000,
  antialias: false,
  textureScale: 0.5,
  maxLights: 1,
  envMap: false,
  targetFrameTimeMs: 33.33,
};

/**
 * A phone or tablet on a current mobile GPU.
 *
 * Between "low" and "medium" because that is where a flagship phone sits: far
 * more throughput than a Mali-G5x, and a fraction of an integrated desktop
 * GPU's sustained power and memory. Interim, and UNMEASURED — every number
 * here is scaled from the neighbouring tiers and is replaced by a measurement
 * the first time the drag budget runs on a phone Blake lends.
 */
const MOBILE_SETTINGS: QualitySettings = {
  dpr: [1, 1.5],
  maxTriangles: 50_000,
  antialias: false,
  textureScale: 0.75,
  maxLights: 2,
  targetFrameTimeMs: 33.33,
  envMap: false,
};

const MEDIUM_SETTINGS: QualitySettings = {
  dpr: [1, 1.5],
  maxTriangles: 80_000,
  antialias: true,
  textureScale: 0.75,
  maxLights: 2,
  envMap: false,
  targetFrameTimeMs: 16.67,
};

const HIGH_SETTINGS: QualitySettings = {
  dpr: [1, 2],
  maxTriangles: 250_000,
  antialias: true,
  textureScale: 1.0,
  maxLights: 4,
  envMap: true,
  targetFrameTimeMs: 16.67,
};

const TIER_SETTINGS: Record<DeviceTier, QualitySettings> = {
  poster: POSTER_SETTINGS,
  low: LOW_SETTINGS,
  mobile: MOBILE_SETTINGS,
  medium: MEDIUM_SETTINGS,
  high: HIGH_SETTINGS,
};

/**
 * Returns the quality settings for a given device tier.
 */
export function getQualitySettings(tier: DeviceTier): QualitySettings {
  return TIER_SETTINGS[tier];
}

export interface GpuRendererContext {
  readonly getExtension: (name: "WEBGL_debug_renderer_info") => WEBGL_debug_renderer_info | null;
  readonly getParameter: (parameter: number) => unknown;
}

/**
 * Attempts to read the GPU renderer string from a WebGL context.
 * Returns null if the WEBGL_debug_renderer_info extension is unavailable.
 */
export function getGpuRenderer(gl: GpuRendererContext): string | null {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (ext === null) return null;
  const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  return typeof renderer === "string" ? renderer : null;
}
