import {
  WALL_BUILD_THRESHOLD,
  WALL_CLICK_ANIMATION_DURATION_SECONDS,
  WALL_KEYS,
  WALL_QUICK_ANIMATION_DURATION_SECONDS,
  type SurfaceKey,
  type WallKey,
} from "../stores/visibility-store.js";
import { BRICK_MOTION_QUICK, BRICK_MOTION_SLOW, type BrickMotion } from "./brick-wall.js";
import { plannerFeatureEnabled } from "./planner-features.js";
import { prefersReducedMotion } from "./reduced-motion.js";

export function wallKeyFromSurfaceKey(surfaceKey: SurfaceKey): WallKey | null {
  return (WALL_KEYS as readonly string[]).includes(surfaceKey) ? surfaceKey as WallKey : null;
}

export function wallAssemblyTargetFromBaseOpacity(baseOpacity: number): 0 | 1 {
  return baseOpacity >= WALL_BUILD_THRESHOLD ? 1 : 0;
}

/**
 * Seconds a clicked wall takes to come down or go back up: 5 s, or 450 ms
 * with `wallsQuick`, where reduced motion takes it at once. The bricks and
 * the wall's own surface read this one clock, so they stay together.
 */
export function wallClickSeconds(): number {
  if (!plannerFeatureEnabled("wallsQuick")) return WALL_CLICK_ANIMATION_DURATION_SECONDS;
  return prefersReducedMotion() ? 0 : WALL_QUICK_ANIMATION_DURATION_SECONDS;
}

/** The blocks' throw to match `wallClickSeconds`. */
export function wallClickBrickMotion(): BrickMotion {
  return plannerFeatureEnabled("wallsQuick") ? BRICK_MOTION_QUICK : BRICK_MOTION_SLOW;
}

/**
 * One frame of a clicked wall's 0->1 timeline toward its target. Long frames
 * are clamped to 0.1 s so the toggle never jumps after an idle tab; a timeline
 * of 0 s arrives at once.
 */
export function stepWallClickTimeline(current: number, target: number, deltaSeconds: number, seconds: number): number {
  if (seconds <= 0) return target;
  const step = Math.min(Math.max(deltaSeconds, 0), 0.1) / seconds;
  if (target > current) return Math.min(target, current + step);
  if (target < current) return Math.max(target, current - step);
  return current;
}

export function stepWallAssemblyOpacity(
  current: number,
  target: 0 | 1,
  deltaSeconds: number,
): number {
  if (current === target) return current;
  return stepWallClickTimeline(current, target, deltaSeconds, wallClickSeconds());
}
