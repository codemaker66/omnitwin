import { useEffect, useLayoutEffect, useMemo, useRef, useCallback, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { captureFallbackCameraGoal } from "../lib/capture-fallback-camera.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { SpaceDimensions } from "@omnitwin/types";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { touchOwnsFinger, useTouchGestureStore } from "../stores/touch-gesture-store.js";
import { sampleTransition } from "../lib/camera-animation.js";
import { sampleCameraTour } from "../lib/camera-tour.js";
import { applyCameraTourPose } from "../lib/camera-tour-controls.js";
import { finishPlannerShowcaseTour, plannerShowcaseStillCurrent } from "../lib/planner-showcase.js";
import {
  HUMAN_POV_TARGET_DISTANCE_M,
  computeHumanPovLookAngles,
  isHumanPovPointerButton,
  type HumanPovLookAngles,
} from "../lib/human-pov-camera.js";
import {
  DAMPING_FACTOR,
  DAMPING_SETTLE_FRAMES,
  MAX_POLAR_ANGLE,
  MIN_POLAR_ANGLE,
  PAN_KEYS,
  ZOOM_FRICTION,
  ZOOM_IMPULSE,
  ZOOM_VELOCITY_THRESHOLD,
  computeCameraTarget,
  computeDefaultCameraPosition,
  computeDistanceLimits,
  computeKeyboardPanDirection,
  computeKeyboardPanStep,
  computePanBounds,
  computeZoomFrameScale,
  isCameraKeyboardInputLocked,
  isCameraKeyboardPanSuspendedByPlannerState,
  zoomWhileFingersDown,
  type CameraKeyboardPlannerState,
} from "../lib/camera-rig.js";
import { useEscapeLayer, usePlannerKeyBindings } from "../lib/planner-keys.js";

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CameraRigProps {
  readonly dimensions: SpaceDimensions;
  readonly smoothControls?: boolean;
  /** A frozen timeline camera owns the canvas without changing the live rig. */
  readonly suspended?: boolean;
  /** Non-null only for terminal room-content failure, scoped to plan/source. */
  readonly captureUnavailableKey?: string | null;
  /**
   * A room's own opening framing on landscape screens (the Grand Hall's
   * three-quarter view). Must be a stable object. Portrait keeps the generic
   * interior angle.
   */
  readonly defaultPose?: { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] } | null;
  /** Told each time the opening framing is applied: true when it was `defaultPose`. */
  readonly onOpeningPose?: (usedDefaultPose: boolean) => void;
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
export function CameraRig({ dimensions, smoothControls = true, suspended = false, captureUnavailableKey = null, defaultPose = null, onOpeningPose }: CameraRigProps): React.ReactElement {
  const { camera, gl, invalidate, size } = useThree();
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const previouslySuspended = useRef(suspended);
  const pendingCaptureRecovery = useRef<{ readonly key: string; flowOverWalk: boolean } | null>(null);
  const recoverCapture = useRef<() => void>(() => {});
  const [recoveryLimit, setRecoveryLimit] = useState<{ readonly key: string; readonly distance: number } | null>(null);
  const recoveryActive = captureUnavailableKey !== null && recoveryLimit?.key === captureUnavailableKey;
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const tourNeedsFirstFrame = useRef(true);
  /** The glide whose clock has started (keyed by its stable start pose). */
  const transitionClockOwner = useRef<readonly number[] | null>(null);
  const humanPovActiveRef = useRef(false);
  const humanPovRestorePoseRef = useRef<PlannerCameraPose | null>(null);
  const humanPovDragRef = useRef<HumanPovDragState | null>(null);
  const humanPovAnglesRef = useRef<HumanPovLookAngles>({ yaw: 0, pitch: 0 });
  const humanPovEuler = useRef(new Euler(0, 0, 0, "YXZ"));
  const humanPovForward = useRef(new Vector3());


  // Parents may select a new immutable snapshot object at a timeline midpoint
  // even when its numeric room envelope is unchanged. Stabilise the bounds so
  // that identity-only endpoint changes do not reset the planning camera.
  const stableDimensions = useMemo<SpaceDimensions>(() => ({
    width: dimensions.width,
    length: dimensions.length,
    height: dimensions.height,
  }), [dimensions.height, dimensions.length, dimensions.width]);

  const ordinaryLimits = computeDistanceLimits(stableDimensions);
  const limits = { ...ordinaryLimits, maxDistance: recoveryActive
    ? Math.max(ordinaryLimits.maxDistance, recoveryLimit.distance) : ordinaryLimits.maxDistance };
  const bounds = computePanBounds(stableDimensions);

  // Ordinary poses remain aspect-aware: portrait uses the captured interior
  // angle; landscape uses the elevated planning composition. Terminal capture
  // failure has a separate one-shot overview and must not reset on resize.
  const aspect = size.width / Math.max(size.height, 1);
  const openingPose = aspect >= 1.2 ? defaultPose : null;
  const onOpeningPoseRef = useRef(onOpeningPose);
  onOpeningPoseRef.current = onOpeningPose;
  const target = useMemo(
    () => openingPose?.target ?? computeCameraTarget(stableDimensions, aspect),
    [openingPose, stableDimensions, aspect],
  );
  /** The arrival the opening pose was applied for, and where that left the camera. */
  const opened = useRef<{ readonly dimensions: SpaceDimensions; readonly pose: CameraRigProps["defaultPose"]; readonly position: Vector3 } | null>(null);
  /** The view as of the camera's last change: what a resize keeps once the camera has left the opening pose. */
  const heldTarget = useRef<Vector3 | null>(null);
  useEffect(() => {
    if (suspendedRef.current || previouslySuspended.current || captureUnavailableKey !== null) return;
    if (humanPovActiveRef.current || walkActiveRef.current || useBookmarkStore.getState().tour !== null) return;
    const controls = controlsRef.current;
    const last = opened.current;
    // A resize (window, browser zoom, rotation, devtools) is no new arrival:
    // once the camera has left the pose it opened on (a hand, a glide, a tour),
    // it keeps its view (A-04). R3F may have set the orbit target anew at a
    // portrait-landscape crossing; the view's own target is put back.
    if (last !== null && last.dimensions === stableDimensions && last.pose === defaultPose
      && camera.position.distanceToSquared(last.position) > 1e-8) {
      const held = heldTarget.current;
      if (controls !== null && held !== null && !controls.target.equals(held)) {
        controls.target.copy(held);
        controls.update();
        invalidate();
      }
      return;
    }
    const [x, y, z] = openingPose?.position ?? computeDefaultCameraPosition(stableDimensions, aspect);
    camera.position.set(x, y, z);
    camera.lookAt(target[0], target[1], target[2]);
    if (controls !== null) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
      (heldTarget.current ??= new Vector3()).copy(controls.target);
    }
    opened.current = { dimensions: stableDimensions, pose: defaultPose, position: camera.position.clone() };
    // A glide under way still owns where the camera ends up.
    if (useBookmarkStore.getState().transition === null) onOpeningPoseRef.current?.(openingPose !== null);
    invalidate();
  }, [camera, stableDimensions, target, aspect, invalidate, captureUnavailableKey, openingPose, defaultPose]);
  useEffect(() => { previouslySuspended.current = suspended; }, [suspended]);

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

  // ── Walk mode ──────────────────────────────────────────────────────────
  // The cockpit's walk toggle puts InteriorCamera in charge of the default
  // camera. The rig yields exactly the way it does for human POV: controls
  // disabled, keyboard state cleared, planner pose saved on entry and restored
  // on exit. Entering walk exits human POV first — two eye-level owners at
  // once would fight over the same camera.
  const walkActiveRef = useRef(false);
  const walkRestorePoseRef = useRef<{ position: Vector3; target: Vector3 } | null>(null);

  const applyWalkMode = useCallback((walk: boolean): void => {
    if (suspendedRef.current) return;
    if (walk === walkActiveRef.current) return;
    const controls = controlsRef.current;
    if (walk && humanPovActiveRef.current) leaveHumanPovMode(false);
    walkActiveRef.current = walk;
    keyboardKeys.clear();
    if (walk) {
      if (controls !== null) {
        if (walkRestorePoseRef.current === null) {
          walkRestorePoseRef.current = {
            position: camera.position.clone(),
            target: controls.target.clone(),
          };
        }
        controls.enabled = false;
      }
      return;
    }
    if (controls !== null) {
      // A tour is already the next owner when PlannerScene yields Walk.
      // Restoring the old orbit pose here flashes it before the first frame.
      const tourOwnsCamera = useBookmarkStore.getState().tour !== null;
      controls.enabled = !tourOwnsCamera;
      const pose = walkRestorePoseRef.current;
      if (!tourOwnsCamera && pose !== null) {
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        controls.update();
      }
    }
    walkRestorePoseRef.current = null;
    recoverCapture.current();
    invalidate();
  }, [camera, invalidate, leaveHumanPovMode]);

  useEffect(() => {
    applyWalkMode(useCockpitStore.getState().walkMode);
    const unsubscribe = useCockpitStore.subscribe((state, previous) => {
      // A new lens choice after failure is fresh user intent, including leaving
      // and re-entering Flow while a frozen preview delays the handoff.
      if (state.activeMode !== previous.activeMode && pendingCaptureRecovery.current !== null) {
        pendingCaptureRecovery.current.flowOverWalk = false;
      }
      applyWalkMode(state.walkMode);
    });
    return () => {
      unsubscribe();
      pendingCaptureRecovery.current = null;
      // Unmounting mid-walk must not leave the store claiming a mode that no
      // longer has a camera behind it.
      applyWalkMode(false);
    };
  }, [applyWalkMode]);

  // Capture failure or explicit room state can change the live owner while
  // preview holds the camera. Reconcile after preview's layout-effect restore.
  useEffect(() => {
    if (!suspended) applyWalkMode(useCockpitStore.getState().walkMode);
  }, [suspended, applyWalkMode]);

  useEffect(() => {
    if (useBookmarkStore.getState().tour !== null) {
      if (controlsRef.current !== null) controlsRef.current.enabled = false;
      invalidateRef.current();
    }
    return useBookmarkStore.subscribe((state, previousState) => {
      if (
        state.pendingNavigationId !== null &&
        state.pendingNavigationId !== previousState.pendingNavigationId
      ) {
        invalidateRef.current();
      }
      // A demand-loop delta includes idle time before playback began. The
      // first rendered tour frame establishes its own clock; a new path or
      // an explicit rewind also starts a fresh first-frame boundary.
      if (state.tour === null) tourNeedsFirstFrame.current = true;
      if (state.tour !== null && (previousState.tour === null
        || state.tour.legs !== previousState.tour.legs
        || state.tour.elapsedSec < previousState.tour.elapsedSec)) {
        tourNeedsFirstFrame.current = true;
        if (controlsRef.current !== null) controlsRef.current.enabled = false;
        keyboardKeys.clear();
        invalidateRef.current();
      }
    });
  }, []);

  // Keys (T-671 slice 5), through the planner's one keyboard owner. The
  // arrows pan the orbit camera while nothing is selected (with a selection
  // they nudge it, and in Walk they walk); W A S D no longer pan.
  usePlannerKeyBindings([{
    keys: [...PAN_KEYS].map((code) => ({ code })),
    repeat: true,
    when: () => !suspendedRef.current && !useCockpitStore.getState().walkMode && !isCameraKeyboardPanSuspended(),
    run: (event) => {
      keyboardKeys.add(event.code);
      invalidateRef.current();
    },
    release: (event) => {
      if (event === null) keyboardKeys.clear();
      else keyboardKeys.delete(event.code);
    },
  }]);
  useEffect(() => () => { keyboardKeys.clear(); }, []);

  // Esc on the camera's own moves, each before anything else steps back: it
  // stops Present and hands control straight back; it stops a bookmark move
  // where it is (a camera move must never lock input behind an animation);
  // and it leaves the person's-eye view, restoring the planner's pose.
  useEscapeLayer("operation", {
    open: () => {
      if (suspendedRef.current) return false;
      const store = useBookmarkStore.getState();
      return store.tour !== null
        || (store.transition !== null && store.activeReferenceId === null)
        || humanPovActiveRef.current || humanPovRestorePoseRef.current !== null || store.activeReferenceId !== null;
    },
    onEscape: () => {
      const store = useBookmarkStore.getState();
      if (store.tour !== null) {
        finishPlannerShowcaseTour(store.tour);
      } else if (store.transition !== null && store.activeReferenceId === null) {
        useBookmarkStore.setState({ transition: null, pendingNavigationId: null });
      } else {
        useBookmarkStore.setState({ pendingNavigationId: null, transition: null });
        leaveHumanPovMode(true);
      }
      invalidateRef.current();
    },
  });

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
  const cameraInteractionClearTimer = useRef<number | null>(null);

  const clearCameraInteractionTimer = useCallback((): void => {
    if (cameraInteractionClearTimer.current === null) return;
    window.clearTimeout(cameraInteractionClearTimer.current);
    cameraInteractionClearTimer.current = null;
  }, []);

  const markCameraInteractionActive = useCallback((): void => {
    if (suspendedRef.current) return;
    // A finger the touch arbiter holds may yet place, lift or tap: it is the
    // camera's only once the arbiter says orbit or pinch (below).
    if (touchOwnsFinger(useTouchGestureStore.getState().mode)) return;
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(true);
  }, [clearCameraInteractionTimer]);

  // The touch arbiter (SelectionSystem.tsx) holds the orbit while a finger may
  // yet place, lift or tap, and hands it over when the finger turns out to be
  // looking round. The orbit took the touch's start as usual, so once it may
  // rotate again it catches up from where the finger landed.
  useEffect(() => useTouchGestureStore.subscribe((state, previous) => {
    const controls = controlsRef.current;
    if (controls !== null && state.cameraHeld !== previous.cameraHeld) controls.enableRotate = !state.cameraHeld;
    if ((state.mode === "orbit" || state.mode === "two") && state.mode !== previous.mode) markCameraInteractionActive();
  }), [markCameraInteractionActive]);

  const markCameraInteractionSettling = useCallback((): void => {
    if (suspendedRef.current) return;
    clearCameraInteractionTimer();
    cameraInteractionClearTimer.current = window.setTimeout(() => {
      cameraInteractionClearTimer.current = null;
      useCockpitStore.getState().setCameraInteractionActive(false);
    }, DAMPING_SETTLE_FRAMES * 16);
  }, [clearCameraInteractionTimer]);

  const onControlsChange = useCallback(() => {
    if (suspendedRef.current) return;
    const controls = controlsRef.current;
    if (controls !== null) (heldTarget.current ??= new Vector3()).copy(controls.target);
    dampingFrames.current = smoothControls ? DAMPING_SETTLE_FRAMES : 0;
    invalidate();
  }, [invalidate, smoothControls]);

  useEffect(() => () => {
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(false);
  }, [clearCameraInteractionTimer]);

  // Custom inertial zoom — scroll ticks add velocity, friction decays it
  const zoomVelocity = useRef(0);

  // Restoring Walk runs synchronously inside the capture handoff below.
  // Keep this callback current without changing
  // applyWalkMode's identity (which would tear down its saved-pose ownership).
  recoverCapture.current = () => {
    const pending = pendingCaptureRecovery.current;
    if (pending === null || pending.key !== captureUnavailableKey || suspendedRef.current) return;
    const bookmarks = useBookmarkStore.getState();
    if (humanPovActiveRef.current || bookmarks.activeReferenceId !== null
      || bookmarks.tour !== null || bookmarks.transition !== null || bookmarks.pendingNavigationId !== null
      || useCockpitStore.getState().layerMode === "mesh"
      || (useCockpitStore.getState().activeMode === "flow" && !pending.flowOverWalk)) {
      pendingCaptureRecovery.current = null;
      return;
    }
    if (walkActiveRef.current || useCockpitStore.getState().walkMode) return;
    const controls = controlsRef.current;
    if (controls === null || !(camera instanceof PerspectiveCamera)) return;
    pendingCaptureRecovery.current = null;
    const goal = captureFallbackCameraGoal(stableDimensions, camera.position.toArray(),
      controls.target.toArray(), aspect, camera.getEffectiveFOV());
    const maxDistance = Math.max(ordinaryLimits.maxDistance, goal.distance * 1.05);
    keyboardKeys.clear();
    zoomVelocity.current = 0;
    dampingFrames.current = 0;
    // Drain old OrbitControls damping before applying the new pose.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.maxDistance = maxDistance;
    controls.target.fromArray(goal.target);
    camera.position.fromArray(goal.position);
    camera.far = Math.max(camera.far, goal.distance + Math.hypot(stableDimensions.width, stableDimensions.length, stableDimensions.height));
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = damping;
    setRecoveryLimit({ key: pending.key, distance: maxDistance });
    invalidate();
  };
  useLayoutEffect(() => {
    const cockpit = useCockpitStore.getState();
    pendingCaptureRecovery.current = captureUnavailableKey === null ? null : {
      key: captureUnavailableKey,
      // Flow selected over Interior has no orbit goal to preserve.
      flowOverWalk: cockpit.walkMode && cockpit.activeMode === "flow",
    };
    // Canvas commits through a separate reconciler: a PlannerScene effect can
    // run before this layout effect. Record the old owner here before yielding
    // Interior, so Flow over Interior cannot be mistaken for a new orbit choice.
    if (captureUnavailableKey !== null && cockpit.walkMode) cockpit.setWalkMode(false);
  }, [captureUnavailableKey]);
  // Also covers failure in orbit and failure received during a frozen preview;
  // preview restores its camera in layout effects before this handoff runs.
  useEffect(() => { recoverCapture.current(); }, [captureUnavailableKey, suspended]);

  useLayoutEffect(() => {
    if (!suspended) return;
    const controls = controlsRef.current;
    if (controls !== null) controls.enabled = false;
    keyboardKeys.clear();
    humanPovDragRef.current = null;
    zoomVelocity.current = 0;
    dampingFrames.current = 0;
    clearCameraInteractionTimer();
    useCockpitStore.getState().setCameraInteractionActive(false);
    const clearPendingCamera = (): void => {
      const state = useBookmarkStore.getState();
      if (state.tour !== null || state.transition !== null || state.pendingNavigationId !== null) {
        useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null });
      }
    };
    clearPendingCamera();
    // Late async navigation cannot queue a live-camera replay behind preview.
    return useBookmarkStore.subscribe(clearPendingCamera);
  }, [suspended, clearCameraInteractionTimer]);

  // Use ref for invalidate to avoid re-registering wheel listener every render.
  // invalidate is a new function from useThree() each render, but its behavior
  // is stable, so capturing via ref prevents event listener thrashing.
  const invalidateWheelRef = useRef(invalidate);
  invalidateWheelRef.current = invalidate;

  useEffect(() => {
    const canvas = gl.domElement;

    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      if (suspendedRef.current) return;
      if (humanPovActiveRef.current || walkActiveRef.current) return;
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

  // A wheel, or a camera drag (the middle or right button, a finger), during a
  // plain view glide takes the camera where it is: nobody waits with a hand on
  // the mouse. A tour, a flight into a saved viewpoint and a suspended rig keep
  // it. Heard on the window's capture, so the controls are on again before the
  // same wheel or press reaches them.
  useEffect(() => {
    const canvas = gl.domElement;
    function takeOver(event: Event): void {
      if (event.target !== canvas) return;
      const store = useBookmarkStore.getState();
      if (suspendedRef.current || store.transition === null || store.tour !== null || store.activeReferenceId !== null) return;
      store.clearTransition();
      if (controlsRef.current !== null) controlsRef.current.enabled = true;
      invalidateWheelRef.current();
    }
    function onPointerDown(event: PointerEvent): void {
      // The left button selects and places: it leaves a glide to finish.
      if (event.pointerType === "mouse" && event.button === 0) return;
      takeOver(event);
    }
    window.addEventListener("wheel", takeOver, { capture: true, passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("wheel", takeOver, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [gl]);

  // OrbitControls' zoom is the two-finger pinch's dolly, on only while a finger
  // is down; every wheel and trackpad has the inertial zoom above (on a
  // touch-first device both used to zoom one wheel turn).
  useEffect(() => zoomWhileFingersDown(window, (on) => {
    const controls = controlsRef.current;
    if (controls !== null) controls.enableZoom = on;
  }), []);

  useEffect(() => {
    const canvas = gl.domElement;

    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
    }

    function onPointerDown(event: PointerEvent): void {
      if (suspendedRef.current) return;
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
      if (suspendedRef.current) return;
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
      if (suspendedRef.current) return;
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
    if (suspendedRef.current) { controls.enabled = false; return; }

    const store = useBookmarkStore.getState();

    // Cinematic showcase tour takes full control of the camera while playing,
    // overriding pan/zoom/orbit and any pending navigation (same discipline as
    // a bookmark transition). It samples the eased multi-keyframe path each
    // frame and hands control back when the tour completes.
    if (store.tour !== null) {
      if (!plannerShowcaseStillCurrent(store.tour)) {
        finishPlannerShowcaseTour(store.tour);
        invalidate();
        return;
      }
      const { position, target, done } = sampleCameraTour(store.tour);
      applyCameraTourPose(camera, controls, { position, target });
      if (done) {
        finishPlannerShowcaseTour(store.tour);
        controls.enabled = !useCockpitStore.getState().walkMode;
      } else {
        const playbackDelta = tourNeedsFirstFrame.current ? 0 : frameDelta;
        tourNeedsFirstFrame.current = false;
        store.updateTour(playbackDelta);
        invalidate();
      }
      return;
    }

    // Consume pending navigation request — UI sets this, we start the transition
    if (store.pendingNavigationId !== null) {
      const bookmark = store.bookmarks.find((b) => b.id === store.pendingNavigationId);
      if (bookmark !== undefined) {
        if (bookmark.kind === "reference") {
          if (walkActiveRef.current) useCockpitStore.getState().setWalkMode(false);
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
      if (humanPovActiveRef.current || walkActiveRef.current) {
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

    // A finished glide hands the camera on: into the saved viewpoint it flew
    // to, or back to the orbit.
    const arrive = (): void => {
      if (store.activeReferenceId !== null) enterHumanPovMode();
      else controls.enabled = true;
    };
    if (done) {
      store.clearTransition();
      arrive();
    } else {
      const active = store.transition;
      // A glide started outside a frame (a view button, say) first draws after
      // the demand loop's idle gap; that gap is not time spent gliding.
      const firstFrame = transitionClockOwner.current !== active.fromPosition;
      transitionClockOwner.current = active.fromPosition;
      if (!store.updateTransition(firstFrame ? 0 : frameDelta)) {
        // The step that completes the glide ends it in the store, so this
        // frame lands it: a long frame (a slow device, a shader compiling)
        // must not leave the camera wherever the last drawn frame put it.
        camera.position.set(active.toPosition[0], active.toPosition[1], active.toPosition[2]);
        controls.target.set(active.toTarget[0], active.toTarget[1], active.toTarget[2]);
        controls.update();
        arrive();
      }
      invalidate();
    }
  });

  // Per-frame: inertial zoom + WASD panning + damping decay
  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    if (controls === null) return;
    if (suspendedRef.current) { controls.enabled = false; return; }

    // Skip normal camera controls while a bookmark transition is active.
    // Drop banked/coasting zoom velocity while something else owns the
    // camera (transition, tour, human POV) — wheel input received during a
    // locked move must be discarded, not replayed as a lurch on handback.
    if (!controls.enabled) {
      zoomVelocity.current = 0;
      return;
    }

    if (
      (typeof document !== "undefined" && isCameraKeyboardInputLocked(document.activeElement)) ||
      isCameraKeyboardPanSuspended()
    ) {
      if (keyboardKeys.size > 0) keyboardKeys.clear();
      return;
    }

    // Keep rendering while damping settles after orbit/pan. An update that
    // still moves the camera fires "change", which re-arms these frames and
    // asks for the next one; an update that moves nothing lets the loop rest
    // (a pose set in code leaves nothing to damp, and on a software-rendered
    // device each needless frame costs a quarter of a second).
    if (smoothControls && dampingFrames.current > 0) {
      dampingFrames.current--;
      controls.update();
    }

    // Inertial zoom — apply velocity then decay via friction
    if (Math.abs(zoomVelocity.current) > ZOOM_VELOCITY_THRESHOLD) {
      // Zoom direction: camera → target (positive velocity = zoom out = move away)
      const dir = zoomDir.current;
      dir.subVectors(camera.position, controls.target).normalize();

      // ~60 fps feel, capped so an idle demand-render frame cannot lurch.
      const move = zoomVelocity.current * computeZoomFrameScale(delta);
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
    const speed = computeKeyboardPanStep(delta, speedScale);

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
      regress={false}
      enabled={suspended ? false : undefined}
      enableDamping={smoothControls}
      dampingFactor={DAMPING_FACTOR}
      enableZoom={false}
      minPolarAngle={MIN_POLAR_ANGLE}
      maxPolarAngle={MAX_POLAR_ANGLE}
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      target={suspended || recoveryActive ? undefined : [target[0], target[1], target[2]]}
      enableRotate
      enablePan
      mouseButtons={{
        LEFT: -1 as number, // Disabled — reserved for object selection
        MIDDLE: 2, // THREE.MOUSE.PAN
        RIGHT: 0 as number, // THREE.MOUSE.ROTATE: a mouse's right-drag looks around at every width
      }}
      onStart={markCameraInteractionActive}
      onChange={onControlsChange}
      onEnd={markCameraInteractionSettling}
    />
  );
}
