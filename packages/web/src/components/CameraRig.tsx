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

// ---------------------------------------------------------------------------
// Camera configuration — pure data, fully testable
// ---------------------------------------------------------------------------

/**
 * Computes default camera position for a cinematic planning perspective.
 *
 * Desktop opens in a high, diagonal, room-composition view so layouts read as
 * a premium planning board immediately. Saved POVs still provide human eye
 * mode; the default authoring pose is intentionally god-view-first.
 */
export function computeDefaultCameraPosition(
  dimensions: SpaceDimensions,
  aspect = 1.78,
): readonly [number, number, number] {
  const { width, length } = dimensions;
  const maxDim = Math.max(width, length);
  const minDim = Math.min(width, length);

  // Portrait / narrow viewport (aspect < 1.2) — elevated interior 3/4 view.
  // The earlier exterior "dollhouse" pose framed the room footprint but left
  // phone users staring at the outside of the wall. For the planner, the hall
  // interior is the product; keep the camera inside the room and lift enough
  // to read the ceiling, chandeliers, and long-wall rhythm.
  if (aspect < 1.2) {
    const alongAxis = maxDim * 0.31;
    const lateral = minDim * 0.18;
    const lift = Math.max(dimensions.height * 0.34, 2.2);
    if (width >= length) {
      return [alongAxis, lift, lateral];
    }
    return [lateral, lift, alongAxis];
  }

  // Landscape / desktop — premium top-down 3/4 authoring pose.
  // Keep the camera close to the room centre and lift aggressively so a new
  // layout opens as a complete planning board, not as a cropped inspection
  // view. Users can still zoom down to individual chairs immediately.
  const alongAxis = maxDim * 0.1;
  const lateral = -minDim * 0.18;
  const lift = Math.max(dimensions.height * 1.8, maxDim * 0.92);

  if (width >= length) {
    return [alongAxis, lift, lateral];
  }
  return [lateral, lift, alongAxis];
}

/**
 * Computes the orbit target.
 * Landscape: low centre-of-room target so the default authoring pose reads the
 * entire layout surface and wall rhythm.
 * Portrait: slightly higher target so the elevated interior pose reads the
 * ceiling and chandeliers without aiming above the room.
 */
export function computeCameraTarget(
  dimensions: SpaceDimensions,
  aspect = 1.78,
): readonly [number, number, number] {
  if (aspect < 1.2) return [0, dimensions.height * 0.32, 0];
  return [0, dimensions.height * 0.1, 0];
}

/**
 * Horizontal FOV (radians) derived from the given vertical FOV (degrees)
 * and viewport aspect ratio. Used by computeFramingDistance to pick a
 * camera-to-target distance that keeps the room bounding box in frame
 * regardless of how narrow the viewport is.
 */
export function horizontalFovFromVertical(vFovDeg: number, aspect: number): number {
  const v = (vFovDeg * Math.PI) / 180;
  return 2 * Math.atan(Math.tan(v / 2) * aspect);
}

/**
 * Minimum camera-to-target distance that frames the room's bounding box
 * at the given aspect ratio and vertical FOV, with a small outer margin.
 * Used exclusively by the portrait pose — desktop keeps its existing
 * eye-level math.
 */
export function computeFramingDistance(
  dimensions: SpaceDimensions,
  aspect: number,
  vFovDeg: number,
  margin = 1.15,
): number {
  const v = (vFovDeg * Math.PI) / 180;
  const h = horizontalFovFromVertical(vFovDeg, aspect);
  const halfW = (Math.max(dimensions.width, dimensions.length) * margin) / 2;
  const halfH = (dimensions.height * margin) / 2;
  return Math.max(halfH / Math.tan(v / 2), halfW / Math.tan(h / 2));
}

/**
 * Computes min/max orbit distance constraints.
 * - Min ~1.5 m: close enough to inspect individual chairs/cloths.
 * - Max: scales up to 1.6× the longest dim so the portrait hero pose
 *   (which sits outside the room) isn't clamped at the ceiling and
 *   end up hugging the room instead.
 */
export function computeDistanceLimits(
  dimensions: SpaceDimensions,
): { readonly minDistance: number; readonly maxDistance: number } {
  const maxDim = Math.max(dimensions.width, dimensions.length, dimensions.height);
  return {
    minDistance: 1.5,
    maxDistance: Math.max(15, maxDim * 1.6),
  };
}

/**
 * Computes the rectangular bounds the camera target can pan within.
 * Allows panning slightly beyond the room edges (20% margin) so
 * the user can see all corners without the target snapping at the edge.
 */
