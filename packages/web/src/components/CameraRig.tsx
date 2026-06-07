import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Euler, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { SpaceDimensions } from "@omnitwin/types";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { sampleTransition } from "../lib/camera-animation.js";
import {
  HUMAN_POV_TARGET_DISTANCE_M,
  computeHumanPovLookAngles,
  isHumanPovExitKey,
  isHumanPovPointerButton,
  type HumanPovLookAngles,
} from "../lib/human-pov-camera.js";
import {
  DAMPING_FACTOR,
  DAMPING_SETTLE_FRAMES,
  MAX_POLAR_ANGLE,
  MIN_POLAR_ANGLE,
  PAN_KEYS,
  PAN_SPEED,
  ZOOM_FRICTION,
  ZOOM_IMPULSE,
  ZOOM_VELOCITY_THRESHOLD,
  computeCameraTarget,
  computeDefaultCameraPosition,
  computeDistanceLimits,
  computeKeyboardPanDirection,
  computePanBounds,
  isCameraKeyboardInputLocked,
  isCameraKeyboardPanSuspendedByPlannerState,
  type CameraKeyboardPlannerState,
} from "../lib/camera-rig.js";

export {
  DAMPING_FACTOR,
  DAMPING_SETTLE_FRAMES,
  EDGE_SCROLL_ZONE,
  MAX_POLAR_ANGLE,
  MIN_POLAR_ANGLE,
  PAN_SPEED,
  ZOOM_FRICTION,
  ZOOM_IMPULSE,
  ZOOM_VELOCITY_THRESHOLD,
  computeCameraTarget,
  computeDefaultCameraPosition,
  computeDistanceLimits,
  computeEdgeScrollDirection,
  computeKeyboardPanDirection,
  computePanBounds,
  isCameraKeyboardInputLocked,
  isCameraKeyboardPanSuspendedByPlannerState,
  type CameraKeyboardPlannerState,
} from "../lib/camera-rig.js";

// ---------------------------------------------------------------------------
// Keyboard state tracking
// ---------------------------------------------------------------------------

/** Shared keyboard state — tracks which pan keys are currently held. */
const keyboardKeys = new Set<string>();

function readCameraKeyboardPlannerState(): CameraKeyboardPlannerState {
  const catalogue = useCatalogueStore.getState();
  const selection = useSelectionStore.getState();
  return {
    catalogueDrawerOpen: catalogue.drawerOpen,
    catalogueSelectionActive: catalogue.selectedItemId !== null,
    catalogueDragActive: catalogue.dragActive,
    cameraReferenceDraftOpen: useCameraReferenceStore.getState().draft !== null,
    guidelineActive: useGuidelineStore.getState().active,
    markupActive: useMarkupStore.getState().active,
    measurementActive: useMeasurementStore.getState().active,
    selectedItemCount: selection.selectedIds.size,
    marqueeActive: selection.marqueeActive,
  };
}

function isCameraKeyboardPanSuspended(): boolean {
  return isCameraKeyboardPanSuspendedByPlannerState(readCameraKeyboardPlannerState());
}

function onKeyUp(event: KeyboardEvent): void {
  keyboardKeys.delete(event.code);
}

