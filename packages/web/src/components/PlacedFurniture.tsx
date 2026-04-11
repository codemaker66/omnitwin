import { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
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
import type { PlacedItem } from "../lib/placement.js";

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

// ---------------------------------------------------------------------------
// Per-item child wrapped in React.memo. Punch list #15: previously the parent
// .map() reconstructed all N JSX subtrees on every store update because the
// parent component itself re-rendered. Zustand preserves object identity for
// unchanged items in `placedItems.map((item) => item.id === id ? {...} : item)`,
// so memo's default shallow prop comparison correctly skips ~(N-1) of N
// children when one item changes. selectionBoxArgs is wrapped in useMemo so
// the BoxGeometry's `args` reference stays stable across re-renders within a
// single child — without it, R3F would dispose and reallocate the GPU buffer
// on every drag frame for every selected item.
// ---------------------------------------------------------------------------

interface PlacedFurnitureItemProps {
  readonly placed: PlacedItem;
  readonly isSelected: boolean;
  readonly isAnimating: boolean;
  readonly onAnimationComplete: (id: string) => void;
}

const PlacedFurnitureItem = memo(function PlacedFurnitureItem({
  placed,
  isSelected,
  isAnimating,
  onAnimationComplete,
}: PlacedFurnitureItemProps): React.ReactElement | null {
  const catalogueItem = getCatalogueItem(placed.catalogueItemId);

  // useMemo MUST be called before any early return so the hook order is
  // stable across renders (rules-of-hooks). When catalogueItem is undefined
  // the tuple is unused; the early return below short-circuits the render.
  const memoizedSelectionArgs = useMemo(
    (): [number, number, number] => (
      catalogueItem !== undefined ? selectionBoxArgs(catalogueItem) : [0, 0, 0]
    ),
    [catalogueItem],
  );

  if (catalogueItem === undefined) return null;

  const isClothedTable = placed.clothed && catalogueItem.category === "table";

  return (
    <group name={`furniture-${placed.id}`}>
      {/* Table always visible — cloth drapes over it */}
      <FurnitureProxy
        item={catalogueItem}
        position={[placed.x, placed.y, placed.z]}
        rotationY={placed.rotationY}
        name={`furniture-${placed.id}-mesh`}
      />

      {/* Animated unfurl for newly clothed tables */}
      {isClothedTable && isAnimating && (
        <group
          position={[placed.x, placed.y, placed.z]}
          rotation={[0, placed.rotationY, 0]}
        >
          <AnimatedTableCloth
            tableItem={catalogueItem}
            onComplete={() => { onAnimationComplete(placed.id); }}
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
          <boxGeometry args={memoizedSelectionArgs} />
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
});

export function PlacedFurniture(): React.ReactElement {
  const { invalidate } = useThree();
  const placedItems = usePlacementStore((s) => s.placedItems);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  // Track which items are currently animating their cloth unfurl
  const [animatingIds, setAnimatingIds] = useState<ReadonlySet<string>>(new Set());
  const prevClothedRef = useRef<ReadonlySet<string>>(new Set());

  // Detect newly clothed items to trigger animation.
  // Avoids allocating intermediate Sets on every render — only builds new
  // Sets when an item actually becomes clothed for the first time.
  useEffect(() => {
    const prev = prevClothedRef.current;
    let newlyClothed: string[] | null = null;
    const nextClothed = new Set<string>();

    for (const item of placedItems) {
      if (item.clothed) {
        nextClothed.add(item.id);
        if (!prev.has(item.id)) {
          (newlyClothed ??= []).push(item.id);
        }
      }
    }

    prevClothedRef.current = nextClothed;

    if (newlyClothed !== null) {
      setAnimatingIds((cur) => {
        const next = new Set(cur);
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

  return (
    <group name="placed-furniture">
      {placedItems.map((placed) => (
        <PlacedFurnitureItem
          key={placed.id}
          placed={placed}
          isSelected={selectedIds.has(placed.id)}
          isAnimating={animatingIds.has(placed.id)}
          onAnimationComplete={handleAnimationComplete}
        />
      ))}
    </group>
  );
}
