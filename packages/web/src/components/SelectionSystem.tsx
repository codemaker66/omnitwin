import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2, Vector3, Plane } from "three";
import type { Object3D, Camera, Raycaster } from "three";
import { useSelectionStore } from "../stores/selection-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { useVisibilityStore, type WallKey } from "../stores/visibility-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useLayoutTimelinePreviewStore } from "../stores/layout-timeline-preview-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useTouchGestureStore } from "../stores/touch-gesture-store.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../lib/catalogue.js";
import { isDiningTableItem } from "../lib/furniture-semantics.js";
import { dragMovingIds, getGroupMemberIds, snapPositionToGrid } from "../lib/placement.js";
import { computeFluidFurnitureDragFrame } from "../lib/furniture-drag.js";
import { isSceneFurniturePlacement } from "../lib/table-dressing.js";
import { useToolStore } from "../stores/tool-store.js";
import {
  formatDegrees,
  formatScale,
  rotationFromDrag,
  scaleFromDrag,
} from "../lib/planner-tools.js";
import {
  CARRY_AT_REST,
  beginFurnitureSettle,
  carryFurniture,
  clearFurnitureSettle,
  measureCarry,
  releaseFurniture,
  type CarrySpeed,
} from "../lib/furniture-motion.js";
import { prefersReducedMotion } from "../lib/reduced-motion.js";
import { normalizeFurnitureScale } from "../lib/furniture-scale.js";
import { intersectSelectable } from "../lib/raycast-gate.js";
import { plannerFeatureEnabled } from "../lib/planner-features.js";
import { placePieceInHand } from "../lib/place-in-hand.js";
import { placementFloorPoint } from "../lib/planner-interaction-floor.js";
import {
  FingerTrail,
  LIFT_HOLD_MS,
  LIFT_OFF_JITTER_MS,
  PLACE_HOLD_MS,
  TouchArbiter,
  ghostRaisePx,
  type TouchMode,
  type TouchOutcome,
} from "../lib/touch-arbiter.js";
import { useEscapeLayer, usePlannerKeyBindings } from "../lib/planner-keys.js";
import { selectionKeyBindings, type FloorDirection } from "../lib/planner-keymap.js";
import {
  DRAG_THRESHOLD_PX,
  screenDistance,
  computeMarqueeRect,
  isPointInRect,
} from "../lib/selection.js";

// ---------------------------------------------------------------------------
// Floor plane raycast helper
// ---------------------------------------------------------------------------

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);
const _floorHit = new Vector3();
/** Reusable Vector2 for NDC coordinates — avoids per-event allocation. */
const _ndc = new Vector2();
/** Reusable Vector3 for world-space projection in marquee hit-testing. */
const _worldPos = new Vector3();

/**
 * Raycast from screen pixel to the floor plane (y=0).
 * Returns world XZ coordinates or null if the ray is parallel to the floor.
 */
function screenToFloor(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  cam: Camera,
  rc: Raycaster,
): { x: number; z: number } | null {
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  rc.setFromCamera(_ndc.set(ndcX, ndcY), cam);
  const hit = rc.ray.intersectPlane(FLOOR_PLANE, _floorHit);
  if (hit === null) return null;
  return { x: hit.x, z: hit.z };
}

/** A short buzz where the phone has one (Android; Safari on iOS has no vibration). */
function haptic(ms: number): void {
  const nav = navigator as { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate === "function") nav.vibrate(ms);
}

/** The 56 px ring that fills while a finger holds a piece, until the piece lifts (spec-card-dock §10.1). */
function createHoldRing(): HTMLDivElement {
  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  ring.dataset["testid"] = "touch-hold-ring";
  const style = ring.style;
  style.position = "fixed";
  style.width = "56px";
  style.height = "56px";
  style.margin = "-28px 0 0 -28px";
  style.borderRadius = "50%";
  style.pointerEvents = "none";
  style.zIndex = "40";
  style.display = "none";
  // A 4 px band: a conic gradient fills it, the centre is masked away.
  const band = "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))";
  style.setProperty("mask", band);
  style.setProperty("-webkit-mask", band);
  return ring;
}

/** A progress indicator, not a motion: it fills 1:1 with time and is never gated. */
function paintHoldRing(ring: HTMLDivElement, progress: number): void {
  ring.style.background = `conic-gradient(var(--house-cream, #efe7cf) ${String(progress * 360)}deg, rgba(20, 18, 14, 0.28) 0deg)`;
}

const _screenForward = new Vector3();
const _screenUp = new Vector3();

/**
 * The floor direction that runs up the screen: the camera's view and its own
 * up, laid flat. Their sum never vanishes, looking straight down (Plan) or
 * straight ahead (Walk), so an arrow always has a way to go.
 */
function screenUpOnFloor(cam: Camera): FloorDirection {
  cam.getWorldDirection(_screenForward);
  _screenUp.setFromMatrixColumn(cam.matrixWorld, 1);
  return { x: _screenForward.x + _screenUp.x, z: _screenForward.z + _screenUp.z };
}

// ---------------------------------------------------------------------------
// SelectionSystem — handles click, drag-move, marquee, rotation, delete
// ---------------------------------------------------------------------------

/**
 * R3F component that manages the selection and transform loop.
 *
 * - Left-click on furniture: select (Shift+click: toggle additive)
 * - Left-click on empty + drag: marquee box select
 * - Drag selected furniture: move on floor plane
 * - Keys (lib/planner-keymap.ts): Q / E turn 15° either way, R a quarter
 *   turn; arrows nudge 10 cm (Shift 1 m, Alt 1 cm); + / − seats; C cloth;
 *   Ctrl G groups, Ctrl Shift G ungroups; G grid snap; Delete removes
 * - Escape: stops a drag or box in progress
 *
 * Must be inside the R3F Canvas.
 */
/** Finds the floor mesh in the scene (cached after first lookup). */
// Floor mesh raycast removed — drag uses math-plane intersection instead
// to work with any room polygon shape.

/** The group whose direct children are the per-item `furniture-{id}` roots. */
const PLACED_FURNITURE_GROUP = "placed-furniture";
const FURNITURE_ROOT_PREFIX = "furniture-";

/** Collects furniture group roots from the known parent group. */
function findFurnitureGroups(scene: Object3D): Object3D[] {
  const parent = scene.getObjectByName(PLACED_FURNITURE_GROUP);
  if (parent === undefined) return [];
  return parent.children.filter((c) => c.name.startsWith(FURNITURE_ROOT_PREFIX));
}