function onBlur(): void {
  keyboardKeys.clear();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CameraRigProps {
  readonly dimensions: SpaceDimensions;
}

interface PlannerCameraPose {
  readonly position: Vector3;
  readonly target: Vector3;
}

interface HumanPovDragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startAngles: HumanPovLookAngles;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * RTS-style camera rig (StarCraft 2 feel) for venue planning.
 *
 * Controls:
 * - WASD / Arrow keys: Pan camera across the room
 * - Scroll wheel: Inertial zoom in/out (momentum-based, smooth coast)
 * - Right-click drag: Orbit (rotate around look-at point)
 * - Middle-click drag: Pan
 * - Left-click: Reserved for object selection (no camera action)
 *
 * Pan speed scales with zoom distance (closer = slower, further = faster).
 * Camera target is clamped to room bounds with a small margin.
 */
export function CameraRig({ dimensions }: CameraRigProps): React.ReactElement {
  const { camera, gl, invalidate, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const humanPovActiveRef = useRef(false);
  const humanPovRestorePoseRef = useRef<PlannerCameraPose | null>(null);
  const humanPovDragRef = useRef<HumanPovDragState | null>(null);
  const humanPovAnglesRef = useRef<HumanPovLookAngles>({ yaw: 0, pitch: 0 });
  const humanPovEuler = useRef(new Euler(0, 0, 0, "YXZ"));
  const humanPovForward = useRef(new Vector3());

  // Touch devices (iPad, iPhone) don't have a scroll wheel — the custom
  // inertial-wheel zoom below is desktop-only. Enabling OrbitControls' own
  // zoom on coarse-pointer devices wires pinch-to-zoom through the same
  // control surface used by orbit/pan, so two-finger gestures work out of
  // the box. Desktop wheel remains owned by the custom inertial handler.
  const isTouchDevice = useIsTouchDevice();

  const limits = computeDistanceLimits(dimensions);
  const bounds = computePanBounds(dimensions);

  // Aspect-aware camera pose: portrait phones (aspect < 1.2) get a 3/4
  // elevated "dollhouse" hero shot outside the room; landscape/desktop
  // keep the existing interior eye-level pose. useThree().size re-renders
  // on resize, so this effect re-fires when the user rotates their phone.
  const aspect = size.width / Math.max(size.height, 1);
  const target = useMemo(() => computeCameraTarget(dimensions, aspect), [dimensions, aspect]);
  useEffect(() => {
    if (humanPovActiveRef.current) return;
    const [x, y, z] = computeDefaultCameraPosition(dimensions, aspect);
    camera.position.set(x, y, z);
    camera.lookAt(target[0], target[1], target[2]);
    invalidate();
  }, [camera, dimensions, target, aspect, invalidate]);

  // Keyboard input — single keydown handler tracks state AND wakes demand-mode frame loop.
  // Uses stable ref to invalidate so the effect runs only once (mount/unmount).
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const syncHumanPovTarget = useCallback((): void => {
    const controls = controlsRef.current;
    if (controls === null) return;
    const forward = humanPovForward.current;
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    controls.target.copy(camera.position).addScaledVector(forward, HUMAN_POV_TARGET_DISTANCE_M);
    controls.update();
    invalidate();
  }, [camera, invalidate]);

  const readHumanPovAngles = useCallback((): HumanPovLookAngles => {
    const euler = humanPovEuler.current;
    euler.setFromQuaternion(camera.quaternion, "YXZ");
    return {
      yaw: euler.y,
      pitch: euler.x,
    };
  }, [camera]);

  const applyHumanPovLook = useCallback((angles: HumanPovLookAngles): void => {
    humanPovAnglesRef.current = angles;
    humanPovEuler.current.set(angles.pitch, angles.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(humanPovEuler.current);
    syncHumanPovTarget();
  }, [camera, syncHumanPovTarget]);

  const savePlannerPoseBeforeHumanPov = useCallback((): void => {
    const controls = controlsRef.current;
    if (controls === null || humanPovRestorePoseRef.current !== null) return;
    humanPovRestorePoseRef.current = {
      position: camera.position.clone(),
      target: controls.target.clone(),
    };
  }, [camera]);

  const enterHumanPovMode = useCallback((): void => {
    const controls = controlsRef.current;
    if (controls === null) return;
    humanPovActiveRef.current = true;
    humanPovDragRef.current = null;
    humanPovAnglesRef.current = readHumanPovAngles();
    keyboardKeys.clear();
    controls.enabled = false;
    syncHumanPovTarget();
  }, [readHumanPovAngles, syncHumanPovTarget]);

  const leaveHumanPovMode = useCallback((restorePlannerPose: boolean): void => {
    const controls = controlsRef.current;
    humanPovActiveRef.current = false;
    humanPovDragRef.current = null;
    keyboardKeys.clear();

    if (controls !== null) {
      controls.enabled = true;
      const restorePose = humanPovRestorePoseRef.current;
      if (restorePlannerPose && restorePose !== null) {
        camera.position.copy(restorePose.position);
        controls.target.copy(restorePose.target);
        controls.update();
      }
    }

    humanPovRestorePoseRef.current = null;
    useBookmarkStore.setState({ activeReferenceId: null });
    invalidate();
  }, [camera, invalidate]);

  useEffect(() => {
    return useBookmarkStore.subscribe((state, previousState) => {
      if (
        state.pendingNavigationId !== null &&
        state.pendingNavigationId !== previousState.pendingNavigationId
      ) {
        invalidateRef.current();
      }
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const store = useBookmarkStore.getState();
      const canExitHumanPov =
        humanPovActiveRef.current ||
        humanPovRestorePoseRef.current !== null ||
        store.activeReferenceId !== null;

      if (isHumanPovExitKey(event.code) && canExitHumanPov) {
        event.preventDefault();
        event.stopPropagation();
        useBookmarkStore.setState({
          pendingNavigationId: null,
          transition: null,
        });
        leaveHumanPovMode(true);
        return;
      }

      if (PAN_KEYS.has(event.code)) {
        if (isCameraKeyboardInputLocked(event.target) || isCameraKeyboardPanSuspended()) {
          keyboardKeys.delete(event.code);
          return;
        }
        keyboardKeys.add(event.code);
        invalidateRef.current();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      keyboardKeys.clear();
    };
  }, [leaveHumanPovMode]);

  // Reusable vectors to avoid per-frame allocation
  const panDelta = useRef(new Vector3());
  const zoomDir = useRef(new Vector3());

  const clampTarget = useCallback((t: Vector3): void => {
    t.x = Math.max(bounds.minX, Math.min(bounds.maxX, t.x));
    t.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, t.z));
  }, [bounds]);

  // Damping decay — after an OrbitControls interaction (orbit, pan),
  // keep rendering frames so damping can interpolate smoothly.
  const dampingFrames = useRef(0);

  const onControlsChange = useCallback(() => {
    dampingFrames.current = DAMPING_SETTLE_FRAMES;
    invalidate();
  }, [invalidate]);

  // Custom inertial zoom — scroll ticks add velocity, friction decays it
  const zoomVelocity = useRef(0);

  // Use ref for invalidate to avoid re-registering wheel listener every render.
  // invalidate is a new function from useThree() each render, but its behavior
  // is stable, so capturing via ref prevents event listener thrashing.
  const invalidateWheelRef = useRef(invalidate);
  invalidateWheelRef.current = invalidate;

  useEffect(() => {
    const canvas = gl.domElement;

    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      if (humanPovActiveRef.current) return;
      const raw = event.deltaY;
      const delta = Math.sign(raw) * Math.min(Math.abs(raw), 150);
      const normalizedDelta = delta / 100;
      const controls = controlsRef.current;
      if (controls === null) return;
      const distance = camera.position.distanceTo(controls.target);
      zoomVelocity.current += normalizedDelta * ZOOM_IMPULSE * distance;
      invalidateWheelRef.current();
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl]);

  useEffect(() => {
    const canvas = gl.domElement;

    function onContextMenu(event: MouseEvent): void {
      if (!humanPovActiveRef.current) return;
      event.preventDefault();
    }

    function onPointerDown(event: PointerEvent): void {
      if (!humanPovActiveRef.current || !isHumanPovPointerButton(event.button)) return;
      event.preventDefault();
      event.stopPropagation();
      if (controlsRef.current !== null) controlsRef.current.enabled = false;
      humanPovDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startAngles: readHumanPovAngles(),
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the browser has already cancelled the pointer.
      }
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = humanPovDragRef.current;
      if (!humanPovActiveRef.current || drag === null || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      applyHumanPovLook(
        computeHumanPovLookAngles(drag.startAngles, {
          deltaX: event.clientX - drag.startX,
          deltaY: event.clientY - drag.startY,
        }),
      );
    }

    function onPointerUp(event: PointerEvent): void {
      const drag = humanPovDragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      humanPovDragRef.current = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be gone after browser-level cancellation.
      }
    }

    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("lostpointercapture", onPointerUp);
    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("lostpointercapture", onPointerUp);
    };
  }, [applyHumanPovLook, gl, readHumanPovAngles]);

  // Per-frame: bookmark transition animation
  // Runs before the main camera loop — if a transition is active, it takes
  // full control of the camera and skips normal pan/zoom/orbit.
  useFrame((_state, frameDelta) => {
    const controls = controlsRef.current;
    if (controls === null) return;

    const store = useBookmarkStore.getState();

    // Consume pending navigation request — UI sets this, we start the transition
    if (store.pendingNavigationId !== null) {
      const bookmark = store.bookmarks.find((b) => b.id === store.pendingNavigationId);
      if (bookmark !== undefined) {
        if (bookmark.kind === "reference") {
          if (!humanPovActiveRef.current) savePlannerPoseBeforeHumanPov();
        } else if (humanPovActiveRef.current || humanPovRestorePoseRef.current !== null) {
          leaveHumanPovMode(false);
        }
        const pos: readonly [number, number, number] = [
          camera.position.x, camera.position.y, camera.position.z,
        ];
        const tgt: readonly [number, number, number] = [
          controls.target.x, controls.target.y, controls.target.z,
        ];
        store.startTransition(bookmark, pos, tgt);
      }
      useBookmarkStore.setState({ pendingNavigationId: null });
      invalidate();
    }

    if (store.transition === null) {
      if (humanPovActiveRef.current) {
        if (controls.enabled) controls.enabled = false;
        return;
      }
      // Re-enable controls when no transition is active
      if (!controls.enabled) {
        controls.enabled = true;
      }
      return;
    }

    // Disable user controls during transition
    controls.enabled = false;

    const { position: interpPos, target: interpTarget, done } = sampleTransition(store.transition);

    camera.position.set(interpPos[0], interpPos[1], interpPos[2]);
    controls.target.set(interpTarget[0], interpTarget[1], interpTarget[2]);
    controls.update();

    if (done) {
      const shouldEnterHumanPov = store.activeReferenceId !== null;
      store.clearTransition();
      if (shouldEnterHumanPov) {
        enterHumanPovMode();
      } else {
        controls.enabled = true;
      }
    } else {
      store.updateTransition(frameDelta);
      invalidate();
    }
  });

  // Per-frame: inertial zoom + WASD panning + damping decay
  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    if (controls === null) return;

    // Skip normal camera controls while a bookmark transition is active
    if (!controls.enabled) return;

    if (
      (typeof document !== "undefined" && isCameraKeyboardInputLocked(document.activeElement)) ||
      isCameraKeyboardPanSuspended()
    ) {
      if (keyboardKeys.size > 0) keyboardKeys.clear();
      return;
    }

    // Keep rendering while damping settles after orbit/pan
    if (dampingFrames.current > 0) {
      dampingFrames.current--;
      controls.update();
      invalidate();
    }

    // Inertial zoom — apply velocity then decay via friction
    if (Math.abs(zoomVelocity.current) > ZOOM_VELOCITY_THRESHOLD) {
      // Zoom direction: camera → target (positive velocity = zoom out = move away)
      const dir = zoomDir.current;
      dir.subVectors(camera.position, controls.target).normalize();

      const move = zoomVelocity.current * delta * 60; // Normalize to ~60fps feel
      camera.position.addScaledVector(dir, move);

      // Clamp distance to limits
      const distance = camera.position.distanceTo(controls.target);
      if (distance < limits.minDistance) {
        dir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, limits.minDistance);
        zoomVelocity.current = 0; // Kill velocity at limits
      } else if (distance > limits.maxDistance) {
        dir.subVectors(camera.position, controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, limits.maxDistance);
        zoomVelocity.current = 0;
      }

      // Friction: decay velocity each frame
      zoomVelocity.current *= (1 - ZOOM_FRICTION);

      // Snap to zero when negligible
      if (Math.abs(zoomVelocity.current) < ZOOM_VELOCITY_THRESHOLD) {
        zoomVelocity.current = 0;
      } else {
        invalidate(); // Keep rendering while coasting
      }

      controls.update();
    }

    // Keyboard pan direction
    const [dx, dz] = computeKeyboardPanDirection(keyboardKeys);

    if (dx === 0 && dz === 0) return;

    // Scale pan speed with zoom distance — closer = finer control
    const distance = camera.position.distanceTo(controls.target);
    const referenceDistance = (limits.minDistance + limits.maxDistance) / 2;
    const speedScale = distance / referenceDistance;
    const speed = PAN_SPEED * speedScale * delta;

    // Apply pan in camera-relative XZ plane
    // Get camera's forward direction projected onto XZ plane
    const forward = panDelta.current;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // Right vector = forward × up
    const rightX = -forward.z;
    const rightZ = forward.x;

    const moveX = (rightX * dx + forward.x * -dz) * speed;
    const moveZ = (rightZ * dx + forward.z * -dz) * speed;

    controls.target.x += moveX;
    controls.target.z += moveZ;
    clampTarget(controls.target);

    // Move camera by same amount to keep relative offset
    camera.position.x += moveX;
    camera.position.z += moveZ;

    controls.update();
    invalidate();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={DAMPING_FACTOR}
      enableZoom={isTouchDevice}
      minPolarAngle={MIN_POLAR_ANGLE}
      maxPolarAngle={MAX_POLAR_ANGLE}
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      target={[target[0], target[1], target[2]]}
      enableRotate
      enablePan
      mouseButtons={{
        LEFT: -1 as number, // Disabled — reserved for object selection
        MIDDLE: 2, // THREE.MOUSE.PAN
        RIGHT: 0, // THREE.MOUSE.ROTATE (orbit)
      }}
      onChange={onControlsChange}
    />
  );
}

/**
 * Detect coarse-pointer (touch) devices at mount + on media-query change.
 * Used to selectively enable OrbitControls' built-in pinch-zoom on iPad
 * and iPhone without disturbing the desktop wheel-zoom handler.
 */
function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(pointer: coarse)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const handler = (e: MediaQueryListEvent): void => { setIsTouch(e.matches); };
    mq.addEventListener("change", handler);
    return () => { mq.removeEventListener("change", handler); };
  }, []);
  return isTouch;
}
