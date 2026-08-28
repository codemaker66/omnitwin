import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  clampPitch,
  containPosition,
  lookSensitivity,
  maxPitchUpFor,
  isContained,
  isSettled,
  moveOnFloorPlane,
  smoothAngleTowards,
  smoothTowards,
  snapToTarget,
  type Bounds,
  type CameraState,
  type Vec3,
} from "./interior-camera.js";

// ---------------------------------------------------------------------------
// Standing in a captured room.
//
// Replaces OrbitControls, which was structurally wrong here: an orbit rotates
// the camera AROUND a target, so looking left swings you bodily through the
// wall and out of the room — where a capture has no data and the product looks
// broken. Here the head turns and the body does not.
//
// Three rules the feel depends on:
//
//   1. Rotation never writes position. Containment then only has to hold
//      translation, which is a much smaller problem.
//   2. Damping is exponential and frame-rate independent. A per-frame lerp is a
//      different filter at 30 fps than at 144, which reads as lag on a slow
//      machine however good the frame rate actually is.
//   3. Under frameloop="demand" invalidation has two halves. Input handlers
//      WAKE the loop; useFrame SUSTAINS it while anything is still resolving.
//      Build only the second and the camera looks frozen until something else
//      happens to redraw the scene.
// ---------------------------------------------------------------------------

/** How quickly the look follows the pointer. Small enough to feel direct. */
const LOOK_TAU = 0.075;
/** Movement carries more weight than the look, so it settles more slowly. */
const MOVE_TAU = 0.16;
/** Metres per wheel notch. */
const WHEEL_STEP_M = 0.55;
/** Metres per second on the keyboard. */
const WALK_SPEED = 2.4;

/**
 * Where the camera is, for tests and probes.
 *
 * Containment is the property this component exists to guarantee, and a
 * guarantee nobody can measure is only a hope. Publishing the live position
 * lets a headless run drive the camera as hard as it likes and then assert it
 * is still in the room. Matches the existing __roomWalk / __splatFixture
 * bridges.
 */
declare global {
  interface Window {
    __roomCamera?: {
      position: [number, number, number];
      yaw: number;
      pitch: number;
      contained: boolean;
    };
  }
}

export interface InteriorCameraProps {
  readonly spawn: { readonly position: Vec3; readonly yaw: number };
  readonly bounds: Bounds;
  /** Ceiling height above the floor, so the pitch limit can suit the room. */
  readonly roomHeightM?: number;
  /** Skip the settling entirely for people who asked for less motion. */
  readonly reducedMotion?: boolean;
}

