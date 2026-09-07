import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { captureFallbackCameraGoal } from "../capture-fallback-camera.js";

const dimensions = { width: 21, length: 10.5, height: 7 };
describe("captureFallbackCameraGoal", () => {
  it.each([390 / 844, 844 / 390, 0.32, 1.78])("frames all room corners at aspect %s", (aspect) => {
    for (const azimuth of [-2.4, -0.2, 0, 1.6]) {
      const camera = new PerspectiveCamera(55, aspect, 0.1, 200);
      const goal = captureFallbackCameraGoal(dimensions,
        [10 * Math.sin(azimuth), 2.38, 10 * Math.cos(azimuth)], [0, 2.24, 0], aspect, camera.getEffectiveFOV());
      camera.position.fromArray(goal.position);
      camera.lookAt(...goal.target);
      camera.updateMatrixWorld(true);
      for (const x of [-10.5, 10.5]) for (const y of [0, 7]) for (const z of [-5.25, 5.25]) {
        const point = new Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(0.800001);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(0.800001);
        expect(point.z).toBeGreaterThan(-1);
        expect(point.z).toBeLessThan(1);
      }
    }
  });
});
