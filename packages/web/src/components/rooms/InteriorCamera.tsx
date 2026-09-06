import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { interiorInputBlocked, interiorLookButton, interiorMovementKey, type InteriorCameraInputPolicy } from "./interior-camera-input.js";
import { DRAG_THRESHOLD_PX } from "../../lib/selection.js";
import {
  wheelStepMetres,
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
/** Metres per wheel notch. A trackpad flick is one notch spread over many events. */
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

/**
 * The same object for as long as its values are the same.
 *
 * Callers build the spawn and bounds as literals per render (the scene does;
 * the planner's walk toggle does). Keying the re-seat effect on their identity
 * turned every parent re-render — a tile's progress tick, the motion signal —
 * into a teleport back to the spawn: the live Grand Hall "rubberbanded" on
 * every move (2026-09-04). Equal values must mean the same place; only a
 * genuinely different spawn (a new room) may re-seat the view.
 */
function useKeyed<T>(value: T, key: string): T {
  const kept = useRef({ key, value });
  if (kept.current.key !== key) kept.current = { key, value };
  return kept.current.value;
}

export interface InteriorCameraProps {
  readonly spawn: { readonly position: Vec3; readonly yaw: number; readonly pitch?: number };
  /** Standalone walk keeps grab-to-look; planner reserves left drag for edits. */
  readonly inputPolicy?: InteriorCameraInputPolicy;
  /** Synchronous ownership check prevents a last frame racing a bookmark/tour. */
  readonly ownsCamera?: () => boolean;
  /** Planner placement/drawing tools retain their existing touch gestures. */
  readonly touchLookEnabled?: () => boolean;
  /** Editing tools can reserve keyboard navigation independently of looking. */
  readonly keyboardNavigationEnabled?: () => boolean;
  readonly bounds: Bounds;
  /** Ceiling height above the floor, so the pitch limit can suit the room. */
  readonly roomHeightM?: number;
  /**
   * Pixel ratio while the view is settled / in motion.
   *
   * The walkthrough page keeps the defaults (full detail at rest, 1 while
   * driving). The planner passes its own budget: its canvas normally runs at
   * 0.75 and must get that exact value back when walk mode ends — which the
   * unmount restore below guarantees.
   */
  readonly settledDpr?: number;
  readonly motionDpr?: number;
  /** Skip the settling entirely for people who asked for less motion. */
  readonly reducedMotion?: boolean;
  /**
   * Told once each time the view starts or stops moving. "Moving" is the
   * look or the position still resolving toward its target, or a walk key
   * held. The renderer trades detail for frame rate on exactly this signal.
   */
  readonly onMotionChange?: (moving: boolean) => void;
}

export function InteriorCamera({
  spawn: spawnProp,
  bounds: boundsProp,
  roomHeightM,
  reducedMotion = false,
  settledDpr,
  motionDpr = 1,
  onMotionChange,
  inputPolicy = "walk",
  ownsCamera,
  touchLookEnabled,
  keyboardNavigationEnabled,
}: InteriorCameraProps): ReactElement {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // The listener lives in a ref so a caller passing a fresh function per
  // render does not re-run any effect; the report itself is change-only.
  const onMotionChangeRef = useRef(onMotionChange);
  useEffect(() => { onMotionChangeRef.current = onMotionChange; }, [onMotionChange]);
  const reportedMoving = useRef<boolean | null>(null);

  const spawn = useKeyed(spawnProp, `${spawnProp.position.join(",")}|${String(spawnProp.yaw)}|${String(spawnProp.pitch ?? 0)}`);
  const bounds = useKeyed(boundsProp, `${boundsProp.min.join(",")}|${boundsProp.max.join(",")}`);

  // How far up this room allows. A 2.18 m ceiling and a dome are not the same
  // room, and a single constant serves neither.
  const maxPitchUp = useMemo(() => {
    const headroom = roomHeightM === undefined
      ? 1.6
      : Math.max(0.2, roomHeightM - spawn.position[1]);
    return maxPitchUpFor(headroom);
  }, [roomHeightM, spawn]);

  useEffect(() => {
    const mountDpr = gl.getPixelRatio();
    return () => { gl.setPixelRatio(mountDpr); };
  }, [gl]);

  // Wake the demand loop the moment this camera takes over. Its useFrame is
  // what teleports the view to the spawn — and useFrame cannot run while the
  // loop is idle, which it is whenever this mounts into an already-settled
  // scene (the planner's walk toggle, exactly). Without this the frame stays
  // frozen on the plan view until the first drag. The walkthrough page never
  // showed it because tile loads kept invalidating around mount.
  useEffect(() => { invalidate(); }, [invalidate, spawn, bounds]);

  const start = useMemo<CameraState>(() => ({
    position: containPosition(spawn.position, bounds),
    yaw: spawn.yaw,
    pitch: clampPitch(spawn.pitch ?? 0, maxPitchUp),
  }), [spawn, bounds, maxPitchUp]);

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
    const blocked = (eventTarget: EventTarget | null): boolean =>
      ownsCamera?.() === false || interiorInputBlocked(inputPolicy, eventTarget);
    let touchStart: { x: number; y: number; pointerId: number } | null = null;
    let touchLookMoved = false;
    const suppressedTouches = new Set<number>();

    const onPointerDown = (event: PointerEvent): void => {
      if (!interiorLookButton(inputPolicy, event.button, event.pointerType) || blocked(event.target)) return;
      if (inputPolicy === "planner" && event.pointerType === "touch") {
        if (!event.isPrimary) {
          if (touchStart !== null) {
            suppressedTouches.add(event.pointerId);
            event.stopImmediatePropagation();
          }
          return;
        }
        suppressedTouches.delete(event.pointerId);
        if (touchLookEnabled?.() === false) return;
        touchStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        touchLookMoved = false;
      }
      if (inputPolicy === "planner") {
        // Clicking the canvas returns keyboard ownership from a toolbar button.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      dragging.current = true;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      wake();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (suppressedTouches.has(event.pointerId)) { event.stopImmediatePropagation(); return; }
      if (!dragging.current) return;
      if (blocked(document.activeElement)) { dragging.current = false; return; }
      if (inputPolicy === "planner" && event.pointerType === "touch") {
        if (touchStart?.pointerId !== event.pointerId || touchLookEnabled?.() === false) return;
        if (!touchLookMoved && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) <= DRAG_THRESHOLD_PX) return;
        touchLookMoved = true;
        // A touch drag belongs to navigation. Keep SelectionSystem's tap
        // candidate from turning into a marquee on a later move event.
        event.stopImmediatePropagation();
      }
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
      if (suppressedTouches.delete(event.pointerId)) {
        event.stopImmediatePropagation();
        return;
      }
      if (inputPolicy === "planner" && event.pointerType === "touch" && touchStart?.pointerId === event.pointerId) {
        if (touchLookMoved) event.stopImmediatePropagation();
        touchStart = null;
        touchLookMoved = false;
      }
      dragging.current = false;
      lastPointer.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      wake();
    };

    const onWheel = (event: WheelEvent): void => {
      if (blocked(document.activeElement)) return;
      event.preventDefault();
      const step = wheelStepMetres(event.deltaY, event.deltaMode, WHEEL_STEP_M);
      target.current.position = containPosition(
        moveOnFloorPlane(target.current.position, target.current.yaw, step, 0),
        bounds,
      );
      wake();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (blocked(event.target)) { keys.current.clear(); return; }
      if (keyboardNavigationEnabled?.() === false) { keys.current.clear(); return; }
      if (inputPolicy === "planner" && (event.ctrlKey || event.metaKey || event.altKey)) return;
      if (event.key === "Home") {
        if (inputPolicy === "planner") event.preventDefault();
        target.current.position = [...start.position] as Vec3;
        target.current.yaw = start.yaw;
        target.current.pitch = start.pitch;
        wake();
        return;
      }
      if (inputPolicy === "planner" && !interiorMovementKey(event.key)) return;
      if (inputPolicy === "planner") event.preventDefault();
      keys.current.add(event.key.toLowerCase());
      wake();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      keys.current.delete(event.key.toLowerCase());
      wake();
    };
    const onBlur = (): void => { keys.current.clear(); dragging.current = false; wake(); };
    const onContextMenu = (event: MouseEvent): void => {
      if (inputPolicy === "planner" && !blocked(document.activeElement)) event.preventDefault();
    };

    const capturePlannerPointers = inputPolicy === "planner";
    canvas.addEventListener("pointerdown", onPointerDown, capturePlannerPointers);
    canvas.addEventListener("pointermove", onPointerMove, capturePlannerPointers);
    canvas.addEventListener("pointerup", onPointerUp, capturePlannerPointers);
    canvas.addEventListener("pointercancel", onPointerUp, capturePlannerPointers);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, capturePlannerPointers);
      canvas.removeEventListener("pointermove", onPointerMove, capturePlannerPointers);
      canvas.removeEventListener("pointerup", onPointerUp, capturePlannerPointers);
      canvas.removeEventListener("pointercancel", onPointerUp, capturePlannerPointers);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [gl, invalidate, bounds, camera, maxPitchUp, start, inputPolicy, ownsCamera, touchLookEnabled, keyboardNavigationEnabled]);

  useFrame((_state, delta) => {
    if (ownsCamera?.() === false) { keys.current.clear(); dragging.current = false; return; }
    if (keyboardNavigationEnabled?.() === false) {
      keys.current.clear();
      target.current.position = [...current.current.position];
    }
    if (interiorInputBlocked(inputPolicy, document.activeElement)) {
      keys.current.clear();
      dragging.current = false;
      // Discard a held key's outstanding easing when an editor/modal takes focus.
      target.current = { ...current.current, position: [...current.current.position] };
    }
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
    const moving = !settled || forward !== 0 || strafe !== 0;
    if (reportedMoving.current !== moving) {
      reportedMoving.current = moving;
      onMotionChangeRef.current?.(moving);
    }

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
    const wantedDpr = settled
      ? (settledDpr ?? Math.min(window.devicePixelRatio, 2))
      : motionDpr;
    if (gl.getPixelRatio() !== wantedDpr) gl.setPixelRatio(wantedDpr);

    // Sustain the loop while anything is resolving, and let it stop when
    // nothing is — which is what keeps an idle room off the GPU entirely.
    if (moving) invalidate();
  });

  return <></>;
}
