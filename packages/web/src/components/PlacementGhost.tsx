import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import type { Object3D } from "three";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { PLACEMENT_COLOR_VALID, PLACEMENT_COLOR_INVALID } from "../lib/placement.js";
import { findNearestTable, CLOTH_SNAP_DISTANCE_RENDER } from "../lib/cloth-snap.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { TableClothMesh } from "./meshes/TableClothMesh.js";
import { ClothPreview } from "./cloth/ClothPreview.js";

// ---------------------------------------------------------------------------
// PlacementGhost — ghost mesh following cursor during drag-and-drop placement
// ---------------------------------------------------------------------------

/**
 * Handles drag-and-drop furniture placement from the shop bar:
 * 1. User drags item from shop bar (dragActive=true, selectedItemId set)
 * 2. Pointer moves over canvas → ghost follows via raycasting to floor
 * 3. Pointer released → places item at ghost position
 *
 * Also supports click-to-place mode (select then click).
 */
export function PlacementGhost(): React.ReactElement | null {
  const { invalidate, scene, camera, raycaster } = useThree();
  const selectedItemId = useCatalogueStore((s) => s.selectedItemId);
  const ghostPosition = usePlacementStore((s) => s.ghostPosition);
  const ghostValid = usePlacementStore((s) => s.ghostValid);

  useEffect(() => {
    return usePlacementStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  useEffect(() => {
    return useCatalogueStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Raycasting: update ghost on pointer move, place on pointer up (drag) or click
  useEffect(() => {
    if (selectedItemId === null) return;

    const canvasEl = document.querySelector("canvas");
    if (canvasEl === null) return;

    canvasEl.style.cursor = "crosshair";

    function raycastToFloor(clientX: number, clientY: number): { x: number; z: number } | null {
      if (canvasEl === null) return null;
      const rect = canvasEl.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

      const floorMeshes: Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.name === "floor") floorMeshes.push(obj);
      });

      const intersects = raycaster.intersectObjects(floorMeshes, false);
      const hit = intersects[0];
      if (hit !== undefined) {
        return { x: hit.point.x, z: hit.point.z };
      }
      return null;
    }

    function onPointerMove(event: PointerEvent): void {
      if (selectedItemId === null) return;
      const hit = raycastToFloor(event.clientX, event.clientY);
      if (hit !== null) {
        usePlacementStore.getState().updateGhost(hit.x, hit.z, selectedItemId);
        invalidate();
      }
    }

    function placeAtGhost(): void {
      const catState = useCatalogueStore.getState();
      const placeState = usePlacementStore.getState();
      if (catState.selectedItemId === null) return;
      if (placeState.ghostPosition === null) return;

      // Cloth: toggle on nearest table (skip ghostValid — cloth doesn't collide)
      if (catState.selectedItemId === "black-table-cloth") {
        const nearest = findNearestTable(
          placeState.ghostPosition[0],
          placeState.ghostPosition[2],
          placeState.placedItems,
          CLOTH_SNAP_DISTANCE_RENDER,
        );
        if (nearest !== null) {
          placeState.toggleCloth(nearest.id);
          invalidate();
        }
        return;
      }

      // All non-cloth items require valid ghost position
      if (!placeState.ghostValid) return;

      // Table: show chair count dialog instead of placing directly
      const item = getCatalogueItem(catState.selectedItemId);
      if (item !== undefined && item.tableShape !== null) {
        useChairDialogStore.getState().showDialog({
          catalogueItemId: catState.selectedItemId,
          x: placeState.ghostPosition[0],
          z: placeState.ghostPosition[2],
          rotationY: 0,
          tableShape: item.tableShape,
        });
        catState.clearSelection();
        placeState.clearGhost();
        invalidate();
        return;
      }

      placeState.placeItem(
        catState.selectedItemId,
        placeState.ghostPosition[0],
        placeState.ghostPosition[2],
      );
      invalidate();
    }

    function onPointerUp(event: PointerEvent): void {
      if (event.button !== 0) return;
      if (!useCatalogueStore.getState().dragActive) return;

      // Update ghost one final time at release position
      const hit = raycastToFloor(event.clientX, event.clientY);
      if (hit !== null && selectedItemId !== null) {
        usePlacementStore.getState().updateGhost(hit.x, hit.z, selectedItemId);
      }
      placeAtGhost();
    }

    function onClick(event: MouseEvent): void {
      if (event.button !== 0) return;
      // Click-to-place only when NOT in drag mode
      if (useCatalogueStore.getState().dragActive) return;
      placeAtGhost();
    }

    // Listen on window for pointerup so drag works even if cursor leaves canvas
    canvasEl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("click", onClick);

    return () => {
      canvasEl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("click", onClick);
      canvasEl.style.cursor = "";
      usePlacementStore.getState().clearGhost();
    };
  }, [selectedItemId, scene, camera, raycaster, invalidate]);

  // Escape cancels placement
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code === "Escape" && useCatalogueStore.getState().selectedItemId !== null) {
        useCatalogueStore.getState().clearSelection();
        usePlacementStore.getState().clearGhost();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  if (selectedItemId === null || ghostPosition === null) return null;

  const catalogueItem = getCatalogueItem(selectedItemId);
  if (catalogueItem === undefined) return null;

  // --- Cloth ghost: show preview on nearest table or floating icon ---
  if (selectedItemId === "black-table-cloth") {
    const placedItems = usePlacementStore.getState().placedItems;
    const nearestTable = findNearestTable(
      ghostPosition[0],
      ghostPosition[2],
      placedItems,
      CLOTH_SNAP_DISTANCE_RENDER,
    );

    if (nearestTable !== null) {
      const tableItem = getCatalogueItem(nearestTable.catalogueItemId);
      if (tableItem !== undefined) {
        return (
          <group
            position={[nearestTable.x, nearestTable.y, nearestTable.z]}
            rotation={[0, nearestTable.rotationY, 0]}
          >
            <TableClothMesh
              tableItem={tableItem}
              opacity={0.5}
            />
          </group>
        );
      }
    }

    // No table nearby — show floating cloth with billowing physics
    return (
      <ClothPreview
        position={ghostPosition}
        nearTable={false}
      />
    );
  }

  // --- Normal furniture ghost ---
  const ghostColor = ghostValid ? PLACEMENT_COLOR_VALID : PLACEMENT_COLOR_INVALID;

  return (
    <FurnitureProxy
      item={catalogueItem}
      position={ghostPosition}
      opacity={0.6}
      colorOverride={ghostColor}
      name="placement-ghost"
    />
  );
}