function isPlacedItemId(id: string): boolean {
  return usePlacementStore.getState().placedItems.some((placed) => placed.id === id);
}

const WALL_KEYS_SET = new Set<string>(["wall-front", "wall-back", "wall-left", "wall-right"]);

/** Walk the parent chain looking for a wall name or click-plane name. */
function findWallKey(obj: Object3D): WallKey | null {
  let current: Object3D | null = obj;
  while (current !== null) {
    const n = current.name;
    if (WALL_KEYS_SET.has(n)) return n as WallKey;
    if (n.endsWith("-click-plane")) {
      const key = n.replace("-click-plane", "");
      if (WALL_KEYS_SET.has(key)) return key as WallKey;
    }
    current = current.parent;
  }
  return null;
}

export function findFurnitureItemId(obj: Object3D): string | null {
  let current: Object3D | null = obj;
  while (current !== null) {
    // Only the `furniture-{id}` root PlacedFurniture renders directly under the
    // `placed-furniture` group names an item, and only while that id is still
    // placed: hidden instancing templates, lighting rigs and model parts share
    // the prefix, and a click on one must never select a phantom item.
    const parent: Object3D | null = current.parent;
    if (parent?.name === PLACED_FURNITURE_GROUP) {
      if (!current.name.startsWith(FURNITURE_ROOT_PREFIX)) return null;
      const id = current.name.slice(FURNITURE_ROOT_PREFIX.length);
      return isPlacedItemId(id) ? id : null;
    }
    current = parent;
  }
  return null;
}

declare global {
  interface Window {
    /** The touch arbiter's state and a hand in, for the phone e2e (development builds). */
    __plannerTouch?: {
      mode: () => string;
      placed: () => readonly { readonly id: string; readonly slug: string | null; readonly x: number; readonly z: number }[];
      arm: (slug: string) => boolean;
    };
  }
}

