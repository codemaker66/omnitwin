import {
  WALL_BUILD_THRESHOLD,
  WALL_CLICK_ANIMATION_DURATION_SECONDS,
  WALL_KEYS,
  type SurfaceKey,
  type WallKey,
} from "../stores/visibility-store.js";

export function wallKeyFromSurfaceKey(surfaceKey: SurfaceKey): WallKey | null {
  return (WALL_KEYS as readonly string[]).includes(surfaceKey) ? surfaceKey as WallKey : null;
}

export function wallAssemblyTargetFromBaseOpacity(baseOpacity: number): 0 | 1 {
  return baseOpacity >= WALL_BUILD_THRESHOLD ? 1 : 0;
}

export function stepWallAssemblyOpacity(
  current: number,
  target: 0 | 1,
  deltaSeconds: number,
): number {
  const clampedDelta = Math.min(Math.max(deltaSeconds, 0), 0.1);
  const step = clampedDelta / WALL_CLICK_ANIMATION_DURATION_SECONDS;
  if (target > current) return Math.min(target, current + step);
  if (target < current) return Math.max(target, current - step);
  return current;
}
