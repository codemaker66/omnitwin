import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2, Vector3, Plane } from "three";
import type { Object3D, Camera, Raycaster } from "three";
import { useSelectionStore } from "../stores/selection-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { isWithinRoomBounds, checkCollision, getGroupMemberIds, computeSurfaceHeight } from "../lib/placement.js";
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

/**
 * Raycast from screen pixel to the floor plane (y=0).
 * Returns world XZ coordinates or null if the ray is parallel to the floor.
 */
function screenToFloor(
  clientX: number,
  clientY: number,
  canvasEl: HTMLCanvasElement,
  cam: Camera,
  rc: Raycaster,
): { x: number; z: number } | null {
  const rect = canvasEl.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  rc.setFromCamera(new Vector2(ndcX, ndcY), cam);
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
 * - G key: toggle grid snap
 * - Delete/Backspace: remove selected items
 * - Escape: clear selection
 *
 * Must be inside the R3F Canvas.
 */
export function SelectionSystem(): null {
  const { scene, camera, raycaster, invalidate, gl } = useThree();
  const isDragging = useRef(false);
  const isMarquee = useRef(false);
  const dragStartScreen = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragItemId = useRef<string | null>(null);

  // Invalidate when selection changes
  useEffect(() => {
    return useSelectionStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Keyboard handlers
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const selectedIds = useSelectionStore.getState().selectedIds;

      // Ctrl+Z — undo
      if (event.code === "KeyZ" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        usePlacementStore.getState().undo();
        useSelectionStore.getState().clearSelection();
        invalidate();
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
        invalidate();
        return;
      }

      // Delete / Backspace — remove selected items
      if (event.code === "Delete" || event.code === "Backspace") {
        if (selectedIds.size === 0) return;
        usePlacementStore.getState().removeItems(selectedIds);
        useSelectionStore.getState().clearSelection();
        invalidate();
        return;
      }

      // Escape — clear selection
      if (event.code === "Escape") {
        if (selectedIds.size > 0) {
          useSelectionStore.getState().clearSelection();
          invalidate();
        }
        return;
      }

      // Q — rotate selected items counter-clockwise (-15°)
      if (event.code === "KeyQ" && !event.ctrlKey && !event.metaKey) {
        if (selectedIds.size === 0) return;
        const placedItems = usePlacementStore.getState().placedItems;
        for (const id of selectedIds) {
          const item = placedItems.find((p) => p.id === id);
          if (item !== undefined) {
            const newRotation = snapRotation(item.rotationY - ROTATION_SNAP_RAD);
            usePlacementStore.getState().rotateItem(id, newRotation);
          }
        }
        invalidate();
        return;
      }

      // E — rotate selected items clockwise (+15°)
      if (event.code === "KeyE" && !event.ctrlKey && !event.metaKey) {
        if (selectedIds.size === 0) return;
        const placedItems = usePlacementStore.getState().placedItems;
        for (const id of selectedIds) {
          const item = placedItems.find((p) => p.id === id);
          if (item !== undefined) {
            const newRotation = snapRotation(item.rotationY + ROTATION_SNAP_RAD);
            usePlacementStore.getState().rotateItem(id, newRotation);
          }
        }
        invalidate();
        return;
      }

      // R — rotate selected items clockwise (same as E, legacy binding)
      if (event.code === "KeyR" && !event.ctrlKey && !event.metaKey) {
        if (selectedIds.size === 0) return;
        const placedItems = usePlacementStore.getState().placedItems;
        for (const id of selectedIds) {
          const item = placedItems.find((p) => p.id === id);
          if (item !== undefined) {
            const newRotation = snapRotation(item.rotationY + ROTATION_SNAP_RAD);
            usePlacementStore.getState().rotateItem(id, newRotation);
          }
        }
        invalidate();
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
        invalidate();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [invalidate]);

  // Pointer handlers for click-select, drag-move, and marquee
  useEffect(() => {
    const canvasEl = gl.domElement;

    function onPointerDown(event: PointerEvent): void {
      // Only handle left-click
      if (event.button !== 0) return;
      // Don't interfere with placement mode
      if (useCatalogueStore.getState().selectedItemId !== null) return;

      dragStartScreen.current = { x: event.clientX, y: event.clientY };
      isDragging.current = false;
      isMarquee.current = false;

      // Raycast to find if we clicked on a placed furniture item
      const rect = canvasEl.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

      // Collect furniture group roots and all their mesh descendants
      const furnitureGroups: Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.name.startsWith("furniture-placed-")) {
          furnitureGroups.push(obj);
        }
      });

      // Raycast recursively into furniture groups to hit actual meshes
      const intersects = raycaster.intersectObjects(furnitureGroups, true);
      if (intersects.length > 0) {
        const hitObj = intersects[0]?.object;
        if (hitObj !== undefined) {
          // Walk up parents to find the furniture group name
          let current: Object3D | null = hitObj;
          let placedId: string | null = null;
          while (current !== null) {
            if (current.name.startsWith("furniture-placed-")) {
              placedId = current.name.replace("furniture-", "");
              break;
            }
            current = current.parent;
          }
          dragItemId.current = placedId;
        }
      } else {
        dragItemId.current = null;
      }
    }

    function onPointerMove(event: PointerEvent): void {
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
        } else {
          // Empty space — start marquee
          isMarquee.current = true;
          const floorPos = screenToFloor(
            dragStartScreen.current.x,
            dragStartScreen.current.y,
            canvasEl,
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
        // Update marquee end point (screen + world coords)
        const floorPos = screenToFloor(event.clientX, event.clientY, canvasEl, camera, raycaster);
        useSelectionStore.getState().updateMarquee(
          event.clientX,
          event.clientY,
          floorPos?.x ?? 0,
          floorPos?.z ?? 0,
        );

        // Live preview: find items inside marquee rectangle
        const rect = computeMarqueeRect(
          dragStartScreen.current.x,
          dragStartScreen.current.y,
          event.clientX,
          event.clientY,
        );

        const canvasRect = canvasEl.getBoundingClientRect();
        const placedItems = usePlacementStore.getState().placedItems;
        const idsInRect: string[] = [];
        const worldPos = new Vector3();

        for (const placed of placedItems) {
          // Project world position to screen coordinates
          worldPos.set(placed.x, placed.y, placed.z);
          worldPos.project(camera);

          // NDC → screen pixels
          const screenX = (worldPos.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
          const screenY = (-worldPos.y * 0.5 + 0.5) * canvasRect.height + canvasRect.top;

          if (isPointInRect(screenX, screenY, rect)) {
            idsInRect.push(placed.id);
          }
        }

        // Update selection live as user drags
        if (event.shiftKey) {
          // Additive marquee — add to existing selection
          const existing = useSelectionStore.getState().selectedIds;
          const merged = [...existing, ...idsInRect];
          useSelectionStore.getState().selectMultiple(merged);
        } else {
          useSelectionStore.getState().selectMultiple(idsInRect);
        }

        invalidate();
        return;
      }

      if (isDragging.current && dragItemId.current !== null) {
        // Drag-move furniture
        const canvasRect = canvasEl.getBoundingClientRect();
        const ndcX = ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
        raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

        const floorMeshes: Object3D[] = [];
        scene.traverse((obj) => {
          if (obj.name === "floor") floorMeshes.push(obj);
        });

        const floorHits = raycaster.intersectObjects(floorMeshes, false);
        if (floorHits.length > 0) {
          const hit = floorHits[0];
          if (hit !== undefined) {
            const selectedIds = useSelectionStore.getState().selectedIds;
            // Collect all IDs being moved (selected + their group members)
            const allMovingIds = new Set<string>();
            for (const sid of selectedIds) {
              for (const gid of getGroupMemberIds(sid, usePlacementStore.getState().placedItems)) {
                allMovingIds.add(gid);
              }
            }

            // Move all items in the moving set (selected + group members)
            const placedItems = usePlacementStore.getState().placedItems;
            const primaryId = dragItemId.current;
            const primary = placedItems.find((p) => p.id === primaryId);
            if (primary !== undefined) {
              const dx = hit.point.x - primary.x;
              const dz = hit.point.z - primary.z;

              // Check collision + bounds for every moving item at its new position
              let blocked = false;
              for (const id of allMovingIds) {
                const item = placedItems.find((p) => p.id === id);
                if (item === undefined) continue;
                const catItem = getCatalogueItem(item.catalogueItemId);
                if (catItem === undefined) continue;
                const newX = item.x + dx;
                const newZ = item.z + dz;
                const newY = computeSurfaceHeight(newX, newZ, placedItems, allMovingIds);
                if (!isWithinRoomBounds(newX, newZ, catItem, item.rotationY) ||
                    checkCollision(newX, newZ, catItem, item.rotationY, placedItems, allMovingIds, 0.01, newY)) {
                  blocked = true;
                  break;
                }
              }

              if (!blocked) {
                // Snap only the primary item (grid + edge + wall), then move
                // all group members by the same effective delta to preserve
                // their relative arrangement.
                usePlacementStore.getState().moveItem(primaryId, primary.x + dx, primary.z + dz);
                const movedPrimary = usePlacementStore.getState().placedItems.find((p) => p.id === primaryId);
                if (movedPrimary !== undefined) {
                  const effectiveDx = movedPrimary.x - primary.x;
                  const effectiveDz = movedPrimary.z - primary.z;
                  // Move remaining group members by the snapped delta (no per-item snapping)
                  const othersToMove = new Set<string>();
                  for (const id of allMovingIds) {
                    if (id !== primaryId) othersToMove.add(id);
                  }
                  if (othersToMove.size > 0) {
                    usePlacementStore.getState().moveItemsByDelta(othersToMove, effectiveDx, effectiveDz);
                  }
                }
                invalidate();
              }
            }
          }
        }
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (event.button !== 0) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;

      if (isMarquee.current) {
        // End marquee — selection was already updated live
        useSelectionStore.getState().endMarquee();
        isMarquee.current = false;
        invalidate();
        return;
      }

      if (!isDragging.current) {
        // This was a click, not a drag
        if (dragItemId.current !== null) {
          if (event.shiftKey) {
            useSelectionStore.getState().toggleSelect(dragItemId.current);
          } else {
            useSelectionStore.getState().select(dragItemId.current);
          }
        } else {
          // Clicked on empty space
          useSelectionStore.getState().clearSelection();
        }
        invalidate();
      }

      isDragging.current = false;
      isMarquee.current = false;
      dragItemId.current = null;
    }

    function onDblClick(event: MouseEvent): void {
      if (event.button !== 0) return;
      if (useCatalogueStore.getState().selectedItemId !== null) return;

      // Find which placed item was double-clicked
      const rect = canvasEl.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

      const furnitureGroups: Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.name.startsWith("furniture-placed-")) furnitureGroups.push(obj);
      });

      const intersects = raycaster.intersectObjects(furnitureGroups, true);
      if (intersects.length === 0) return;

      const hitObj = intersects[0]?.object;
      if (hitObj === undefined) return;

      let current: Object3D | null = hitObj;
      let placedId: string | null = null;
      while (current !== null) {
        if (current.name.startsWith("furniture-placed-")) {
          placedId = current.name.replace("furniture-", "");
          break;
        }
        current = current.parent;
      }
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
        invalidate();
      }
    }

    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("dblclick", onDblClick);

    return () => {
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("dblclick", onDblClick);
    };
  }, [scene, camera, raycaster, invalidate, gl]);

  return null;
}