export function SelectionSystem(): null {
  const { scene, camera, raycaster, invalidate, gl } = useThree();
  const isDragging = useRef(false);
  const isMarquee = useRef(false);
  const dragStartScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** The carried pieces' smoothed speed, metres a second, and when it was last measured. */
  const carry = useRef<CarrySpeed>(CARRY_AT_REST);
  const dragItemId = useRef<string | null>(null);
  const dragGrabOffset = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  // Which hand the drag belongs to, decided at pointer-down from the tool
  // store: Select and Move share the move gesture; Rotate and Scale sweep
  // around the primary item's centre.
  const gestureKind = useRef<"move" | "rotate" | "scale">("move");
  /** Initial rotation/scale per item at drag start (rotate/scale gestures). */
  const gestureInitial = useRef<ReadonlyMap<string, number>>(new Map());
  const gestureCentre = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const gestureGrabFloor = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  /** The full moving set of the current move drag, for the release settle. */
  const lastMovingIds = useRef<ReadonlySet<string>>(new Set());
  const wallClickKey = useRef<WallKey | null>(null);
  const rightClickStart = useRef<{ x: number; y: number } | null>(null);
  const rightClickMoved = useRef(false);
  const suppressNextContextMenu = useRef(false);
  const marqueeRafId = useRef<number>(0);
  /**
   * A finger on the canvas with the selection tools idle belongs to the camera:
   * a tap until it moves past the drag threshold, then the camera's (orbit, or
   * pinch once a second finger lands) until the next first finger goes down.
   */
  const touchGesture = useRef<"tap" | "camera" | null>(null);
  const historyGesture = useRef<symbol | null>(null);
  const gestureIdMap = useRef<ReadonlyMap<string, string> | null>(null);
  const dragPointerId = useRef<number | null>(null);
  const cancelPointerGesture = useRef<() => void>(() => undefined);
  // floorCache removed — drag uses math plane intersection

  // Stable ref for invalidate — avoids effect teardown when invalidate ref changes
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const bridge: NonNullable<Window["__plannerTouch"]> = {
      mode: () => useTouchGestureStore.getState().mode,
      placed: () => usePlacementStore.getState().placedItems.map((item) => ({
        id: item.id, slug: getCatalogueItem(item.catalogueItemId)?.slug ?? null, x: item.x, z: item.z,
      })),
      arm: (slug) => {
        const item = getCatalogueItemBySlug(slug);
        if (item !== undefined) useCatalogueStore.getState().selectItem(item.id);
        return item !== undefined;
      },
    };
    window.__plannerTouch = bridge;
    return () => { if (window.__plannerTouch === bridge) delete window.__plannerTouch; };
  }, []);

  // Invalidate only when selected IDs change (not marquee/guides)
  useEffect(() => {
    let prev = useSelectionStore.getState().selectedIds;
    return useSelectionStore.subscribe((state) => {
      if (state.selectedIds !== prev) {
        prev = state.selectedIds;
        invalidateRef.current();
      }
    });
  }, []);

  // Keys (T-671 slice 5): the keymap's selection keys through the planner's one
  // keyboard owner, and Esc for a drag or a box in progress. Esc stops a drag
  // where it is (one undo step, as a cancelled pointer always has); the next
  // press clears the selection (lib/planner-keymap.ts).
  // The pointer's last place over the canvas, so Ctrl V pastes under it (Q-11).
  const lastPointer = useRef<{ readonly x: number; readonly y: number } | null>(null);
  useEffect(() => {
    const canvasEl = gl.domElement;
    const remember = (event: PointerEvent): void => { lastPointer.current = { x: event.clientX, y: event.clientY }; };
    canvasEl.addEventListener("pointermove", remember, { passive: true });
    return () => { canvasEl.removeEventListener("pointermove", remember); };
  }, [gl]);
  usePlannerKeyBindings(selectionKeyBindings({
    invalidate: () => { invalidateRef.current(); },
    cancelGesture: () => { cancelPointerGesture.current(); },
    screenUp: () => screenUpOnFloor(camera),
    pointerFloor: () => {
      const at = lastPointer.current;
      return at === null ? null : placementFloorPoint(scene, camera, raycaster, gl.domElement.getBoundingClientRect(), at.x, at.y);
    },
  }));
  useEscapeLayer("operation", {
    open: () => isDragging.current || isMarquee.current,
    onEscape: () => {
      cancelPointerGesture.current();
      invalidateRef.current();
    },
  });

  // Pointer handlers for click-select, drag-move, and marquee
  useEffect(() => {
    const canvasEl = gl.domElement;
    // Cache canvas rect — refreshed on pointer down (covers resize between interactions)
    let cachedRect = canvasEl.getBoundingClientRect();

    function interactionTargetAt(clientX: number, clientY: number): { readonly itemId: string | null; readonly wallKey: WallKey | null } {
      cachedRect = canvasEl.getBoundingClientRect();
      const ndcX = ((clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
      const ndcY = -((clientY - cachedRect.top) / cachedRect.height) * 2 + 1;
      raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);

      // Only furniture and keyed walls can answer, so a subtree that holds
      // neither (the drawn hall) is not tested at all.
      const allIntersects = intersectSelectable(raycaster, scene.children);
      const found: { itemId: string | null; wallKey: WallKey | null } = { itemId: null, wallKey: null };
      for (const inter of allIntersects) {
        if (found.itemId === null) {
          found.itemId = findFurnitureItemId(inter.object);
          if (found.itemId !== null) break;
        }
        if (found.wallKey === null) {
          const wk = findWallKey(inter.object);
          if (wk !== null) {
            found.wallKey = wk;
            break;
          }
        }
      }
      return found;
    }

    function selectionToolsAreIdle(): boolean {
      return !useMarkupStore.getState().active &&
        useCatalogueStore.getState().selectedItemId === null &&
        !useMeasurementStore.getState().active &&
        !useGuidelineStore.getState().active;
    }

    // Cancellation retains the last real placement as one undoable gesture.
    // No synthetic snap is introduced on blur, pointer cancellation or preview.
    function closePointerGesture(): void {
      cancelAnimationFrame(marqueeRafId.current);
      const token = historyGesture.current;
      historyGesture.current = null;
      gestureIdMap.current = null;
      if (token !== null) useEditorStore.getState().endHistoryGesture(token);
      const pointer = dragPointerId.current;
      dragPointerId.current = null;
      if (pointer !== null && canvasEl.hasPointerCapture(pointer)) canvasEl.releasePointerCapture(pointer);
      isDragging.current = false;
      if (isMarquee.current) useSelectionStore.getState().endMarquee();
      isMarquee.current = false;
      dragItemId.current = null;
      lastMovingIds.current = new Set();
      // Every press passes through here, so no drag inherits the speed of
      // one that was cancelled, blurred or refused mid-carry.
      carry.current = CARRY_AT_REST;
      gestureInitial.current = new Map();
      // An interrupted touch is no longer a tap, and its finger stays the camera's.
      if (touchGesture.current !== null) touchGesture.current = "camera";
      useToolStore.getState().setLiveValue(null);
      useSelectionStore.getState().setActiveGuides([]);
    }
    cancelPointerGesture.current = closePointerGesture;

    /**
     * One frame of a move drag: the pieces follow the floor point under
     * (`clientX`, `clientY`), found on a math plane rather than the floor mesh
     * so a drag works whatever the room's outline.
     */
    function moveDragTo(clientX: number, clientY: number): void {
      const floorHit = screenToFloor(clientX, clientY, cachedRect, camera, raycaster);
      const primaryId = dragItemId.current;
      if (floorHit === null || primaryId === null) return;
      const selectedIds = useSelectionStore.getState().selectedIds;
      // Read placed items once for the entire handler — consistent snapshot
      const placedItems = usePlacementStore.getState().placedItems;
      // Selected items plus their groups, seeded from the dragged item.
      const allMovingIds = dragMovingIds(primaryId, selectedIds, placedItems);
      // Move all items in the moving set (selected + group members)
      const primary = placedItems.find((p) => p.id === primaryId);
      if (primary === undefined) return;
      const frame = computeFluidFurnitureDragFrame(
        primary,
        { x: floorHit.x, z: floorHit.z },
        dragGrabOffset.current,
        placedItems,
        allMovingIds,
      );
      usePlacementStore.getState().moveItemsByDelta(allMovingIds, frame.dx, frame.dz);
      useSelectionStore.getState().setActiveGuides(frame.guides);
      lastMovingIds.current = allMovingIds;
      // Carried pieces lean a little back from the way they travel.
      if (!prefersReducedMotion()) {
        carry.current = measureCarry(carry.current, frame.dx, frame.dz, performance.now());
        if (carry.current.measured) carryFurniture(allMovingIds, carry.current.vx, carry.current.vz);
      }
      invalidateRef.current();
    }

    /** The end of a drag: a move settles onto the grid and the pieces set their weight down. */
    function settleDrop(): void {
      if (gestureKind.current === "move" && dragItemId.current !== null) {
        // Release settle: write the SNAPPED position as truth immediately
        // (undo, autosave and every footprint engine see the final value),
        // then let the visual offset decay through the gridSettle spring.
        // The whole formation takes the primary's snap delta — snapping
        // each member separately would shear a table ring apart.
        const placement = usePlacementStore.getState();
        const primary = placement.placedItems.find((p) => p.id === dragItemId.current);
        if (placement.snapEnabled && primary !== undefined && lastMovingIds.current.size > 0) {
          const snapped = snapPositionToGrid(primary.x, primary.z);
          const settleDx = snapped[0] - primary.x;
          const settleDz = snapped[2] - primary.z;
          if (settleDx !== 0 || settleDz !== 0) {
            placement.moveItemsByDelta(lastMovingIds.current, settleDx, settleDz);
            if (!prefersReducedMotion()) {
              for (const id of lastMovingIds.current) {
                beginFurnitureSettle(id, -settleDx, -settleDz);
              }
            }
            invalidateRef.current();
          }
        }
        // Let go: the pieces swing upright and set their weight down. A hand
        // that rested let the loop sleep, so the release must wake it.
        if (!prefersReducedMotion() && lastMovingIds.current.size > 0) {
          releaseFurniture(lastMovingIds.current);
          invalidateRef.current();
        }
        lastMovingIds.current = new Set();
      } else {
        useToolStore.getState().setLiveValue(null);
      }
    }

    // The touch arbiter (lib/touch-arbiter.ts), behind `touchArbiter`: it, not
    // the camera nor the ghost, decides what a finger on the room is. Its
    // listeners sit on the window's capture phase, ahead of the orbit's and of
    // this component's canvas handlers, which skip every event it took.
    const arbiter = new TouchArbiter();
    const trail = new FingerTrail();
    const arbitrated = new WeakSet<Event>();
    /** The arbiter's decision last acted on. */
    let actedMode: TouchMode = "idle";
    let touchPointer: number | null = null;
    let pressedPiece: string | null = null;
    let liftOrigin: { readonly x: number; readonly z: number } | null = null;
    let holdTimer = 0;
    let holdFrame = 0;
    let ringFrame = 0;
    const ring = createHoldRing();

    const raise = (): number => ghostRaisePx(window.innerHeight);
    const takesTouch = (event: PointerEvent): boolean => event.pointerType === "touch" && plannerFeatureEnabled("touchArbiter");

    function hideRing(): void {
      cancelAnimationFrame(ringFrame);
      ring.style.display = "none";
    }

    function tendRing(): void {
      const progress = arbiter.holdProgress(performance.now());
      if (progress !== null) {
        paintHoldRing(ring, progress);
        ring.style.display = "block";
      }
      if (arbiter.mode === "pending") ringFrame = requestAnimationFrame(tendRing);
      else hideRing();
    }

    function showRing(x: number, y: number): void {
      ring.style.left = `${String(x)}px`;
      ring.style.top = `${String(y)}px`;
      if (ring.parentElement === null) document.body.appendChild(ring);
      ringFrame = requestAnimationFrame(tendRing);
    }

    /** Takes a lifted piece back where it was: a second finger landed, or the browser cancelled the touch. */
    function returnLiftedPiece(): void {
      const origin = liftOrigin;
      liftOrigin = null;
      if (origin !== null && isDragging.current && dragItemId.current !== null) {
        const placement = usePlacementStore.getState();
        const primary = placement.placedItems.find((placed) => placed.id === dragItemId.current);
        if (primary !== undefined && lastMovingIds.current.size > 0) {
          placement.moveItemsByDelta(lastMovingIds.current, origin.x - primary.x, origin.z - primary.z);
          if (!prefersReducedMotion()) releaseFurniture(lastMovingIds.current);
        }
      }
      closePointerGesture();
      invalidateRef.current();
    }

    /** A finger held still on a piece: the piece rises above the finger and follows it, as a mouse drag carries it. */
    function beginTouchLift(): void {
      const itemId = pressedPiece;
      const finger = arbiter.finger;
      const pointerId = touchPointer;
      if (itemId === null || finger === null || pointerId === null) return;
      closePointerGesture();
      historyGesture.current = useEditorStore.getState().beginHistoryGesture();
      if (historyGesture.current === null) return;
      const placedItems = usePlacementStore.getState().placedItems;
      // A mid-settle piece is drawn off its truth: drop its springs before measuring the grab.
      for (const gid of getGroupMemberIds(itemId, placedItems)) clearFurnitureSettle(gid);
      const item = placedItems.find((placed) => placed.id === itemId);
      const floorPos = screenToFloor(finger.x, finger.y, cachedRect, camera, raycaster);
      if (item === undefined || floorPos === null) {
        closePointerGesture();
        return;
      }
      dragPointerId.current = pointerId;
      dragItemId.current = itemId;
      dragGrabOffset.current = { x: floorPos.x - item.x, z: floorPos.z - item.z };
      gestureKind.current = "move";
      liftOrigin = { x: item.x, z: item.z };
      try {
        canvasEl.setPointerCapture(pointerId);
      } catch {
        // The browser may have taken the touch already; the window still hears it.
      }
      isDragging.current = true;
      if (!useSelectionStore.getState().selectedIds.has(itemId)) useSelectionStore.getState().select(itemId);
      haptic(10);
      // It rises above the finger at once, so the finger never hides it.
      moveDragTo(finger.x, finger.y - raise());
    }

    /** Acts on what the arbiter decided, once for each change. */
    function follow(mode: TouchMode): void {
      const from = actedMode;
      if (mode === from) return;
      actedMode = mode;
      const gesture = useTouchGestureStore.getState();
      if (mode !== "pending") {
        window.clearTimeout(holdTimer);
        cancelAnimationFrame(holdFrame);
        hideRing();
      }
      if (mode === "orbit" || mode === "two") {
        // The orbit takes the finger from here (CameraRig), the pinch the pair.
        gesture.holdCamera(false);
        if (from === "place") usePlacementStore.getState().clearGhost();
        if (from === "lift") returnLiftedPiece();
        gesture.setMode(mode);
      } else if (mode === "place") {
        gesture.setFinger(arbiter.finger);
        gesture.setMode("place");
      } else if (mode === "lift") {
        gesture.setMode("lift");
        beginTouchLift();
      }
    }

    /** Sets the piece in hand down under (`x`, `y`): its ghost goes there first, as a click's does. */
    function placeInHandAt(x: number, y: number): void {
      const itemId = useCatalogueStore.getState().selectedItemId;
      const hit = itemId === null ? null : placementFloorPoint(scene, camera, raycaster, canvasEl.getBoundingClientRect(), x, y);
      if (itemId !== null && hit !== null) {
        usePlacementStore.getState().updateGhost(hit.x, hit.z, itemId);
        placePieceInHand(() => { invalidateRef.current(); });
      }
      // A finger leaves no hover: the ghost goes once the piece is down.
      usePlacementStore.getState().clearGhost();
    }

    /** What a finished touch comes to. */
    function settleTouch(outcome: TouchOutcome, ended: TouchMode): void {
      if (outcome.kind === "tap") {
        // A tap on a placed piece with a card in hand picks the piece and puts the card down (Q-05).
        const picked = outcome.armed && plannerFeatureEnabled("truthfulGhost") ? interactionTargetAt(outcome.x, outcome.y).itemId : null;
        if (picked !== null) {
          useCatalogueStore.getState().disarm();
          usePlacementStore.getState().clearGhost();
          useSelectionStore.getState().select(picked);
        } else if (outcome.armed) {
          placeInHandAt(outcome.x, outcome.y);
        } else {
          const found = interactionTargetAt(outcome.x, outcome.y);
          if (found.itemId !== null) useSelectionStore.getState().select(found.itemId);
          else if (found.wallKey !== null) useVisibilityStore.getState().toggleWall(found.wallKey);
          else useSelectionStore.getState().clearSelection();
        }
      } else if (outcome.kind === "place") {
        // Where the ghost was seen: a finger rolls as it leaves the glass.
        const finger = trail.at(outcome.at - LIFT_OFF_JITTER_MS);
        if (finger !== null) placeInHandAt(finger.x, finger.y - raise());
      } else if (outcome.kind === "drop") {
        liftOrigin = null;
        if (isDragging.current) settleDrop();
        closePointerGesture();
      } else if (ended === "place") {
        usePlacementStore.getState().clearGhost();
      }
      invalidateRef.current();
    }

    function forgetTouch(): void {
      window.clearTimeout(holdTimer);
      cancelAnimationFrame(holdFrame);
      hideRing();
      actedMode = "idle";
      touchPointer = null;
      pressedPiece = null;
    }

    function onTouchDown(event: PointerEvent): void {
      if (!takesTouch(event) || event.target !== canvasEl) return;
      const at = event.timeStamp;
      if (!arbiter.idle) {
        arbitrated.add(event);
        follow(arbiter.press({ pointerId: event.pointerId, at, x: event.clientX, y: event.clientY, armed: false, onPiece: false }));
        return;
      }
      // Tools with gestures of their own, Walk's look and a history preview keep the finger as before.
      if (useMarkupStore.getState().active || useMeasurementStore.getState().active || useGuidelineStore.getState().active
        || useCockpitStore.getState().walkMode || useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
      arbitrated.add(event);
      const armed = useCatalogueStore.getState().selectedItemId !== null;
      pressedPiece = armed ? null : interactionTargetAt(event.clientX, event.clientY).itemId;
      touchPointer = event.pointerId;
      trail.clear();
      trail.record(at, event.clientX, event.clientY);
      actedMode = arbiter.press({ pointerId: event.pointerId, at, x: event.clientX, y: event.clientY, armed, onPiece: pressedPiece !== null });
      useTouchGestureStore.getState().setMode(actedMode);
      const hold = armed ? PLACE_HOLD_MS : pressedPiece !== null ? LIFT_HOLD_MS : null;
      // The hold is judged a frame after its timer: a page too busy to run the timer on time
      // may still hold the finger's moves, and the browser hands queued moves over before a
      // frame's callbacks, so a swipe it was late to deliver is read as the swipe it was.
      if (hold !== null) holdTimer = window.setTimeout(() => { holdFrame = requestAnimationFrame(() => { follow(arbiter.tick(performance.now())); }); }, hold);
      if (pressedPiece !== null) showRing(event.clientX, event.clientY);
    }

    function onTouchMove(event: PointerEvent): void {
      if (arbiter.idle || !takesTouch(event)) return;
      arbitrated.add(event);
      const token = historyGesture.current;
      if (actedMode === "lift" && token !== null && !useEditorStore.getState().isHistoryGestureCurrent(token)) {
        // The save that carried this drag was replaced: stop where it is, as a mouse drag does.
        onTouchCancel(event);
        return;
      }
      // A busy page hands a frame's moves over as one event reporting the last: each
      // sample is read at its own time, so a swipe made before the hold is a swipe.
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      let mode = arbiter.mode;
      for (const sample of coalesced.length > 0 ? coalesced : [event]) {
        mode = arbiter.move(event.pointerId, sample.timeStamp, sample.clientX, sample.clientY);
        follow(mode);
        if (event.pointerId === touchPointer && (mode === "pending" || mode === "place" || mode === "lift")) {
          trail.record(sample.timeStamp, sample.clientX, sample.clientY);
        }
      }
      if (mode !== "pending" && mode !== "place" && mode !== "lift") return;
      const gesture = useTouchGestureStore.getState();
      // The orbit must not turn the room while the finger may yet place, lift or tap.
      gesture.holdCamera(true);
      if (event.pointerId !== touchPointer) return;
      const finger = arbiter.finger;
      if (finger === null) return;
      if (mode === "place") gesture.setFinger(finger);
      else if (mode === "lift" && isDragging.current) moveDragTo(finger.x, finger.y - raise());
    }

    function onTouchUp(event: PointerEvent): void {
      if (arbiter.idle || !takesTouch(event)) return;
      arbitrated.add(event);
      const ended = actedMode;
      const outcome = arbiter.release(event.pointerId, event.timeStamp, event.clientX, event.clientY);
      // The gesture ends with its last finger.
      if (arbiter.fingers > 0) return;
      forgetTouch();
      settleTouch(outcome, ended);
      useTouchGestureStore.getState().end(event.timeStamp);
    }

    function onTouchCancel(event?: Event): void {
      if (arbiter.idle) return;
      if (event !== undefined) arbitrated.add(event);
      const ended = actedMode;
      arbiter.cancel();
      forgetTouch();
      if (ended === "lift") returnLiftedPiece();
      else if (ended === "place") usePlacementStore.getState().clearGhost();
      useTouchGestureStore.getState().end(performance.now());
      invalidateRef.current();
    }

    function onTouchCancelEvent(event: PointerEvent): void {
      if (takesTouch(event)) onTouchCancel(event);
    }

    function onTouchBlur(): void {
      onTouchCancel();
    }

    function onPointerDown(event: PointerEvent): void {
      if (arbitrated.has(event)) return;
      // A second finger never starts a gesture of its own; with the first
      // finger the camera's, the pair is its pinch.
      if (event.pointerType === "touch" && !event.isPrimary) {
        if (touchGesture.current !== null) touchGesture.current = "camera";
        return;
      }
      touchGesture.current = null;
      if (event.button === 2) {
        rightClickStart.current = { x: event.clientX, y: event.clientY };
        rightClickMoved.current = false;
        return;
      }
      if (useMarkupStore.getState().active) return;
      // Only handle left-click
      if (event.button !== 0) return;
      // Don't interfere with placement mode
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      // Don't interfere with measurement or guideline tools
      if (useMeasurementStore.getState().active || useGuidelineStore.getState().active) return;

      closePointerGesture();
      dragPointerId.current = event.pointerId;

      dragStartScreen.current = { x: event.clientX, y: event.clientY };
      isDragging.current = false;
      isMarquee.current = false;
      dragItemId.current = null;
      wallClickKey.current = null;

      // Mobile one-finger drag is the camera gesture. Do not start the
      // selection/marquee pipeline until pointer-up proves this was a tap.
      // This keeps orbiting snappy and preserves tap-to-select.
      if (event.pointerType === "touch" && event.isPrimary && selectionToolsAreIdle()) {
        touchGesture.current = "tap";
        return;
      }

      // Refresh cached rect at interaction start (handles canvas resize)
      cachedRect = canvasEl.getBoundingClientRect();

      // Raycast to find if we clicked on a placed furniture item
      const found = interactionTargetAt(event.clientX, event.clientY);
      dragItemId.current = found.itemId;
      wallClickKey.current = found.wallKey;
      dragGrabOffset.current = { x: 0, z: 0 };
      if (found.itemId !== null) {
        // Track accepted INSERT IDs from the press, including the interval
        // before movement crosses the drag threshold. No history is recorded
        // until a real transform occurs; every release closes this token.
        historyGesture.current = useEditorStore.getState().beginHistoryGesture();
        if (historyGesture.current === null) { closePointerGesture(); return; }
        const placedItems = usePlacementStore.getState().placedItems;
        // Grab-interrupt: a mid-settle object is visually offset from store
        // truth; drop its springs BEFORE measuring the grab so the drag maths
        // stay blind to the animation layer.
        for (const gid of getGroupMemberIds(found.itemId, placedItems)) {
          clearFurnitureSettle(gid);
        }
        const floorPos = screenToFloor(event.clientX, event.clientY, cachedRect, camera, raycaster);
        const item = placedItems.find((placed) => placed.id === found.itemId);
        if (floorPos !== null && item !== undefined) {
          dragGrabOffset.current = {
            x: floorPos.x - item.x,
            z: floorPos.z - item.z,
          };
          gestureCentre.current = { x: item.x, z: item.z };
          gestureGrabFloor.current = { x: floorPos.x, z: floorPos.z };
        }
        const tool = useToolStore.getState().activeTool;
        gestureKind.current = tool === "rotate" ? "rotate" : tool === "scale" ? "scale" : "move";
      }
    }

    function onMouseDown(event: MouseEvent): void {
      if (useMarkupStore.getState().active) return;
      if (event.button === 2) {
        rightClickStart.current = { x: event.clientX, y: event.clientY };
        rightClickMoved.current = false;
      }
    }

    function openCameraReferenceDraft(clientX: number, clientY: number): void {
      if (useMarkupStore.getState().active) return;
      if (useBookmarkStore.getState().activeReferenceId !== null) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      if (useMeasurementStore.getState().active || useGuidelineStore.getState().active) return;

      cachedRect = canvasEl.getBoundingClientRect();
      const floorPos = screenToFloor(clientX, clientY, cachedRect, camera, raycaster);
      if (floorPos === null) return;

      const ndcX = ((clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
      const ndcY = -((clientY - cachedRect.top) / cachedRect.height) * 2 + 1;
      raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);
      const intersects = raycaster.intersectObjects(findFurnitureGroups(scene), true);
      let placedId: string | null = null;
      for (const inter of intersects) {
        placedId = findFurnitureItemId(inter.object);
        if (placedId !== null) break;
      }

      if (placedId !== null) {
        const item = usePlacementStore.getState().placedItems.find((placed) => placed.id === placedId);
        if (item !== undefined) {
          const catalogueItem = getCatalogueItem(item.catalogueItemId);
          const label = catalogueItem?.name ?? "Furniture";
          const furnitureCategory = catalogueItem?.category === "chair"
            ? "chair"
            : catalogueItem?.category === "table"
              ? "table"
              : "other";
          useCameraReferenceStore.getState().openDraft({
            screenX: clientX,
            screenY: clientY,
            source: "furniture",
            sourceLabel: label,
            placedItemId: item.id,
            furnitureCategory,
            point: [item.x, item.z],
            baseY: item.y,
            yaw: item.rotationY,
            suggestedName: (item.label ?? "").trim().length > 0 ? item.label ?? label : label,
          });
          return;
        }
      }

      useCameraReferenceStore.getState().openDraft({
        screenX: clientX,
        screenY: clientY,
        source: "floor",
        sourceLabel: "Floor grid",
        point: [floorPos.x, floorPos.z],
        baseY: 0,
        yaw: null,
        suggestedName: "Floor POV",
      });
    }

    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
      if (useMarkupStore.getState().active) {
        rightClickStart.current = null;
        return;
      }
      if (suppressNextContextMenu.current) {
        suppressNextContextMenu.current = false;
        return;
      }
      // Contextmenu coordinates differ across platforms, especially on Linux
      // Chromium in CI. Keep this path as browser-menu suppression only; the
      // right-button release handler owns true-click POV creation.
    }

    function onPointerMove(event: PointerEvent): void {
      if (arbitrated.has(event)) return;
      const token = historyGesture.current;
      if (token !== null && (!useEditorStore.getState().isHistoryGestureCurrent(token) || !selectionToolsAreIdle())) {
        closePointerGesture();
        return;
      }
      if (token !== null && event.pointerId !== dragPointerId.current) return;
      if (useMarkupStore.getState().active) return;
      if (event.pointerType === "touch" && touchGesture.current !== null) {
        if (
          touchGesture.current === "tap"
          && screenDistance(
            dragStartScreen.current.x,
            dragStartScreen.current.y,
            event.clientX,
            event.clientY,
          ) > DRAG_THRESHOLD_PX
        ) {
          touchGesture.current = "camera";
        }
        return;
      }
      if ((event.buttons & 2) !== 0 && rightClickStart.current !== null) {
        rightClickMoved.current =
          rightClickMoved.current ||
          screenDistance(rightClickStart.current.x, rightClickStart.current.y, event.clientX, event.clientY) > DRAG_THRESHOLD_PX;
      }
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      if ((event.buttons & 1) === 0) return; // Left button not held

      const dist = screenDistance(
        dragStartScreen.current.x,
        dragStartScreen.current.y,
        event.clientX,
        event.clientY,
      );

      // Haven't exceeded drag threshold yet
      if (!isDragging.current && !isMarquee.current && dist <= DRAG_THRESHOLD_PX) return;

      // Starting a new drag action
      if (!isDragging.current && !isMarquee.current) {
        if (dragItemId.current !== null) {
          // Furniture was clicked — start drag-move
          if (historyGesture.current === null) return;
          isDragging.current = true;
          try {
            canvasEl.setPointerCapture(event.pointerId);
          } catch {
            // The browser may have cancelled this pointer before capture.
            closePointerGesture();
            return;
          }
          if (!useSelectionStore.getState().selectedIds.has(dragItemId.current)) {
            useSelectionStore.getState().select(dragItemId.current);
          }
          // Rotate/Scale sweep from each item's value at drag start.
          if (gestureKind.current !== "move") {
            const placedItems = usePlacementStore.getState().placedItems;
            const ids = useSelectionStore.getState().selectedIds;
            const initial = new Map<string, number>();
            for (const item of placedItems) {
              if (!ids.has(item.id) && item.id !== dragItemId.current) continue;
              if (!isSceneFurniturePlacement(item)) continue;
              initial.set(
                item.id,
                gestureKind.current === "rotate"
                  ? item.rotationY
                  : normalizeFurnitureScale(item.scale),
              );
            }
            gestureInitial.current = initial;
          }
        } else if (wallClickKey.current !== null) {
          // Preserve wall click-to-disassemble when the pointer jitters a few
          // pixels over the wall plane; don't convert that interaction into a
          // marquee drag.
          return;
        } else {
          // Empty space — start marquee. Hold the pointer as a furniture drag
          // does: a release over the chrome above the canvas (a disabled
          // button receives no events at all) must still end the box.
          try {
            canvasEl.setPointerCapture(event.pointerId);
          } catch {
            closePointerGesture();
            return;
          }
          isMarquee.current = true;
          const floorPos = screenToFloor(
            dragStartScreen.current.x,
            dragStartScreen.current.y,
            cachedRect,
            camera,
            raycaster,
          );
          useSelectionStore.getState().startMarquee(
            dragStartScreen.current.x,
            dragStartScreen.current.y,
            floorPos?.x ?? 0,
            floorPos?.z ?? 0,
          );
        }
      }

      if (isMarquee.current) {
        // Coalesce marquee updates to one per animation frame — pointer events
        // can fire far more often than the display refreshes, wasting GPU cycles.
        const clientX = event.clientX;
        const clientY = event.clientY;
        const additiveKey = event.shiftKey || event.ctrlKey || event.metaKey;

        cancelAnimationFrame(marqueeRafId.current);
        marqueeRafId.current = requestAnimationFrame(() => {
          // Update marquee end point (screen + world coords)
          const floorPos = screenToFloor(clientX, clientY, cachedRect, camera, raycaster);
          useSelectionStore.getState().updateMarquee(
            clientX,
            clientY,
            floorPos?.x ?? 0,
            floorPos?.z ?? 0,
          );

          // Live preview: find items inside marquee rectangle
          const rect = computeMarqueeRect(
            dragStartScreen.current.x,
            dragStartScreen.current.y,
            clientX,
            clientY,
          );

          const placedItems = usePlacementStore.getState().placedItems;
          const idsInRect: string[] = [];
          for (const placed of placedItems) {
            if (!isSceneFurniturePlacement(placed)) continue;
            _worldPos.set(placed.x, placed.y, placed.z);
            _worldPos.project(camera);
            const screenX = (_worldPos.x * 0.5 + 0.5) * cachedRect.width + cachedRect.left;
            const screenY = (-_worldPos.y * 0.5 + 0.5) * cachedRect.height + cachedRect.top;
            if (isPointInRect(screenX, screenY, rect)) {
              idsInRect.push(placed.id);
            }
          }

          if (additiveKey) {
            const existing = useSelectionStore.getState().selectedIds;
            const sceneIds = new Set(
              placedItems.filter(isSceneFurniturePlacement).map((placed) => placed.id),
            );
            const merged = [...existing].filter((id) => sceneIds.has(id)).concat(idsInRect);
            useSelectionStore.getState().selectMultiple(merged);
          } else {
            useSelectionStore.getState().selectMultiple(idsInRect);
          }

          invalidateRef.current();
        });
        return;
      }

      if (isDragging.current && dragItemId.current !== null && gestureKind.current !== "move") {
        // Rotate/Scale — the pointer sweeps around the primary item's centre;
        // every selected item takes the same delta on its own initial value.
        // One batched store write per frame, and the live readout feeds the
        // pill's value chip.
        const floorHit = screenToFloor(event.clientX, event.clientY, cachedRect, camera, raycaster);
        if (floorHit !== null && gestureInitial.current.size > 0) {
          const rotate = gestureKind.current === "rotate";
          const free = event.shiftKey;
          const next = new Map<string, number>();
          let readout: string | null = null;
          for (const [id, initial] of gestureInitial.current) {
            const value = rotate
              ? rotationFromDrag(gestureCentre.current, gestureGrabFloor.current, floorHit, initial, free)
              : scaleFromDrag(gestureCentre.current, gestureGrabFloor.current, floorHit, initial, free);
            next.set(id, value);
            readout ??= rotate ? formatDegrees(value) : formatScale(value);
          }
          const placement = usePlacementStore.getState();
          if (rotate) placement.rotateItemsTo(next);
          else placement.scaleItemsTo(next);
          useToolStore.getState().setLiveValue(readout);
          invalidateRef.current();
        }
        return;
      }

      if (isDragging.current && dragItemId.current !== null) moveDragTo(event.clientX, event.clientY);
    }

    function onMouseMove(event: MouseEvent): void {
      if ((event.buttons & 2) === 0 || rightClickStart.current === null) return;
      rightClickMoved.current =
        rightClickMoved.current ||
        screenDistance(rightClickStart.current.x, rightClickStart.current.y, event.clientX, event.clientY) > DRAG_THRESHOLD_PX;
    }

    function handleRightButtonRelease(event: PointerEvent | MouseEvent): boolean {
      if (event.button === 2) {
        const start = rightClickStart.current;
        rightClickStart.current = null;
        if (
          start !== null &&
          !rightClickMoved.current &&
          screenDistance(start.x, start.y, event.clientX, event.clientY) <= DRAG_THRESHOLD_PX
        ) {
          event.preventDefault();
          suppressNextContextMenu.current = true;
          openCameraReferenceDraft(event.clientX, event.clientY);
        } else if (start !== null) {
          suppressNextContextMenu.current = true;
        }
        rightClickMoved.current = false;
        return true;
      }
      return false;
    }

    function onPointerUp(event: PointerEvent): void {
      if (arbitrated.has(event)) return;
      if (historyGesture.current !== null) {
        if (event.pointerId !== dragPointerId.current) return;
        if (!selectionToolsAreIdle() || !useEditorStore.getState().isHistoryGestureCurrent(historyGesture.current)) {
          closePointerGesture();
          return;
        }
      }
      if (useMarkupStore.getState().active) return;
      if (handleRightButtonRelease(event)) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      // Don't interfere with measurement or guideline tools
      if (useMeasurementStore.getState().active || useGuidelineStore.getState().active) return;

      if (event.pointerType === "touch" && touchGesture.current !== null) {
        // The camera's gesture leaves the selection as it was.
        if (touchGesture.current !== "tap") return;
        touchGesture.current = null;
        const found = interactionTargetAt(event.clientX, event.clientY);
        if (found.itemId !== null) {
          useSelectionStore.getState().select(found.itemId);
        } else if (found.wallKey !== null) {
          useVisibilityStore.getState().toggleWall(found.wallKey);
        } else {
          useSelectionStore.getState().clearSelection();
        }
        invalidateRef.current();
        return;
      }
      touchGesture.current = null;
      if (event.button !== 0) return;

      if (isMarquee.current) {
        // Cancel any pending rAF from marquee drag
        cancelAnimationFrame(marqueeRafId.current);
        // End marquee — selection was already updated live
        useSelectionStore.getState().endMarquee();
        isMarquee.current = false;
        invalidateRef.current();
        return;
      }

      if (!isDragging.current) {
        // This was a click, not a drag
        if (dragItemId.current !== null) {
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            useSelectionStore.getState().toggleSelect(dragItemId.current);
          } else {
            useSelectionStore.getState().select(dragItemId.current);
          }
        } else if (wallClickKey.current !== null) {
          useVisibilityStore.getState().toggleWall(wallClickKey.current);
          wallClickKey.current = null;
        } else {
          // Clicked on empty space — clear selection
          useSelectionStore.getState().clearSelection();
        }
        invalidateRef.current();
      }

      // Clear snap guides when interaction ends
      useSelectionStore.getState().setActiveGuides([]);
      if (isDragging.current) settleDrop();
      // Clicks close the pending token too; grid settle above belongs to the
      // same transaction as pointer frames when an actual drag occurred.
      closePointerGesture();
      isDragging.current = false;
      isMarquee.current = false;
      dragItemId.current = null;
    }

    function onMouseUp(event: MouseEvent): void {
      if (useMarkupStore.getState().active) return;
      handleRightButtonRelease(event);
    }

    function onOutsidePointerUp(event: PointerEvent): void {
      if (arbitrated.has(event)) return;
      if (event.target === canvasEl || event.pointerId !== dragPointerId.current) return;
      if (isDragging.current) onPointerUp(event);
      else closePointerGesture();
    }

    function onPointerCancel(event: PointerEvent): void {
      if (arbitrated.has(event)) return;
      if (event.pointerId === dragPointerId.current) closePointerGesture();
    }

    function onDblClick(event: MouseEvent): void {
      if (useMarkupStore.getState().active) return;
      if (event.button !== 0) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      if (useMeasurementStore.getState().active || useGuidelineStore.getState().active) return;

      // Find which placed item was double-clicked
      cachedRect = canvasEl.getBoundingClientRect();
      const ndcX = ((event.clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
      const ndcY = -((event.clientY - cachedRect.top) / cachedRect.height) * 2 + 1;
      raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);

      const dblClickFurniture = findFurnitureGroups(scene);
      const intersects = raycaster.intersectObjects(dblClickFurniture, true);
      if (intersects.length === 0) return;

      const hitObj = intersects[0]?.object;
      if (hitObj === undefined) return;

      const placedId = findFurnitureItemId(hitObj);
      if (placedId === null) return;

      const placedItems = usePlacementStore.getState().placedItems;
      const item = placedItems.find((p) => p.id === placedId);
      if (item === undefined || item.groupId === null) return;

      const catItem = getCatalogueItem(item.catalogueItemId);
      if (catItem === undefined) return;

      if (isDiningTableItem(catItem) && catItem.tableShape !== null) {
        // Double-click on table in a group → edit chair count
        useChairDialogStore.getState().showDialog({
          catalogueItemId: item.catalogueItemId,
          x: item.x,
          z: item.z,
          rotationY: item.rotationY,
          tableShape: catItem.tableShape,
          ...(item.scale === undefined ? {} : { scale: item.scale }),
        }, item.id);
      } else if (catItem.category === "chair") {
        // Double-click on chair in a group → break it out
        usePlacementStore.getState().breakFromGroup(placedId);
        useSelectionStore.getState().select(placedId);
        invalidateRef.current();
      }
    }

    window.addEventListener("pointerdown", onTouchDown, true);
    window.addEventListener("pointermove", onTouchMove, true);
    window.addEventListener("pointerup", onTouchUp, true);
    window.addEventListener("pointercancel", onTouchCancelEvent, true);
    window.addEventListener("blur", onTouchBlur);
    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("mousedown", onMouseDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("mousemove", onMouseMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerCancel);
    canvasEl.addEventListener("lostpointercapture", onPointerCancel);
    window.addEventListener("pointerup", onOutsidePointerUp);
    window.addEventListener("blur", closePointerGesture);
    canvasEl.addEventListener("mouseup", onMouseUp);
    canvasEl.addEventListener("contextmenu", onContextMenu);
    canvasEl.addEventListener("dblclick", onDblClick);
    const unsubscribeEditor = useEditorStore.subscribe((state) => {
      const token = historyGesture.current;
      if (token === null) return;
      const ids = state.historyGestureIdMap(token);
      if (ids === null) { closePointerGesture(); return; }
      if (ids === gestureIdMap.current) return;
      gestureIdMap.current = ids;
      // Only the accepted save's map can identify the same captured objects.
      // Preserve grab offsets/initial values: an INSERT ACK is not a new drag.
      if (dragItemId.current !== null) dragItemId.current = ids.get(dragItemId.current) ?? dragItemId.current;
      lastMovingIds.current = new Set([...lastMovingIds.current].map((id) => ids.get(id) ?? id));
      gestureInitial.current = new Map([...gestureInitial.current].map(([id, value]) => [ids.get(id) ?? id, value]));
    });
    const unsubscribePreview = useLayoutTimelinePreviewStore.subscribe((state) => {
      if (state.mode !== "inactive") closePointerGesture();
    });

    return () => {
      unsubscribeEditor();
      unsubscribePreview();
      onTouchCancel();
      ring.remove();
      window.removeEventListener("pointerdown", onTouchDown, true);
      window.removeEventListener("pointermove", onTouchMove, true);
      window.removeEventListener("pointerup", onTouchUp, true);
      window.removeEventListener("pointercancel", onTouchCancelEvent, true);
      window.removeEventListener("blur", onTouchBlur);
      closePointerGesture();
      cancelPointerGesture.current = () => undefined;
      cancelAnimationFrame(marqueeRafId.current);
      touchGesture.current = null;
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("mousedown", onMouseDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onMouseMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointercancel", onPointerCancel);
      canvasEl.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("pointerup", onOutsidePointerUp);
      window.removeEventListener("blur", closePointerGesture);
      canvasEl.removeEventListener("mouseup", onMouseUp);
      canvasEl.removeEventListener("contextmenu", onContextMenu);
      canvasEl.removeEventListener("dblclick", onDblClick);
    };
  }, [scene, camera, raycaster, gl]);

  return null;
}