export function InteriorCamera({
  spawn,
  bounds,
  roomHeightM,
  reducedMotion = false,
}: InteriorCameraProps): ReactElement {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // How far up this room allows. A 2.18 m ceiling and a dome are not the same
  // room, and a single constant serves neither.
  const maxPitchUp = useMemo(() => {
    const headroom = roomHeightM === undefined
      ? 1.6
      : Math.max(0.2, roomHeightM - spawn.position[1]);
    return maxPitchUpFor(headroom);
  }, [roomHeightM, spawn]);

  const start = useMemo<CameraState>(() => ({
    position: containPosition(spawn.position, bounds),
    yaw: spawn.yaw,
    pitch: 0,
  }), [spawn, bounds]);

  const current = useRef<CameraState>({ ...start, position: [...start.position] as Vec3 });
  const target = useRef<CameraState>({ ...start, position: [...start.position] as Vec3 });
  const keys = useRef<Set<string>>(new Set());
  const dragging = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Re-seat on room change: a new room is a new place to be standing.
  useEffect(() => {
    current.current = { ...start, position: [...start.position] as Vec3 };
    target.current = { ...start, position: [...start.position] as Vec3 };
    invalidate();
  }, [start, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    // Without this a touch drag scrolls the page instead of turning the view.
    canvas.style.touchAction = "none";

    // Every handler wakes the demand loop. Without this the scene simply does
    // not redraw, because useFrame is not running to notice the input at all.
    const wake = (): void => { invalidate(); };

    const onPointerDown = (event: PointerEvent): void => {
      dragging.current = true;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      wake();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging.current) return;
      const last = lastPointer.current;
      if (last === null) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      lastPointer.current = { x: event.clientX, y: event.clientY };

      // Drag the room rather than swing a head: pulling right turns the view
      // left, which is what every panorama viewer does and what people expect
      // of a room they are looking around rather than a game they are playing.
      const perPixel = lookSensitivity(
        "fov" in camera ? camera.fov : 48,
        canvas.clientWidth / Math.max(1, canvas.clientHeight),
        canvas.clientWidth,
      );
      target.current.yaw += dx * perPixel;
      target.current.pitch = clampPitch(target.current.pitch + dy * perPixel, maxPitchUp);
      wake();
    };

    const onPointerUp = (event: PointerEvent): void => {
      dragging.current = false;
      lastPointer.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      wake();
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const step = Math.sign(event.deltaY) * -WHEEL_STEP_M;
      target.current.position = containPosition(
        moveOnFloorPlane(target.current.position, target.current.yaw, step, 0),
        bounds,
      );
      wake();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Home") {
        target.current.position = [...start.position] as Vec3;
        target.current.yaw = start.yaw;
        target.current.pitch = 0;
        wake();
        return;
      }
      keys.current.add(event.key.toLowerCase());
      wake();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      keys.current.delete(event.key.toLowerCase());
      wake();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [gl, invalidate, bounds, camera, maxPitchUp, start]);

  useFrame((_state, delta) => {
    // A stalled tab can hand back a delta of seconds; clamping stops one long
    // frame teleporting the viewer across the room.
    const dt = Math.min(delta, 1 / 20);

    const held = keys.current;
    const forward = (held.has("w") || held.has("arrowup") ? 1 : 0)
      - (held.has("s") || held.has("arrowdown") ? 1 : 0);
    const strafe = (held.has("d") || held.has("arrowright") ? 1 : 0)
      - (held.has("a") || held.has("arrowleft") ? 1 : 0);

    if (forward !== 0 || strafe !== 0) {
      const speed = WALK_SPEED * dt;
      target.current.position = containPosition(
        moveOnFloorPlane(
          target.current.position,
          target.current.yaw,
          forward * speed,
          strafe * speed,
        ),
        bounds,
      );
    }

    const now = current.current;
    const want = target.current;

    if (reducedMotion) {
      now.position = [...want.position] as Vec3;
      now.yaw = want.yaw;
      now.pitch = want.pitch;
    } else {
      now.position = [
        smoothTowards(now.position[0], want.position[0], MOVE_TAU, dt),
        smoothTowards(now.position[1], want.position[1], MOVE_TAU, dt),
        smoothTowards(now.position[2], want.position[2], MOVE_TAU, dt),
      ];
      now.yaw = smoothAngleTowards(now.yaw, want.yaw, LOOK_TAU, dt);
      now.pitch = smoothTowards(now.pitch, want.pitch, LOOK_TAU, dt);
    }

    // Setting the euler directly in YXZ order makes roll structurally
    // impossible: there is no third term to accumulate error into. lookAt can
    // introduce roll near the poles, which in a room reads as the floor tilting.
    camera.position.set(now.position[0], now.position[1], now.position[2]);
    camera.rotation.order = "YXZ";
    camera.rotation.set(now.pitch, now.yaw, 0);

    const settled = isSettled(now, want);

    // Land exactly on target on the frame it settles. Stopping at the epsilon
    // freezes a sub-pixel error into the last frame, and the loop is about to
    // sleep, so nothing would ever redraw it.
    if (settled && !reducedMotion) {
      snapToTarget(now, want);
      camera.position.set(now.position[0], now.position[1], now.position[2]);
      camera.rotation.set(now.pitch, now.yaw, 0);
    }

    window.__roomCamera = {
      position: [now.position[0], now.position[1], now.position[2]],
      yaw: now.yaw,
      pitch: now.pitch,
      contained: isContained(now.position, bounds),
    };

    // Spark re-sorts every gaussian whenever the camera moves, so a camera that
    // moves continuously turns an occasional cost into a per-frame one. Drop
    // resolution while the viewer is driving and restore it once they stop:
    // motion hides the softness, and stillness is when detail gets looked at.
    const wantedDpr = settled ? Math.min(window.devicePixelRatio, 2) : 1;
    if (gl.getPixelRatio() !== wantedDpr) gl.setPixelRatio(wantedDpr);

    // Sustain the loop while anything is resolving, and let it stop when
    // nothing is — which is what keeps an idle room off the GPU entirely.
    if (!settled || forward !== 0 || strafe !== 0) invalidate();
  });

  return <></>;
}
