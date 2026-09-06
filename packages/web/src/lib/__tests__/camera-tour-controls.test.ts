import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { applyCameraTourPose } from "../camera-tour-controls.js";
import { MAX_POLAR_ANGLE, MIN_POLAR_ANGLE } from "../camera-rig.js";

describe("authored camera tour vs actual OrbitControls", () => {
  it("reproduces planner polar clamping of the old Grand Hall entrance", () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    camera.position.set(7.98, 1.7, 0.84);
    controls.target.set(0, 1.5, 0);
    controls.update();
    expect(camera.position.y).toBeCloseTo(2.00399, 4);
    expect(camera.position.x).toBeCloseTo(7.9667, 3);
    controls.dispose();
  });

  it("drains pending control inertia and preserves exact upward interior poses without changing saved state/options", () => {
    const camera = new PerspectiveCamera(55, 1.7, 0.1, 200);
    camera.position.set(4, 8, 7);
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 750 } });
    document.body.appendChild(canvas);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    controls.minDistance = 1.5;
    controls.maxDistance = 34;
    controls.target.set(0, 0.7, 0);
    controls.saveState();
    const savedPosition = controls.position0.clone();
    const savedTarget = controls.target0.clone();
    try {
      controls.setAzimuthalAngle(1.4);
      controls.setPolarAngle(0.35);
      controls.dollyIn(0.8);
      // Real key-pan queues a residual panOffset when damping is active.
      controls.listenToKeyEvents(canvas);
      canvas.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
      controls.autoRotate = true;
      for (const z of [7.5, 5, 2.5, 7.5]) {
        const pose = { position: [0.4, 1.6, z] as const, target: [0.17, 2.2266, z - 7.972] as const };
        applyCameraTourPose(camera, controls, pose);
        expect(camera.position.distanceTo(new Vector3(...pose.position))).toBeLessThan(1e-10);
        expect(controls.target.toArray()).toEqual(pose.target);
        const expectedDirection = new Vector3(...pose.target).sub(new Vector3(...pose.position)).normalize();
        expect(camera.getWorldDirection(new Vector3()).distanceTo(expectedDirection)).toBeLessThan(1e-10);
        expect(controls.enabled).toBe(false);
        expect(controls.enableDamping).toBe(true);
        expect(controls.autoRotate).toBe(true);
        expect(controls.minPolarAngle).toBe(MIN_POLAR_ANGLE);
        expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
        expect(controls.minDistance).toBe(1.5);
        expect(controls.maxDistance).toBe(34);
      }
      expect(controls.position0.equals(savedPosition)).toBe(true);
      expect(controls.target0.equals(savedTarget)).toBe(true);
      // Returning a generic tour to normal orbit retains its old limits. An
      // upward captured tour instead hands to Interior (separate owner tests).
      controls.autoRotate = false;
      const orbitPose = { position: [2, 8, 5] as const, target: [0, 1, 0] as const };
      applyCameraTourPose(camera, controls, orbitPose);
      controls.enabled = true;
      controls.update();
      expect(camera.position.distanceTo(new Vector3(...orbitPose.position))).toBeLessThan(1e-10);
    } finally {
      controls.dispose();
      canvas.remove();
    }
  });
});
