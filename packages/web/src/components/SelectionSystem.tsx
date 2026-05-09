import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2, Vector3, Plane } from "three";
import type { Object3D, Camera, Raycaster } from "three";
import { useSelectionStore } from "../stores/selection-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { useVisibilityStore, type WallKey } from "../stores/visibility-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { expandIdsToGroupMembers, getGroupMemberIds, snapToPlatformEdge, snapToWallEdge } from "../lib/placement.js";
import { computeSnapGuides, snapToFurnitureAlignment } from "../lib/snap-guide.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import {
  snapRotation,
  ROTATION_SNAP_RAD,
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

// ---------------------------------------------------------------------------
// SelectionSystem — handles click, drag-move, marquee, rotation, delete
// ---------------------------------------------------------------------------

/**
 * R3F component that manages the selection and transform loop.
 *
 * - Left-click on furniture: select (Shift+click: toggle additive)
 * - Left-click on empty + drag: marquee box select
 * - Drag selected furniture: move on floor plane
 * - Q / E: rotate selected items by ±15°
 * - R key: rotate selected 15° clockwise (legacy, kept for compat)
 * - Ctrl/Cmd+G: group or ungroup selected items
 * - G key: toggle grid snap
 * - Delete/Backspace: remove selected items
 * - Escape: clear selection
 *
 * Must be inside the R3F Canvas.
 */
/** Finds the floor mesh in the scene (cached after first lookup). */
// Floor mesh raycast removed — drag uses math-plane intersection instead
// to work with any room polygon shape.

/** Collects furniture group roots from the known parent group. */
function findFurnitureGroups(scene: Object3D): Object3D[] {
  const parent = scene.getObjectByName("placed-furniture");
  if (parent === undefined) return [];
  return parent.children.filter((c) => c.name.startsWith("furniture-"));
}

const WALL_KEYS_SET = new Set<string>(["wall-front", "wall-back", "wall-left", "wall-right"]);

function selectedItemsAreOneWholeGroup(ids: ReadonlySet<string>): boolean {
  if (ids.size < 2) return false;
  const placedItems = usePlacementStore.getState().placedItems;
  const expandedIds = expandIdsToGroupMembers(ids, placedItems);
  const expandedItems = placedItems.filter((item) => expandedIds.has(item.id));
  if (expandedItems.length < 2) return false;
  const groupIds = new Set(expandedItems.map((item) => item.groupId));
  return groupIds.size === 1 && !groupIds.has(null);
}

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

function findFurnitureItemId(obj: Object3D): string | null {
  let current: Object3D | null = obj;
  while (current !== null) {
    if (current.name.startsWith("furniture-") && !current.name.endsWith("-mesh")) {
      return current.name.replace("furniture-", "");
    }
    current = current.parent;
  }
  return null;
}

