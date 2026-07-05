import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, PerspectiveCamera } from "three";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import { prefersReducedMotion } from "./reduced-motion.js";

// -----------------------------------------------------------------------------
// WalkControls — first-person look + fov zoom for the twin walkthrough.
//
// Pointer drag steers yaw/pitch targets and springs settle the actual camera
// orientation each frame (house rule: springs, never tweens); the wheel and
// two-finger pinch steer a fov target the same way. All per-frame motion is
// direct camera writes inside useFrame — no React state — and invalidate()
// keeps the demand-mode canvas painting only while a spring is live.
//
// Release inertia (polish pass): a look-drag that ends as a flick hands its
// velocity to the look springs — the release speed seeds the spring velocity
// and projects the target ahead by FLICK_PROJECTION_S, so the view glides
// ~300–500 ms and settles on LOOK_SPRING's overdamped tail (ζ ≈ 1.19 — no
// wobble by construction). Mouse and touch share the code path. Under
// prefers-reduced-motion the handoff is skipped: release stops the view.
//
// The pure helpers (dragToYawPitch, clampPitch, lookStateFromCamera,
// flickVelocity) are exported for unit tests and so Task 9's hops can hand
// orientation over seamlessly. Pointer Events cover mouse and touch alike:
// one active pointer is a look-drag, two are a pinch.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 8);
// inertia: the 2026-07-05 polish pass.
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
/**
 * Fov spring — tight so wheel steps feel immediate, damped just past critical
 * (ζ ≈ 1.03) so successive scroll notches read as one continuous breath
 * rather than a series of tiny overshoot ticks.
 */
export const FOV_SPRING: SpringConfig = { stiffness: 160, damping: 26 };

// — release inertia (the flick) —

/** One pointer-motion sample used for release-velocity estimation. */
export interface FlickSample {
  /** Event timestamp (ms, performance-clock domain of PointerEvent). */
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/** Sample-buffer horizon — motion older than this is pruned (ms). */
export const FLICK_WINDOW_MS = 180;
/** Pairwise low-pass time constant — recent pairs dominate (ms). */
export const FLICK_SMOOTHING_MS = 40;
/** Momentum half-life of a resting finger before release (ms). */
export const FLICK_REST_DECAY_MS = 80;
/** Release speeds below this settle in place — a hold, not a flick (px/s). */
export const FLICK_MIN_SPEED_PX_S = 180;
/** Release speed ceiling — a wild flick must never spin the room (px/s). */
export const FLICK_MAX_SPEED_PX_S = 3200;
/** How far ahead (seconds) the release velocity projects the look target. */
export const FLICK_PROJECTION_S = 0.12;

/**
 * Release velocity (px/s), estimated the way native scroll views do it:
 * consecutive sample pairs are low-passed (α = 1 − e^(−Δt/τ), so the most
 * recent motion dominates), then the whole estimate decays by
 * e^(−rest/τ_rest) for the gap between the last move and the release. A
 * finger that stops before lifting therefore yields zero — the view must
 * halt under a resting finger — while a single delayed event (a busy frame
 * on a real device) only shaves momentum instead of zeroing it, which a
 * hard sampling window would do. Speeds are clamped to
 * FLICK_MAX_SPEED_PX_S preserving direction; sub-threshold speeds are zero.
 */
export function flickVelocity(
  samples: readonly FlickSample[],
  releaseT: number,
): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (samples.length < 2 || last === undefined) {
    return { vx: 0, vy: 0 };
  }
  let vx = 0;
  let vy = 0;
  let initialized = false;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    // Sub-4 ms bursts (event floods in one task) share one trustworthy dt.
    const dtMs = Math.max(b.t - a.t, 4);
    const pairVx = ((b.x - a.x) / dtMs) * 1000;
    const pairVy = ((b.y - a.y) / dtMs) * 1000;
    if (!initialized) {
      vx = pairVx;
      vy = pairVy;
      initialized = true;
    } else {
      const alpha = 1 - Math.exp(-dtMs / FLICK_SMOOTHING_MS);
      vx += (pairVx - vx) * alpha;
      vy += (pairVy - vy) * alpha;
    }
  }
  const restMs = Math.max(releaseT - last.t, 0);
  const rest = Math.exp(-restMs / FLICK_REST_DECAY_MS);
  vx *= rest;
  vy *= rest;
  const speed = Math.hypot(vx, vy);
  if (speed < FLICK_MIN_SPEED_PX_S) {
    return { vx: 0, vy: 0 };
  }
  if (speed > FLICK_MAX_SPEED_PX_S) {
    const scale = FLICK_MAX_SPEED_PX_S / speed;
    vx *= scale;
    vy *= scale;
  }
  return { vx, vy };
}

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
  /** Recent look-drag samples — the flick window for release inertia. */
  readonly samples: FlickSample[];
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
    samples: [],
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
      // A fresh grab interrupts any glide in flight — and a second finger
      // (pinch) can never inherit the first finger's flick history.
      state.samples.length = 0;
      if (state.pointers.size === 1) {
        element.style.cursor = "grabbing";
      }
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
        // Record the flick buffer: the recent horizon only, so a long slow
        // drag never grows it (the low-pass already forgets old motion).
        state.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
        while (
          state.samples.length > 0 &&
          (state.samples[0]?.t ?? 0) < event.timeStamp - FLICK_WINDOW_MS
        ) {
          state.samples.shift();
        }
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
      const wasLookDrag =
        state.pointers.size === 1 && state.pointers.has(event.pointerId);
      state.pointers.delete(event.pointerId);
      state.pinchDistance = null;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      if (state.pointers.size === 0) {
        element.style.cursor = "";
      }
      // The flick: hand the release velocity to the look springs so the view
      // glides on. Momentum is an embellishment, so reduced motion skips it —
      // release simply stops the view where the drag left it.
      if (wasLookDrag && !prefersReducedMotion()) {
        const { vx, vy } = flickVelocity(state.samples, event.timeStamp);
        if (vx !== 0 || vy !== 0) {
          // px/s → rad/s rides the same linear map as the drag itself.
          const { dYaw: vYaw, dPitch: vPitch } = dragToYawPitch(vx, vy);
          state.yaw.velocity = vYaw;
          state.pitch.velocity = vPitch;
          state.yawTarget += vYaw * FLICK_PROJECTION_S;
          state.pitchTarget = clampPitch(state.pitchTarget + vPitch * FLICK_PROJECTION_S);
          invalidate();
        }
      }
      state.samples.length = 0;
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
      element.style.cursor = "";
      state.pointers.clear();
      state.pinchDistance = null;
      state.samples.length = 0;
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

    // The written pitch is clamped as well as the target: a seeded flick
    // velocity may carry the spring value transiently past the ±85° rail.
    camera.quaternion.setFromEuler(
      frameEuler.set(clampPitch(state.pitch.value), state.yaw.value, 0, "YXZ"),
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
