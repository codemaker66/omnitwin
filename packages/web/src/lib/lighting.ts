// ---------------------------------------------------------------------------
// Lighting configuration — pure functions, fully testable without WebGL
// ---------------------------------------------------------------------------

import type { DeviceTier } from "./device-tier.js";

// ---------------------------------------------------------------------------
// Hemisphere light configuration per device tier
// ---------------------------------------------------------------------------

export interface HemisphereLightConfig {
  readonly skyColor: string;
  readonly groundColor: string;
  readonly intensity: number;
}

/** Warm white — simulates overhead venue lighting bouncing off cream walls. */
const SKY_COLOR = "#ffeedd";

/** Cool dark grey — floor bounce light. */
const GROUND_COLOR = "#444455";

const HEMISPHERE_CONFIGS: Record<DeviceTier, HemisphereLightConfig> = {
  poster: { skyColor: SKY_COLOR, groundColor: GROUND_COLOR, intensity: 0.4 },
  low: { skyColor: SKY_COLOR, groundColor: GROUND_COLOR, intensity: 0.8 },
  medium: { skyColor: SKY_COLOR, groundColor: GROUND_COLOR, intensity: 1.0 },
  high: { skyColor: SKY_COLOR, groundColor: GROUND_COLOR, intensity: 1.2 },
};

/**
 * Returns hemisphere light configuration for a given device tier.
 * Higher tiers get more intense lighting for better visual fidelity.
 */
export function getHemisphereLightConfig(tier: DeviceTier): HemisphereLightConfig {
  return HEMISPHERE_CONFIGS[tier];
}

// ---------------------------------------------------------------------------
// Placeholder baked lightmap
// ---------------------------------------------------------------------------

/** Size in pixels for the placeholder lightmap texture (square, power-of-2). */
export const LIGHTMAP_SIZE = 64;

/** Minimum brightness at corners (0–255). */
const LIGHTMAP_MIN_BRIGHTNESS = 180;

/** Maximum brightness at center (0–255). */
const LIGHTMAP_MAX_BRIGHTNESS = 255;

/**
 * Whether to apply the placeholder lightmap for a given tier.
 * Only medium+ tiers benefit from the texture bandwidth cost.
 */
export function shouldUseLightmap(tier: DeviceTier): boolean {
  return tier === "medium" || tier === "high";
}

/**
 * Creates RGBA pixel data for a placeholder baked lightmap.
 *
 * Generates a soft radial vignette: bright at center, darker at edges/corners.
 * Simulates basic ambient occlusion that a real lightmap bake would produce.
 *
 * @param width  Texture width in pixels
 * @param height Texture height in pixels
 * @returns Uint8Array of RGBA pixel data (length = width × height × 4)
 */
export function createPlaceholderLightmapData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  const range = LIGHTMAP_MAX_BRIGHTNESS - LIGHTMAP_MIN_BRIGHTNESS;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const normalizedDist = maxDist === 0 ? 0 : Math.sqrt(dx * dx + dy * dy) / maxDist;

      // Quadratic falloff: 1.0 at center → 0.0 at corners
      const falloff = 1.0 - normalizedDist * normalizedDist;
      const brightness = Math.round(LIGHTMAP_MIN_BRIGHTNESS + range * falloff);

      const i = (y * width + x) * 4;
      data[i] = brightness; // R
      data[i + 1] = brightness; // G
      data[i + 2] = brightness; // B
      data[i + 3] = 255; // A (fully opaque)
    }
  }

  return data;
}
