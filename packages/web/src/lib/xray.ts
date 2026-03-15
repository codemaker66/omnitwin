// ---------------------------------------------------------------------------
// X-Ray mode — pure functions for semi-transparent material toggle
// ---------------------------------------------------------------------------

/** Target opacity when X-Ray mode is active (15% — ghosted, not invisible). */
export const XRAY_OPACITY = 0.15;

/** Full solid opacity. */
export const SOLID_OPACITY = 1.0;

/** Fade duration in seconds (200ms). */
export const XRAY_FADE_DURATION = 0.2;

/**
 * Linearly interpolates the x-ray opacity factor toward its target.
 *
 * @param current  - Current opacity factor (0–1).
 * @param enabled  - Whether x-ray mode is active (target = XRAY_OPACITY or SOLID_OPACITY).
 * @param delta    - Frame delta in seconds.
 * @returns New opacity factor, clamped to [XRAY_OPACITY, SOLID_OPACITY].
 */
export function stepXrayOpacity(
  current: number,
  enabled: boolean,
  delta: number,
): number {
  const target = enabled ? XRAY_OPACITY : SOLID_OPACITY;
  if (current === target) return target;

  // Speed = full range / duration
  const speed = (SOLID_OPACITY - XRAY_OPACITY) / XRAY_FADE_DURATION;
  const step = speed * delta;

  if (current < target) {
    return Math.min(target, current + step);
  }
  return Math.max(target, current - step);
}

/**
 * Returns the effective material opacity for a surface, combining:
 * - The surface's base opacity (from wall visibility, section plane, etc.)
 * - The global x-ray opacity factor
 *
 * Floor is exempt from x-ray — always returns baseOpacity unchanged.
 */
export function applyXrayOpacity(
  surfaceName: string,
  baseOpacity: number,
  xrayFactor: number,
): number {
  if (surfaceName === "floor") return baseOpacity;
  return baseOpacity * xrayFactor;
}

/**
 * Returns true if the x-ray opacity factor has reached its target
 * (no more interpolation needed).
 */
export function isXrayTransitionComplete(
  current: number,
  enabled: boolean,
): boolean {
  const target = enabled ? XRAY_OPACITY : SOLID_OPACITY;
  return Math.abs(current - target) < 0.001;
}