export function computePanBounds(
  dimensions: SpaceDimensions,
): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  const marginX = dimensions.width * 0.2;
  const marginZ = dimensions.length * 0.2;
  return {
    minX: -dimensions.width / 2 - marginX,
    maxX: dimensions.width / 2 + marginX,
    minZ: -dimensions.length / 2 - marginZ,
    maxZ: dimensions.length / 2 + marginZ,
  };
}

/** Minimum polar angle — don't let camera go below the floor plane. */
export const MIN_POLAR_ANGLE = 0.1; // ~6° from directly overhead

/** Maximum polar angle — nearly horizontal, never below the floor. */
export const MAX_POLAR_ANGLE = Math.PI * 0.48; // ~86° from vertical (nearly horizontal)

/** Damping factor — lower = more slide/coast after interaction. */
export const DAMPING_FACTOR = 0.04;

/** Base pan speed in meters per second at reference zoom distance. */
export const PAN_SPEED = 20;

/** Edge scroll zone width in pixels from screen edge. */
export const EDGE_SCROLL_ZONE = 40;

/** Number of frames to keep rendering after an OrbitControls interaction,
 *  allowing damping to coast smoothly in demand mode. ~3 seconds at 60fps. */
export const DAMPING_SETTLE_FRAMES = 180;

/** How much each scroll tick adds to zoom velocity (multiplied by current distance). */
export const ZOOM_IMPULSE = 0.025;

/** Friction applied per frame — velocity *= (1 - friction). Lower = more coast. */
export const ZOOM_FRICTION = 0.09;

/** Below this velocity, snap to zero and stop rendering zoom frames. */
export const ZOOM_VELOCITY_THRESHOLD = 0.001;

// ---------------------------------------------------------------------------
// Keyboard state tracking
// ---------------------------------------------------------------------------

const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

/** Shared keyboard state — tracks which pan keys are currently held. */
const keyboardKeys = new Set<string>();

export function isCameraKeyboardInputLocked(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;

  if (
    target.closest(
      "input, textarea, select, button, [role='button'], [role='textbox'], [role='toolbar'], [role='menu'], [role='listbox'], [role='option'], [contenteditable]:not([contenteditable='false'])",
    ) !== null
  ) {
    return true;
  }

  return target.closest("[role='dialog'], [data-camera-keyboard-lock='true']") !== null;
}

export interface CameraKeyboardPlannerState {
  readonly catalogueDrawerOpen: boolean;
  readonly catalogueSelectionActive: boolean;
  readonly catalogueDragActive: boolean;
  readonly cameraReferenceDraftOpen: boolean;
  readonly guidelineActive: boolean;
  readonly markupActive: boolean;
  readonly measurementActive: boolean;
  readonly selectedItemCount: number;
  readonly marqueeActive: boolean;
}

export function isCameraKeyboardPanSuspendedByPlannerState(state: CameraKeyboardPlannerState): boolean {
  return (
    state.catalogueDrawerOpen ||
    state.catalogueSelectionActive ||
    state.catalogueDragActive ||
    state.cameraReferenceDraftOpen ||
    state.guidelineActive ||
    state.markupActive ||
    state.measurementActive ||
    state.selectedItemCount > 0 ||
    state.marqueeActive
  );
}

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
// Pure pan direction computation
// ---------------------------------------------------------------------------

/**
 * Computes a unit XZ pan direction from currently pressed keys.
 * Returns [0, 0] if no pan keys are held. Output is normalized.
 *
 * W/Up = -Z (forward into screen), S/Down = +Z, A/Left = -X, D/Right = +X.
 * This matches camera-relative panning for a top-down RTS view.
 */
export function computeKeyboardPanDirection(
  pressedKeys: ReadonlySet<string>,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) dz -= 1;
  if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) dz += 1;
  if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) dx -= 1;
  if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) dx += 1;

  if (dx === 0 && dz === 0) return [0, 0];

  // Normalize diagonal movement
  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
}

/**
 * Computes edge scroll direction based on mouse position relative to viewport.
 * Returns [0, 0] if mouse is not near any edge.
 */
export function computeEdgeScrollDirection(
  mouseX: number,
  mouseY: number,
  viewportWidth: number,
  viewportHeight: number,
  zone: number,
): readonly [number, number] {
  let dx = 0;
  let dz = 0;

  if (mouseX < zone) dx = -1;
  else if (mouseX > viewportWidth - zone) dx = 1;

  if (mouseY < zone) dz = -1;
  else if (mouseY > viewportHeight - zone) dz = 1;

  if (dx === 0 && dz === 0) return [0, 0];

  const length = Math.sqrt(dx * dx + dz * dz);
  return [dx / length, dz / length];
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
