import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Object3D, Vector3, type Group } from "three";

/** Reusable vector for the warm-up copy's place ahead of the camera. */
const _ahead = new Vector3();

import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useTouchGestureStore } from "../stores/touch-gesture-store.js";
import { getCatalogueItem, type CatalogueItem } from "../lib/catalogue.js";
import { PLACEMENT_COLOR_VALID, PLACEMENT_COLOR_INVALID } from "../lib/placement.js";
import type { PlacedItem } from "../lib/placement.js";
import { usePlannerKeyBindings } from "../lib/planner-keys.js";
import { placingKeyBindings, putDownPieceInHand } from "../lib/planner-keymap.js";
import { computeSnapGuides } from "../lib/snap-guide.js";
import {
  findNearestDiningTable,
  findNearestTable,
  CLOTH_SNAP_DISTANCE_RENDER,
} from "../lib/cloth-snap.js";
import { normalizeFurnitureScale } from "../lib/furniture-scale.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { TableClothMesh } from "./meshes/TableClothMesh.js";
import { TableSettingMesh } from "./meshes/TableSettingMesh.js";
import { ClothPreview } from "./cloth/ClothPreview.js";
import { ConstraintViolationSkin } from "./ConstraintViolationSkin.js";
import {
  TABLE_CLOTH_COLORS,
  tableClothStyleForCatalogueItem,
  tableDressingTargetIds,
  tableGroupedChairCount,
  tableSettingForCatalogueItem,
} from "../lib/table-dressing.js";
import { computeChairBrushSummary, type ChairBrushPoint } from "../lib/chair-brush.js";
import { placementFloorPoint } from "../lib/planner-interaction-floor.js";
import { capReachedLine } from "../lib/placement-cap.js";
import { placePieceInHand } from "../lib/place-in-hand.js";
import { ghostRaisePx } from "../lib/touch-arbiter.js";

// ---------------------------------------------------------------------------
// PlacementGhost — ghost mesh following cursor during drag-and-drop placement
// ---------------------------------------------------------------------------

export { isCloth, isPoseurTable, isTableSetting } from "../lib/placement-ghost.js";

/** Frames the piece in hand is drawn, too small to see, as it is armed: enough for its materials to compile. */
const WARM_FRAMES = 3;
/** Frames the warm-up waits for React to show the ghost before it gives up on it. */
const WARM_WAIT_FRAMES = 30;

/** Whether a frame drawn now would draw any mesh of `group`: one shown, under parents all shown. */
function drawsSomething(group: Object3D): boolean {
  let found = false;
  group.traverseVisible((object) => {
    if ((object as { readonly isMesh?: boolean }).isMesh === true) found = true;
  });
  return found;
}
const WARM_SCALE = 1e-4;
/** A click this soon after a touch the arbiter handled is that touch's own compatibility click, ms. */
const ARBITRATED_CLICK_MS = 700;

/** A pointer to follow on the next frame: a move, or the finger the touch arbiter raised the ghost above. */
interface PendingPointer {
  readonly x: number;
  readonly y: number;
  readonly buttons: number;
  /** Whether the pointer is over the canvas, or null to ask the page (a drag the catalogue holds). */
  readonly onCanvas: boolean | null;
  /** From the touch arbiter's raised finger. */
  readonly touch: boolean;
}

/**
 * Handles drag-and-drop furniture placement from the shop bar:
 * 1. User drags item from shop bar (dragActive=true, selectedItemId set)
 * 2. Pointer moves over canvas → ghost follows via raycasting to floor
 * 3. Pointer released → places item at ghost position
 *
 * Also supports click-to-place mode (select then click). A finger on a
 * phone is the touch arbiter's (SelectionSystem): it raises the ghost above
 * the finger through the touch gesture store, and places on the lift.
 *
 * Moves are followed once a frame, not once an event: the latest pointer is
 * kept and the next frame raycasts, snaps and draws the guides for it. The
 * ghost moves by ref, so React commits only when its validity, reason or
 * turn changes.
 */
