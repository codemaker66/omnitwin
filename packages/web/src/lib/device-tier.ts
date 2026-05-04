// ---------------------------------------------------------------------------
// Device tier classification from WebGL GPU renderer string
// ---------------------------------------------------------------------------

/**
 * Device capability tiers, from lowest to highest.
 * - poster: Software rendering (SwiftShader, llvmpipe) — show static image only
 * - low: Budget mobile GPUs (Mali-G5x, Adreno 5xx, PowerVR) — minimal geometry
 * - medium: Integrated desktop / mid-range mobile (Intel HD/UHD, Adreno 6xx, Mali-G7x)
 * - high: Discrete desktop / Apple Silicon (NVIDIA, AMD, Apple GPU)
 */
export type DeviceTier = "poster" | "low" | "medium" | "high";

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

/**
 * Classifies a GPU renderer string into a device tier.
 * Returns "low" for unrecognised GPUs (safe fallback — better than crashing on poster
 * or wasting resources on high).
 */
export function classifyDevice(rendererString: string): DeviceTier {
  const trimmed = rendererString.trim();
  if (trimmed === "") return "poster";

  for (const { pattern, tier } of GPU_PATTERNS) {
    if (pattern.test(trimmed)) return tier;
  }

  return "low";
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
