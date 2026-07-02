import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, PerspectiveCamera } from "three";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";

// -----------------------------------------------------------------------------
// WalkControls — first-person look + fov zoom for the twin walkthrough.
//
// Pointer drag steers yaw/pitch targets and springs settle the actual camera
// orientation each frame (house rule: springs, never tweens); the wheel and
// two-finger pinch steer a fov target the same way. All per-frame motion is
// direct camera writes inside useFrame — no React state — and invalidate()
// keeps the demand-mode canvas painting only while a spring is live.
//
// The pure helpers (dragToYawPitch, clampPitch, lookStateFromCamera) are
// exported for unit tests and so Task 9's hops can hand orientation over
// seamlessly. Pointer Events cover mouse and touch alike: one active pointer
// is a look-drag, two are a pinch.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 8).
// -----------------------------------------------------------------------------

/** Radians of yaw/pitch per pixel of drag. */
export const LOOK_SENSITIVITY = 0.0025;

/** Pitch limit ±85° — stops gimbal flips at the zenith crown and the floor. */
export const MAX_PITCH_RAD = (85 * Math.PI) / 180;

/** Fov zoom range in degrees. */
export const MIN_FOV = 30;
export const MAX_FOV = 95;

/** Look spring — crisp but padded so a flick glides to rest. */
export const LOOK_SPRING: SpringConfig = { stiffness: 120, damping: 26 };
/** Fov spring — slightly tighter so wheel steps feel immediate. */
export const FOV_SPRING: SpringConfig = { stiffness: 160, damping: 24 };

/** Wheel deltaY (px) → fov degrees. */
const WHEEL_FOV_FACTOR = 0.05;
/** Pinch distance delta (px) → fov degrees; pinch out = zoom in = smaller fov. */
const PINCH_FOV_FACTOR = 0.2;
/** Fov settles in degrees, so a looser epsilon than the radian springs. */
const FOV_SETTLE_EPSILON = 0.01;

/**
 * Drag deltas (px) → look deltas (radians), grab-the-world convention:
 * dragging right pulls the scene right so the camera yaws left (+yaw in
 * three's YXZ order); dragging down tilts the view up (+pitch).
 */
export function dragToYawPitch(
  dx: number,
  dy: number,
  sensitivity: number = LOOK_SENSITIVITY,
): { dYaw: number; dPitch: number } {
  return { dYaw: dx * sensitivity, dPitch: dy * sensitivity };
}

/** Clamp a pitch to ±85° in radians. */
export function clampPitch(pitch: number): number {
  return Math.min(Math.max(pitch, -MAX_PITCH_RAD), MAX_PITCH_RAD);
}

function clampFov(fov: number): number {
  return Math.min(Math.max(fov, MIN_FOV), MAX_FOV);
}

/**
 * Read the camera's current yaw/pitch (YXZ order) so control can engage — or
 * a Task-9 hop can hand over — without snapping the view.
 */
export function lookStateFromCamera(camera: PerspectiveCamera): {
  yaw: number;
  pitch: number;
} {
  const euler = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
  return { yaw: euler.y, pitch: euler.x };
}

interface WalkState {
  yaw: SpringState;
  pitch: SpringState;
  fov: SpringState;
  yawTarget: number;
  pitchTarget: number;
  fovTarget: number;
  /** Active pointers by id — one is a look-drag, two are a pinch. */
  readonly pointers: Map<number, { x: number; y: number }>;
  /** Last pinch span in px; null until both fingers have reported once. */
  pinchDistance: number | null;
}

/** Scratch Euler reused every frame — no per-frame allocation. */
const frameEuler = new Euler(0, 0, 0, "YXZ");

export interface WalkControlsProps {
  readonly enabled: boolean;
}

export function WalkControls({ enabled }: WalkControlsProps): null {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const walk = useRef<WalkState>({
    yaw: { value: 0, velocity: 0 },
    pitch: { value: 0, velocity: 0 },
    fov: { value: 60, velocity: 0 },
    yawTarget: 0,
    pitchTarget: 0,
    fovTarget: 60,
    pointers: new Map(),
    pinchDistance: null,
  });

  // Adopt the camera's current orientation whenever control (re)engages so
  // the springs never snap the view on mount or after a hop hands over.
  useEffect(() => {
    if (!enabled || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    const state = walk.current;
    const { yaw, pitch } = lookStateFromCamera(camera);
    state.yaw = { value: yaw, velocity: 0 };
    state.pitch = { value: pitch, velocity: 0 };
    state.fov = { value: camera.fov, velocity: 0 };
    state.yawTarget = yaw;
    state.pitchTarget = clampPitch(pitch);
    state.fovTarget = clampFov(camera.fov);
  }, [enabled, camera]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const element = gl.domElement;
    const state = walk.current;

    const onPointerDown = (event: PointerEvent): void => {
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.pinchDistance = null;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort (e.g. a pointer already released).
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      const previous = state.pointers.get(event.pointerId);
      if (previous === undefined) {
        return;
      }
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.pointers.size === 1) {
        const { dYaw, dPitch } = dragToYawPitch(
          event.clientX - previous.x,
          event.clientY - previous.y,
        );
        state.yawTarget += dYaw;
        state.pitchTarget = clampPitch(state.pitchTarget + dPitch);
        invalidate();
        return;
      }

      if (state.pointers.size === 2) {
        const [first, second] = [...state.pointers.values()];
        if (first === undefined || second === undefined) {
          return;
        }
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        if (state.pinchDistance !== null) {
          state.fovTarget = clampFov(
            state.fovTarget - (distance - state.pinchDistance) * PINCH_FOV_FACTOR,
          );
          invalidate();
        }
        state.pinchDistance = distance;
      }
    };

    const onPointerEnd = (event: PointerEvent): void => {
      state.pointers.delete(event.pointerId);
      state.pinchDistance = null;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      state.fovTarget = clampFov(state.fovTarget + event.deltaY * WHEEL_FOV_FACTOR);
      invalidate();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerEnd);
    element.addEventListener("pointercancel", onPointerEnd);
    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerEnd);
      element.removeEventListener("pointercancel", onPointerEnd);
      element.removeEventListener("wheel", onWheel);
      state.pointers.clear();
      state.pinchDistance = null;
    };
  }, [enabled, gl, invalidate]);

  useFrame((_, delta) => {
    if (!enabled || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    const state = walk.current;

    stepSpring(state.yaw, state.yawTarget, delta, LOOK_SPRING);
    stepSpring(state.pitch, state.pitchTarget, delta, LOOK_SPRING);
    stepSpring(state.fov, state.fovTarget, delta, FOV_SPRING);

    camera.quaternion.setFromEuler(
      frameEuler.set(state.pitch.value, state.yaw.value, 0, "YXZ"),
    );
    if (camera.fov !== state.fov.value) {
      camera.fov = state.fov.value;
      camera.updateProjectionMatrix();
    }

    if (
      !isSpringSettled(state.yaw, state.yawTarget) ||
      !isSpringSettled(state.pitch, state.pitchTarget) ||
      !isSpringSettled(state.fov, state.fovTarget, FOV_SETTLE_EPSILON)
    ) {
      invalidate();
    }
  });

  return null;
}
