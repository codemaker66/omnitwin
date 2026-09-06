import type { Camera } from "three";
import type { OrbitControls } from "three-stdlib";
import type { CameraPose } from "./camera-tour.js";

/** Authoring limits/inertia must not deform a declared camera path. Synchronise
 * the real controls without changing their saved reset pose or normal options. */
export function applyCameraTourPose(camera: Camera, controls: OrbitControls, pose: CameraPose): void {
  const previous = {
    enableDamping: controls.enableDamping, autoRotate: controls.autoRotate,
    minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
    minAzimuthAngle: controls.minAzimuthAngle, maxAzimuthAngle: controls.maxAzimuthAngle,
    minDistance: controls.minDistance, maxDistance: controls.maxDistance,
  };
  controls.enabled = false;
  try {
    Object.assign(controls, { enableDamping: false, autoRotate: false,
      minPolarAngle: 0, maxPolarAngle: Math.PI,
      minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity,
      minDistance: 0, maxDistance: Infinity });
    // Drain queued rotate/pan/dolly first: update ignores controls.enabled.
    controls.update();
    camera.position.fromArray(pose.position);
    controls.target.fromArray(pose.target);
    controls.update();
  } finally {
    Object.assign(controls, previous);
  }
}
