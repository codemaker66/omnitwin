import { useEffect, useRef, useState, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { toRenderSpace } from "../constants/scale.js";
import { SELECTION_COLOR } from "../lib/selection.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { TableClothMesh } from "./meshes/TableClothMesh.js";
import { AnimatedTableCloth } from "./meshes/AnimatedTableCloth.js";
import { sectionClipPlanes } from "./SectionPlane.js";

// ---------------------------------------------------------------------------
// PlacedFurniture — renders all placed furniture items with selection highlight
// ---------------------------------------------------------------------------

function selectionBoxArgs(item: { width: number; height: number; depth: number }): [number, number, number] {
  return [
    toRenderSpace(item.width) + 0.05,
    item.height + 0.05,
    toRenderSpace(item.depth) + 0.05,
  ];
}

export function PlacedFurniture(): React.ReactElement {
  const { invalidate } = useThree();
  const placedItems = usePlacementStore((s) => s.placedItems);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  // Track which items are currently animating their cloth unfurl
  const [animatingIds, setAnimatingIds] = useState<ReadonlySet<string>>(new Set());
  const prevClothedRef = useRef<ReadonlySet<string>>(new Set());

  // Detect newly clothed items to trigger animation
  useEffect(() => {
    const currentClothed = new Set<string>();
    for (const item of placedItems) {
      if (item.clothed) currentClothed.add(item.id);
    }

    const newlyClothed = new Set<string>();
    for (const id of currentClothed) {
      if (!prevClothedRef.current.has(id)) {
        newlyClothed.add(id);
      }
    }

    prevClothedRef.current = currentClothed;

    if (newlyClothed.size > 0) {
      setAnimatingIds((prev) => {
        const next = new Set(prev);
        for (const id of newlyClothed) next.add(id);
        return next;
      });
    }
  }, [placedItems]);

  const handleAnimationComplete = useCallback((id: string) => {
    setAnimatingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    invalidate();
  }, [invalidate]);

  useEffect(() => {
    return usePlacementStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  useEffect(() => {
    return useSelectionStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  return (
    <group name="placed-furniture">
      {placedItems.map((placed) => {
        const catalogueItem = getCatalogueItem(placed.catalogueItemId);
        if (catalogueItem === undefined) return null;
        const isSelected = selectedIds.has(placed.id);
        const isClothedTable = placed.clothed && catalogueItem.category === "table";
        const isAnimating = animatingIds.has(placed.id);

        return (
          <group key={placed.id}>
            {/* Table always visible — cloth drapes over it */}
            <FurnitureProxy
              item={catalogueItem}
              position={[placed.x, placed.y, placed.z]}
              rotationY={placed.rotationY}
              name={`furniture-${placed.id}`}
            />

            {/* Animated unfurl for newly clothed tables */}
            {isClothedTable && isAnimating && (
              <group
                position={[placed.x, placed.y, placed.z]}
                rotation={[0, placed.rotationY, 0]}
              >
                <AnimatedTableCloth
                  tableItem={catalogueItem}
                  onComplete={() => { handleAnimationComplete(placed.id); }}
                />
              </group>
            )}

            {/* Static cloth for settled tables */}
            {isClothedTable && !isAnimating && (
              <group
                position={[placed.x, placed.y, placed.z]}
                rotation={[0, placed.rotationY, 0]}
              >
                <TableClothMesh tableItem={catalogueItem} />
              </group>
            )}

            {/* Selection wireframe */}
            {isSelected && (
              <mesh
                position={[placed.x, placed.y + catalogueItem.height / 2, placed.z]}
                rotation={[0, placed.rotationY, 0]}
              >
                <boxGeometry args={selectionBoxArgs(catalogueItem)} />
                <meshBasicMaterial
                  color={SELECTION_COLOR}
                  wireframe
                  transparent
                  opacity={0.8}
                  clippingPlanes={sectionClipPlanes}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
