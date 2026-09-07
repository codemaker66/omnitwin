import type { SpaceDimensions } from "@omnitwin/types";
import { azimuthOf, PLANNING_POLAR_ANGLE, sphericalPosition, type CameraPose, type Vec3 } from "./cockpit-planning-camera.js";

/** Fit the whole procedural envelope, not the failed capture, at the current
 * aspect. The ordinary orbit distance cap is deliberately not a framing cap. */
export function captureFallbackCameraGoal(
  dimensions: SpaceDimensions,
  currentPosition: Vec3,
  currentTarget: Vec3,
  aspect: number,
  verticalFovDeg: number,
): CameraPose & { readonly distance: number } {
  const target: Vec3 = [0, dimensions.height * 0.25, 0];
  const azimuth = azimuthOf(currentPosition, currentTarget);
  const sinA = Math.sin(azimuth), cosA = Math.cos(azimuth);
  const sinP = Math.sin(PLANNING_POLAR_ANGLE), cosP = Math.cos(PLANNING_POLAR_ANGLE);
  const tanV = Math.tan(verticalFovDeg * Math.PI / 360);
  const tanH = tanV * Math.max(aspect, 0.01);
  // Reserve a margin on every edge; framing is tested by projection, not by
  // comparing the implementation's distance arithmetic with itself.
  const margin = 1.25;
  let distance = 1.5;
  for (const x of [-dimensions.width / 2, dimensions.width / 2]) {
    for (const y of [0, dimensions.height]) {
      for (const z of [-dimensions.length / 2, dimensions.length / 2]) {
        const dy = y - target[1];
        const along = x * sinP * sinA + dy * cosP + z * sinP * cosA;
        const right = x * cosA - z * sinA;
        const up = -x * cosP * sinA + dy * sinP - z * cosP * cosA;
        distance = Math.max(distance, along + margin * Math.abs(right) / tanH,
          along + margin * Math.abs(up) / tanV, along + 1);
      }
    }
  }
  return { position: sphericalPosition(target, distance, PLANNING_POLAR_ANGLE, azimuth), target, distance };
}