export function PlacementGhost(): React.ReactElement | null {
  const { invalidate, scene, camera, raycaster, gl } = useThree();
  const selectedItemId = useCatalogueStore((s) => s.selectedItemId);
  const hasGhost = usePlacementStore((s) => s.ghostPosition !== null);
  const ghostRotation = usePlacementStore((s) => s.ghostRotation);
  const ghostValid = usePlacementStore((s) => s.ghostValid);
  const ghostInvalidReason = usePlacementStore((s) => s.ghostInvalidReason);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const dressing = selectedItemId !== null
    && (tableClothStyleForCatalogueItem(selectedItemId) !== null || tableSettingForCatalogueItem(selectedItemId) !== null);
  // A dressing's preview snaps to the table under it, so it follows in React.
  const dressingPosition = usePlacementStore((s) => (dressing ? s.ghostPosition : null));
  const [chairBrushPreview, setChairBrushPreview] = useState<readonly ChairBrushPoint[]>([]);
  const chairBrushStartRef = useRef<{ readonly x: number; readonly z: number } | null>(null);
  const chairBrushEndRef = useRef<{ readonly x: number; readonly z: number } | null>(null);
  const chairBrushActiveRef = useRef(false);
  const suppressClickAfterBrushRef = useRef(false);
  const pendingPointer = useRef<PendingPointer | null>(null);
  const followPointer = useRef<(pointer: PendingPointer) => void>(() => undefined);
  const [warming, setWarming] = useState(false);
  const warmFrames = useRef(0);
  const warmWaits = useRef(0);

  // Stable ref for invalidate — avoids effect re-runs when invalidate ref changes
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  // The piece's ghost moves by ref: a pointer move commits nothing to React.
  // Only a three object has a place (the planner's DOM tests render this tree into the page).
  const ghost = useRef<Object3D | null>(null);
  const ghostRef = useCallback((group: Group | null) => {
    ghost.current = group instanceof Object3D ? group : null;
    const position = usePlacementStore.getState().ghostPosition;
    if (ghost.current !== null && position !== null) ghost.current.position.set(position[0], position[1], position[2]);
  }, []);
  useEffect(() => usePlacementStore.subscribe((state, previous) => {
    const position = state.ghostPosition;
    if (position !== previous.ghostPosition && position !== null) ghost.current?.position.set(position[0], position[1], position[2]);
  }), []);

  // Warm the ghost on arm: the piece is built and drawn, too small to see,
  // just ahead of the camera, for its first frames in hand, so its materials
  // compile as it is armed rather than on the first frame of a drag.
  useEffect(() => {
    if (selectedItemId === null || dressing) return;
    warmFrames.current = WARM_FRAMES;
    warmWaits.current = 0;
    setWarming(true);
    invalidateRef.current();
  }, [selectedItemId, dressing]);

  useFrame(() => {
    const pointer = pendingPointer.current;
    if (pointer !== null) {
      pendingPointer.current = null;
      followPointer.current(pointer);
    }
    if (warmFrames.current === 0) return;
    const group = ghost.current;
    // Nothing of the piece to warm here (the chair brush or a cloth draws in its place): the warm-up ends.
    if (group === null) {
      warmFrames.current = 0;
      setWarming(false);
      return;
    }
    // A warm frame counts once the ghost draws something: React shows the ghost a commit after the piece
    // is armed, and its model's meshes can arrive later still; a frame before then warms nothing (the
    // ghost's shaders then compiled on the first frame of a drag). A ghost that never shows is not waited
    // on for long.
    if (!drawsSomething(group) && warmWaits.current < WARM_WAIT_FRAMES) {
      warmWaits.current += 1;
      invalidateRef.current();
      return;
    }
    if (usePlacementStore.getState().ghostPosition === null) {
      camera.getWorldDirection(_ahead);
      group.position.copy(camera.position).addScaledVector(_ahead, 1);
    }
    warmFrames.current -= 1;
    if (warmFrames.current === 0) setWarming(false);
    invalidateRef.current();
  });

  // Raycasting: update ghost on pointer move, place on pointer up (drag) or click.
  // All handlers read selectedItemId from the store (not the closure) to avoid stale values.
  useEffect(() => {
    if (selectedItemId === null) return;

    const canvasEl = gl.domElement;

    canvasEl.style.cursor = "crosshair";

    // The canvas's place on the page, kept current by its observer rather than read on every move.
    let rect = canvasEl.getBoundingClientRect();
    const remeasure = (): void => { rect = canvasEl.getBoundingClientRect(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observer?.observe(canvasEl);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);

    /** The floor point under (clientX, clientY), or null when a panel covers the canvas there or it is off the room. */
    function raycastToFloor(clientX: number, clientY: number): { x: number; z: number } | null {
      if (document.elementFromPoint(clientX, clientY) !== canvasEl) return null;
      return placementFloorPoint(scene, camera, raycaster, rect, clientX, clientY);
    }

    function clearChairBrush(): void {
      chairBrushStartRef.current = null;
      chairBrushEndRef.current = null;
      chairBrushActiveRef.current = false;
      setChairBrushPreview([]);
    }

    function selectedChairItem(itemId: string | null): CatalogueItem | null {
      if (itemId === null) return null;
      const item = getCatalogueItem(itemId);
      return item?.category === "chair" ? item : null;
    }

    function updateChairBrush(itemId: string, hit: { readonly x: number; readonly z: number }, buttons: number): void {
      const item = selectedChairItem(itemId);
      if (item === null || (buttons & 1) === 0) return;
      if (chairBrushStartRef.current === null) {
        chairBrushStartRef.current = hit;
      }
      const start = chairBrushStartRef.current;
      const summary = computeChairBrushSummary(
        item,
        start.x,
        start.z,
        hit.x,
        hit.z,
        usePlacementStore.getState().ghostRotation,
      );
      if (summary.points.length > 1) {
        chairBrushActiveRef.current = true;
        chairBrushEndRef.current = hit;
        setChairBrushPreview(summary.points);
      } else if (!chairBrushActiveRef.current) {
        setChairBrushPreview([]);
      }
    }

    // One pointer a frame: the raycast, the snaps and the guides.
    followPointer.current = (pointer) => {
      const itemId = useCatalogueStore.getState().selectedItemId;
      if (itemId === null) return;
      // A raised ghost the finger has since let go of, or turned into a look round, stays down.
      if (pointer.touch && useTouchGestureStore.getState().mode !== "place") return;
      const onCanvas = pointer.onCanvas ?? document.elementFromPoint(pointer.x, pointer.y) === canvasEl;
      const hit = onCanvas ? placementFloorPoint(scene, camera, raycaster, rect, pointer.x, pointer.y) : null;
      if (hit === null) return;
      usePlacementStore.getState().updateGhost(hit.x, hit.z, itemId);
      // Compute snap alignment guides at the ghost's snapped position
      const placeState = usePlacementStore.getState();
      if (placeState.ghostPosition !== null) {
        const guides = computeSnapGuides(
          placeState.ghostPosition[0], placeState.ghostPosition[2],
          itemId, placeState.ghostRotation, placeState.placedItems, new Set(),
        );
        useSelectionStore.getState().setActiveGuides(guides);
      }
      updateChairBrush(itemId, hit, pointer.buttons);
      invalidateRef.current();
    };

    /** Whether the touch arbiter holds this touch, so the ghost follows it through the gesture store instead. */
    function arbiterHolds(event: PointerEvent): boolean {
      return event.pointerType === "touch" && useTouchGestureStore.getState().mode !== "idle";
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0 || arbiterHolds(event)) return;
      const itemId = useCatalogueStore.getState().selectedItemId;
      if (selectedChairItem(itemId) === null) return;
      const hit = raycastToFloor(event.clientX, event.clientY);
      if (hit === null) return;
      chairBrushStartRef.current = hit;
      chairBrushEndRef.current = hit;
      chairBrushActiveRef.current = false;
      setChairBrushPreview([]);
    }

    function onPointerMove(event: PointerEvent): void {
      if (useCatalogueStore.getState().selectedItemId === null || arbiterHolds(event)) return;
      pendingPointer.current = {
        x: event.clientX,
        y: event.clientY,
        buttons: event.buttons,
        // A drag the catalogue holds reports from its own element: ask the page, once a frame.
        onCanvas: event.target === canvasEl ? true : useCatalogueStore.getState().dragActive ? null : false,
        touch: false,
      };
      invalidateRef.current();
    }

    function placeAtGhost(): void {
      placePieceInHand(() => { invalidateRef.current(); });
    }

    function finishPlacementRelease(clientX: number, clientY: number, button: number): void {
      if (button !== 0) return;
      const itemId = useCatalogueStore.getState().selectedItemId;
      if (
        itemId !== null &&
        chairBrushActiveRef.current &&
        chairBrushStartRef.current !== null &&
        chairBrushEndRef.current !== null
      ) {
        // The release must still hit the floor, and may arrive without a final move.
        const hit = raycastToFloor(clientX, clientY);
        const newIds = hit === null ? [] : usePlacementStore.getState().placeChairBrush(
          itemId,
          chairBrushStartRef.current.x,
          chairBrushStartRef.current.z,
          hit.x,
          hit.z,
          usePlacementStore.getState().ghostRotation,
        );
        if (newIds.length > 0) {
          useSelectionStore.getState().selectMultiple(newIds);
        }
        suppressClickAfterBrushRef.current = true;
        useCatalogueStore.getState().clearSelection();
        usePlacementStore.getState().clearGhost();
        useSelectionStore.getState().setActiveGuides([]);
        clearChairBrush();
        invalidateRef.current();
        return;
      }
      if (!useCatalogueStore.getState().dragActive) return;

      // Update ghost one final time at release position
      pendingPointer.current = null;
      const hit = raycastToFloor(clientX, clientY);
      if (hit !== null && itemId !== null) {
        usePlacementStore.getState().updateGhost(hit.x, hit.z, itemId);
        placeAtGhost();
      }
      useCatalogueStore.getState().endDrag();
      usePlacementStore.getState().clearGhost();
      useSelectionStore.getState().setActiveGuides([]);
      clearChairBrush();
      invalidateRef.current();
    }

    function onPointerUp(event: PointerEvent): void {
      finishPlacementRelease(event.clientX, event.clientY, event.button);
    }

    function onMouseUp(event: MouseEvent): void {
      finishPlacementRelease(event.clientX, event.clientY, event.button);
    }

    function onClick(event: MouseEvent): void {
      if (event.button !== 0) return;
      if (suppressClickAfterBrushRef.current) {
        suppressClickAfterBrushRef.current = false;
        return;
      }
      // The touch arbiter already set the piece down for this tap.
      if (performance.now() - useTouchGestureStore.getState().endedAt < ARBITRATED_CLICK_MS) return;
      // Click-to-place only when NOT in drag mode
      if (useCatalogueStore.getState().dragActive) return;
      const itemId = useCatalogueStore.getState().selectedItemId;
      pendingPointer.current = null;
      const hit = raycastToFloor(event.clientX, event.clientY);
      if (itemId === null || hit === null) {
        usePlacementStore.getState().clearGhost();
        return;
      }
      // Touch taps and a direct click need not have a preceding pointer move.
      usePlacementStore.getState().updateGhost(hit.x, hit.z, itemId);
      placeAtGhost();
    }

    function onPointerCancel(): void {
      clearChairBrush();
    }

    // The touch arbiter's raised finger: the ghost stands above it, so the finger never hides it.
    const unsubscribeTouch = useTouchGestureStore.subscribe((state, previous) => {
      const finger = state.finger;
      if (state.mode === "place" && finger !== null && (finger !== previous.finger || previous.mode !== "place")) {
        pendingPointer.current = { x: finger.x, y: finger.y - ghostRaisePx(window.innerHeight), buttons: 0, onCanvas: true, touch: true };
        invalidateRef.current();
      } else if (previous.mode === "place" && state.mode !== "place") {
        // Placed on the lift by the arbiter, or given up to a look round or a pinch.
        pendingPointer.current = null;
        if (state.mode !== "idle") usePlacementStore.getState().clearGhost();
        useSelectionStore.getState().setActiveGuides([]);
        invalidateRef.current();
      }
    });

    // Listen on window so dragging out of the catalogue can cross into the
    // canvas smoothly; the floor raycast itself still uses the canvas bounds.
    canvasEl.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointercancel", onPointerCancel);
    canvasEl.addEventListener("click", onClick);

    return () => {
      unsubscribeTouch();
      observer?.disconnect();
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      canvasEl.removeEventListener("click", onClick);
      canvasEl.style.cursor = "";
      pendingPointer.current = null;
      followPointer.current = () => undefined;
      usePlacementStore.getState().clearGhost();
      useSelectionStore.getState().setActiveGuides([]);
      clearChairBrush();
    };
  }, [selectedItemId, scene, camera, raycaster, gl]);

  // Q, E and R turn the piece in hand as they turn a selection, and win over
  // a selection held at the same time; Esc puts it down (the planner's tool
  // keys, lib/planner-keymap.ts). A right-click also puts it down.
  usePlannerKeyBindings(placingKeyBindings({ invalidate: () => { invalidateRef.current(); } }));
  useEffect(() => {
    function onContextMenu(event: MouseEvent): void {
      if (useCatalogueStore.getState().selectedItemId !== null) {
        event.preventDefault();
        putDownPieceInHand();
      }
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => { window.removeEventListener("contextmenu", onContextMenu); };
  }, []);

  if (selectedItemId === null) return null;

  const catalogueItem = getCatalogueItem(selectedItemId);
  if (catalogueItem === undefined) return null;

  // --- Table dressing ghost: show preview on selected/nearest table or floating icon ---
  if (dressing) {
    if (dressingPosition === null) return null;
    const clothStyle = tableClothStyleForCatalogueItem(selectedItemId);
    const tableSetting = tableSettingForCatalogueItem(selectedItemId);
    const placedItems = usePlacementStore.getState().placedItems;
    const target = tableSetting === null ? "linen" : "dinner";
    const nearestTable = (target === "dinner" ? findNearestDiningTable : findNearestTable)(
      dressingPosition[0],
      dressingPosition[2],
      placedItems,
      CLOTH_SNAP_DISTANCE_RENDER,
    );
    const targetIds = tableDressingTargetIds(
      placedItems,
      selectedIds,
      nearestTable?.id ?? null,
      target,
    );

    if (targetIds.length > 0) {
      const previewGroups = targetIds
        .map((id) => placedItems.find((placed) => placed.id === id))
        .filter((placed): placed is PlacedItem => placed !== undefined);
      if (previewGroups.length > 0) {
        return (
          <>
            {previewGroups.map((target) => {
              const tableItem = getCatalogueItem(target.catalogueItemId);
              if (tableItem === undefined) return null;
              return (
                <group
                  key={target.id}
                  position={[target.x, target.y, target.z]}
                  rotation={[0, target.rotationY, 0]}
                  scale={normalizeFurnitureScale(target.scale)}
                >
                  {clothStyle !== null ? (
                    <TableClothMesh
                      tableItem={tableItem}
                      opacity={0.58}
                      colorOverride={TABLE_CLOTH_COLORS[clothStyle]}
                    />
                  ) : (
                    <TableSettingMesh
                      tableItem={tableItem}
                      opacity={0.62}
                      settingsCount={tableGroupedChairCount(placedItems, target)}
                    />
                  )}
                </group>
              );
            })}
          </>
        );
      }
    }

    if (nearestTable !== null && clothStyle !== null) {
      const tableItem = getCatalogueItem(nearestTable.catalogueItemId);
      if (tableItem !== undefined) {
        return (
          <group
            position={[nearestTable.x, nearestTable.y, nearestTable.z]}
            rotation={[0, nearestTable.rotationY, 0]}
            scale={normalizeFurnitureScale(nearestTable.scale)}
          >
            <TableClothMesh
              tableItem={tableItem}
              opacity={0.5}
              colorOverride={TABLE_CLOTH_COLORS[clothStyle]}
            />
          </group>
        );
      }
    }

    if (clothStyle !== null) {
      // No table nearby — show floating cloth with billowing physics.
      return (
        <ClothPreview
          position={dressingPosition}
          nearTable={false}
          colorOverride={TABLE_CLOTH_COLORS[clothStyle]}
        />
      );
    }

    return (
      <group position={dressingPosition} name="table-setting-placement-ghost">
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.24, 32]} />
          <meshStandardMaterial color="#d6b44f" emissive="#8a6c1a" emissiveIntensity={0.5} transparent opacity={0.72} />
        </mesh>
      </group>
    );
  }

  // --- Normal furniture ghost ---
  const ghostColor = ghostValid ? PLACEMENT_COLOR_VALID : PLACEMENT_COLOR_INVALID;
  const atCapReason = catalogueItem.maxCount !== null && ghostInvalidReason === capReachedLine(catalogueItem.maxCount);
  const showConstraintSkin = hasGhost && !ghostValid &&
    !atCapReason &&
    ghostInvalidReason !== "Unknown catalogue item";

  if (catalogueItem.category === "chair" && chairBrushPreview.length > 1) {
    const floorY = usePlacementStore.getState().ghostPosition?.[1] ?? 0;
    return (
      <group name="chair-brush-preview">
        {chairBrushPreview.map((point, index) => (
          <group
            key={`${point.x.toFixed(3)}:${point.z.toFixed(3)}:${String(index)}`}
            position={[point.x, floorY, point.z]}
            rotation={[0, point.rotationY, 0]}
          >
            <FurnitureProxy
              item={catalogueItem}
              position={[0, 0, 0]}
              rotationY={0}
              opacity={0.52}
              colorOverride="#d6b44f"
              name={`chair-brush-preview-${String(index)}`}
            />
          </group>
        ))}
      </group>
    );
  }

  // Mounted from the moment the piece is in hand (drawn tiny while it warms,
  // then hidden), so the first move shows it without building or compiling it.
  return (
    <group
      ref={ghostRef}
      rotation={[0, ghostRotation, 0]}
      scale={hasGhost ? 1 : WARM_SCALE}
      visible={hasGhost || warming}
      name="placement-ghost"
    >
      <FurnitureProxy
        item={catalogueItem}
        position={[0, 0, 0]}
        rotationY={0}
        opacity={0.6}
        colorOverride={ghostColor}
        name="placement-ghost-mesh"
      />
      {showConstraintSkin && (
        <ConstraintViolationSkin item={catalogueItem} y={0} />
      )}
    </group>
  );
}