export function SelectionSystem(): null {
  const { scene, camera, raycaster, invalidate, gl } = useThree();
  const isDragging = useRef(false);
  const isMarquee = useRef(false);
  const dragStartScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragItemId = useRef<string | null>(null);
  const dragGrabOffset = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const wallClickKey = useRef<WallKey | null>(null);
  const rightClickStart = useRef<{ x: number; y: number } | null>(null);
  const rightClickMoved = useRef(false);
  const suppressNextContextMenu = useRef(false);
  const marqueeRafId = useRef<number>(0);
  // floorCache removed — drag uses math plane intersection

  // Stable ref for invalidate — avoids effect teardown when invalidate ref changes
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

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

  // Keyboard handlers
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (useMarkupStore.getState().active) return;

      const selectedIds = useSelectionStore.getState().selectedIds;

      // Ctrl+Z — undo
      if (event.code === "KeyZ" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        usePlacementStore.getState().undo();
        useSelectionStore.getState().clearSelection();
        invalidateRef.current();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y — redo
      if (
        ((event.code === "KeyZ" && (event.ctrlKey || event.metaKey) && event.shiftKey) ||
         (event.code === "KeyY" && (event.ctrlKey || event.metaKey)))
      ) {
        event.preventDefault();
        usePlacementStore.getState().redo();
        useSelectionStore.getState().clearSelection();
        invalidateRef.current();
        return;
      }

      // Delete / Backspace — remove selected items
      if (event.code === "Delete" || event.code === "Backspace") {
        if (selectedIds.size === 0) return;
        usePlacementStore.getState().removeItems(selectedIds);
        useSelectionStore.getState().clearSelection();
        invalidateRef.current();
        return;
      }

      // Escape — clear selection
      if (event.code === "Escape") {
        if (selectedIds.size > 0) {
          useSelectionStore.getState().clearSelection();
          invalidateRef.current();
        }
        return;
      }

      // Q — rotate selected counter-clockwise | E — same | R — clockwise (legacy)
      // Batch rotation: push one undo snapshot, then update all items in a single
      // set() call. Prevents rapid Q/E from filling the undo buffer with per-item
      // snapshots and avoids N separate React batches for N selected items.
      if ((event.code === "KeyQ" || event.code === "KeyE" || event.code === "KeyR") && !event.ctrlKey && !event.metaKey) {
        if (selectedIds.size === 0) return;
        const delta = event.code === "KeyR" ? ROTATION_SNAP_RAD : -ROTATION_SNAP_RAD;
        const store = usePlacementStore.getState();
        usePlacementStore.setState({
          placedItems: store.placedItems.map((item) => {
            if (!selectedIds.has(item.id)) return item;
            return { ...item, rotationY: snapRotation(item.rotationY + delta) };
          }),
          undoStack: [...store.undoStack, store.placedItems].slice(-50),
          redoStack: [],
        });
        invalidateRef.current();
        return;
      }

      // Ctrl/Cmd+G — group selected items, or ungroup a complete selected group.
      if (event.code === "KeyG" && (event.ctrlKey || event.metaKey)) {
        if (selectedIds.size < 2) return;
        event.preventDefault();
        const placement = usePlacementStore.getState();
        const expandedIds = expandIdsToGroupMembers(selectedIds, placement.placedItems);
        if (selectedItemsAreOneWholeGroup(selectedIds)) {
          placement.ungroupItems(expandedIds);
        } else {
          placement.groupItems(expandedIds);
        }
        useSelectionStore.getState().selectMultiple([...expandedIds]);
        invalidateRef.current();
        return;
      }

      // G — toggle grid snap
      if (event.code === "KeyG" && !event.ctrlKey && !event.metaKey) {
        usePlacementStore.getState().toggleSnap();
        return;
      }

      // C — toggle cloth on selected tables
      if (event.code === "KeyC" && !event.ctrlKey && !event.metaKey) {
        if (selectedIds.size === 0) return;
        for (const id of selectedIds) {
          usePlacementStore.getState().toggleCloth(id);
        }
        invalidateRef.current();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  // Pointer handlers for click-select, drag-move, and marquee
  useEffect(() => {
    const canvasEl = gl.domElement;
    // Cache canvas rect — refreshed on pointer down (covers resize between interactions)
    let cachedRect = canvasEl.getBoundingClientRect();

    function onPointerDown(event: PointerEvent): void {
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

      dragStartScreen.current = { x: event.clientX, y: event.clientY };
      isDragging.current = false;
      isMarquee.current = false;

      // Refresh cached rect at interaction start (handles canvas resize)
      cachedRect = canvasEl.getBoundingClientRect();

      // Raycast to find if we clicked on a placed furniture item
      const ndcX = ((event.clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
      const ndcY = -((event.clientY - cachedRect.top) / cachedRect.height) * 2 + 1;
      raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);

      // Single raycast — process hits in distance order to find furniture or wall.
      // Holds the in-progress results in an object so TS doesn't narrow the
      // comparisons via control-flow analysis after the initial null assignment
      // (object property access escapes literal narrowing in a way that bare
      // `let` bindings do not).
      const allIntersects = raycaster.intersectObjects(scene.children, true);
      const found: { itemId: string | null; wallKey: WallKey | null } = { itemId: null, wallKey: null };
      for (const inter of allIntersects) {
        // Check furniture first (higher priority)
        if (found.itemId === null) {
          found.itemId = findFurnitureItemId(inter.object);
          if (found.itemId !== null) break; // furniture found, stop
        }
        // Check wall (only if no furniture found yet)
        if (found.wallKey === null) {
          const wk = findWallKey(inter.object);
          if (wk !== null) {
            found.wallKey = wk;
            break; // wall found, stop
          }
        }
      }
      dragItemId.current = found.itemId;
      wallClickKey.current = found.wallKey;
      dragGrabOffset.current = { x: 0, z: 0 };
      if (found.itemId !== null) {
        const floorPos = screenToFloor(event.clientX, event.clientY, cachedRect, camera, raycaster);
        const item = usePlacementStore.getState().placedItems.find((placed) => placed.id === found.itemId);
        if (floorPos !== null && item !== undefined) {
          dragGrabOffset.current = {
            x: floorPos.x - item.x,
            z: floorPos.z - item.z,
          };
        }
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
      if (useMarkupStore.getState().active) return;
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
          isDragging.current = true;
          usePlacementStore.getState().beginDragMove();
          if (!useSelectionStore.getState().selectedIds.has(dragItemId.current)) {
            useSelectionStore.getState().select(dragItemId.current);
          }
        } else if (wallClickKey.current !== null) {
          // Preserve wall click-to-disassemble when the pointer jitters a few
          // pixels over the wall plane; don't convert that interaction into a
          // marquee drag.
          return;
        } else {
          // Empty space — start marquee
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
            const merged = [...existing, ...idsInRect];
            useSelectionStore.getState().selectMultiple(merged);
          } else {
            useSelectionStore.getState().selectMultiple(idsInRect);
          }

          invalidateRef.current();
        });
        return;
      }

      if (isDragging.current && dragItemId.current !== null) {
        // Drag-move furniture — use math plane intersection (not floor mesh raycast)
        // so dragging works regardless of floor polygon shape
        const floorHit = screenToFloor(event.clientX, event.clientY, cachedRect, camera, raycaster);
        if (floorHit !== null) {
          const hit = { point: { x: floorHit.x, z: floorHit.z } };
          {
            const selectedIds = useSelectionStore.getState().selectedIds;
            // Read placed items once for the entire handler — consistent snapshot
            const placedItems = usePlacementStore.getState().placedItems;
            // Collect all IDs being moved. Seed from the actively dragged
            // item first so a table ring stays intact even if selection state
            // lags a pointer frame or contains only part of the group.
            const allMovingIds = new Set<string>();
            const primaryId = dragItemId.current;
            for (const gid of getGroupMemberIds(primaryId, placedItems)) {
              allMovingIds.add(gid);
            }
            for (const sid of selectedIds) {
              for (const gid of getGroupMemberIds(sid, placedItems)) {
                allMovingIds.add(gid);
              }
            }

            // Move all items in the moving set (selected + group members)
            const primary = placedItems.find((p) => p.id === primaryId);
            if (primary !== undefined) {
              let targetX = hit.point.x - dragGrabOffset.current.x;
              let targetZ = hit.point.z - dragGrabOffset.current.z;
              const primaryCatalogueItem = getCatalogueItem(primary.catalogueItemId);
              if (primaryCatalogueItem !== undefined) {
                const platformSnap = snapToPlatformEdge(
                  targetX,
                  targetZ,
                  primaryCatalogueItem,
                  primary.rotationY,
                  placedItems,
                  allMovingIds,
                );
                targetX = platformSnap.x;
                targetZ = platformSnap.z;
                const wallSnap = snapToWallEdge(
                  targetX,
                  targetZ,
                  primaryCatalogueItem,
                  primary.rotationY,
                  useRoomDimensionsStore.getState().dimensions,
                );
                targetX = wallSnap.x;
                targetZ = wallSnap.z;
                const furnitureSnap = snapToFurnitureAlignment(
                  targetX,
                  targetZ,
                  primary.catalogueItemId,
                  primary.rotationY,
                  placedItems,
                  allMovingIds,
                );
                targetX = furnitureSnap.x;
                targetZ = furnitureSnap.z;
              }

              const effectiveDx = targetX - primary.x;
              const effectiveDz = targetZ - primary.z;
              usePlacementStore.getState().moveItemsByDelta(allMovingIds, effectiveDx, effectiveDz);
              const movedPrimary = usePlacementStore.getState().placedItems.find((p) => p.id === primaryId);
              if (movedPrimary !== undefined) {
                const guides = computeSnapGuides(
                  movedPrimary.x, movedPrimary.z,
                  movedPrimary.catalogueItemId, movedPrimary.rotationY,
                  usePlacementStore.getState().placedItems, allMovingIds,
                );
                useSelectionStore.getState().setActiveGuides(guides);
              }
              invalidateRef.current();
            }
          }
        }
      }
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
      if (useMarkupStore.getState().active) return;
      if (handleRightButtonRelease(event)) return;
      if (event.button !== 0) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;
      // Don't interfere with measurement or guideline tools
      if (useMeasurementStore.getState().active || useGuidelineStore.getState().active) return;

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
      isDragging.current = false;
      isMarquee.current = false;
      dragItemId.current = null;
    }

    function onMouseUp(event: MouseEvent): void {
      if (useMarkupStore.getState().active) return;
      handleRightButtonRelease(event);
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

      if (catItem.tableShape !== null) {
        // Double-click on table in a group → edit chair count
        useChairDialogStore.getState().showDialog({
          catalogueItemId: item.catalogueItemId,
          x: item.x,
          z: item.z,
          rotationY: item.rotationY,
          tableShape: catItem.tableShape,
        }, item.id);
      } else if (catItem.category === "chair") {
        // Double-click on chair in a group → break it out
        usePlacementStore.getState().breakFromGroup(placedId);
        useSelectionStore.getState().select(placedId);
        invalidateRef.current();
      }
    }

    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("mousedown", onMouseDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("mousemove", onMouseMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("mouseup", onMouseUp);
    canvasEl.addEventListener("contextmenu", onContextMenu);
    canvasEl.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(marqueeRafId.current);
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("mousedown", onMouseDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onMouseMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("mouseup", onMouseUp);
      canvasEl.removeEventListener("contextmenu", onContextMenu);
      canvasEl.removeEventListener("dblclick", onDblClick);
    };
  }, [scene, camera, raycaster, gl]);

  return null;
}
