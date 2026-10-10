// ---------------------------------------------------------------------------
// Render quality profiles for the planner's post-processing pipeline
//
// One profile per class of device. Phones must hold 60 fps with a furnished
// hall, so they keep the effects that cost little per pixel (bloom on a small
// mip chain, a cheap spatial anti-alias) and leave screen-space occlusion to
// the furniture's own contact shadows. Desktops get ambient occlusion and
// temporal anti-aliasing that keeps refining for a few frames after the camera
// stops, so a still view sharpens to a supersampled image at no cost while
// moving. A query override (`?render=phone|tablet|desktop|off`) lets a
// development build compare profiles on one machine.
// ---------------------------------------------------------------------------

export type RenderProfileName = "off" | "phone" | "tablet" | "desktop";

export type AntiAlias = "temporal" | "fxaa" | "none";

export interface AmbientOcclusionSettings {
  /** Fraction of the canvas resolution the occlusion is computed at. */
  readonly resolutionScale: number;
  /** World-space sampling radius, metres. */
  readonly radius: number;
  readonly samples: number;
  /** Strength of the darkening where a surface is fully occluded. */
  readonly intensity: number;
}

export interface BloomSettings {
  readonly strength: number;
  readonly radius: number;
  /** Linear-light luminance above which a pixel glows. */
  readonly threshold: number;
}

export interface RenderProfile {
  readonly name: RenderProfileName;
  /** Upper bound on the canvas's device pixel ratio. */
  readonly maxPixelRatio: number;
  /**
   * Most device pixels a frame may draw, or null for no budget. Phones' 3x
   * screens are drawn at 2x or below: their density hides the difference.
   */
  readonly pixelBudget: number | null;
  readonly antiAlias: AntiAlias;
  /** MSAA samples of the scene pass; zero whenever a pass reads its depth. */
  readonly sceneSamples: number;
  readonly ambientOcclusion: AmbientOcclusionSettings | null;
  readonly bloom: BloomSettings | null;
  /** Extra frames drawn after the last change so temporal anti-aliasing converges. */
  readonly convergenceFrames: number;
  /** Darkening at the frame's corners, 0 to 1. */
  readonly vignette: number;
}

const BLOOM: BloomSettings = { strength: 0.32, radius: 0.55, threshold: 0.92 };

export const RENDER_PROFILES: Readonly<Record<RenderProfileName, RenderProfile>> = {
  off: {
    name: "off",
    maxPixelRatio: 2,
    pixelBudget: null,
    antiAlias: "none",
    sceneSamples: 4,
    ambientOcclusion: null,
    bloom: null,
    convergenceFrames: 0,
    vignette: 0,
  },
  phone: {
    name: "phone",
    maxPixelRatio: 2,
    pixelBudget: 2_200_000,
    antiAlias: "none",
    sceneSamples: 4,
    ambientOcclusion: null,
    bloom: BLOOM,
    convergenceFrames: 0,
    vignette: 0.22,
  },
  tablet: {
    name: "tablet",
    maxPixelRatio: 2,
    pixelBudget: 3_200_000,
    antiAlias: "fxaa",
    sceneSamples: 0,
    ambientOcclusion: { resolutionScale: 0.5, radius: 0.45, samples: 8, intensity: 0.85 },
    bloom: BLOOM,
    convergenceFrames: 0,
    vignette: 0.22,
  },
  desktop: {
    name: "desktop",
    maxPixelRatio: 2,
    pixelBudget: null,
    antiAlias: "temporal",
    sceneSamples: 0,
    ambientOcclusion: { resolutionScale: 0.5, radius: 0.5, samples: 12, intensity: 0.9 },
    bloom: BLOOM,
    convergenceFrames: 16,
    vignette: 0.22,
  },
};

export interface RenderDeviceContext {
  /** Whether the primary pointer is coarse (a finger). */
  readonly coarsePointer: boolean;
  /** The screen's shorter side, CSS pixels. */
  readonly shortSide: number;
  /** `?render=` from the page's address, honoured in development builds. */
  readonly override: string | null;
}

function isProfileName(value: string): value is RenderProfileName {
  return value === "off" || value === "phone" || value === "tablet" || value === "desktop";
}

/** The profile for a device: phones and tablets by pointer and screen size. */
export function selectRenderProfile(device: RenderDeviceContext): RenderProfile {
  if (device.override !== null && isProfileName(device.override)) return RENDER_PROFILES[device.override];
  if (!device.coarsePointer) return RENDER_PROFILES.desktop;
  return device.shortSide < 600 ? RENDER_PROFILES.phone : RENDER_PROFILES.tablet;
}

/**
 * The canvas's pixel ratio for a profile: the native ratio, at most the
 * profile's maximum and within its pixel budget for a canvas of the given CSS
 * size, never raised above native nor (from native 1 or more) below 1.
 */
export function profilePixelRatio(profile: RenderProfile, nativeRatio: number, cssWidth: number, cssHeight: number): number {
  let ratio = Math.min(nativeRatio, profile.maxPixelRatio);
  if (profile.pixelBudget !== null && cssWidth > 0 && cssHeight > 0) {
    ratio = Math.min(ratio, Math.sqrt(profile.pixelBudget / (cssWidth * cssHeight)));
  }
  return Math.max(Math.min(1, nativeRatio), ratio);
}

/** Reads the current browser's render device context. */
export function readRenderDeviceContext(development: boolean): RenderDeviceContext {
  if (typeof window === "undefined") return { coarsePointer: false, shortSide: 1080, override: null };
  const override = development ? new URLSearchParams(window.location.search).get("render") : null;
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    shortSide: Math.min(window.screen.width, window.screen.height),
    override,
  };
}
