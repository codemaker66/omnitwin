import { useMemo, type ReactElement } from "react";
import {
  furnitureSelectionOutlines, ignoreSelectionOutlineRaycast, SELECTION_OUTLINE_BRASS,
  type FurnitureSelectionOutline,
} from "../../lib/furniture-selection-outline.js";
import type { PlacedItem } from "../../lib/placement.js";
import { sectionClipPlanes } from "../SectionPlane.js";

function Outline({ outline }: { readonly outline: FurnitureSelectionOutline }): ReactElement {
  const { coordinateKey } = outline;
  const args = useMemo<[Float32Array, number]>(() => [new Float32Array(coordinateKey.split(",").map(Number)), 3], [coordinateKey]);
  return (
    <lineLoop name="selection-footprint" position={outline.position} raycast={ignoreSelectionOutlineRaycast} renderOrder={10}>
      {/* Shape changes need fresh cached bounds; uniform drag retains this key. */}
      <bufferGeometry key={coordinateKey}>
        <bufferAttribute attach="attributes-position" args={args} />
      </bufferGeometry>
      <lineBasicMaterial color={SELECTION_OUTLINE_BRASS} transparent opacity={.9}
        depthTest={false} depthWrite={false} toneMapped={false} clippingPlanes={sectionClipPlanes} />
    </lineLoop>
  );
}

/** Quiet selection annotation. R3F owns geometry/material disposal; it adds no pick surface. */
export function FurnitureSelectionOutlines({ items, selectedIds }: {
  readonly items: readonly PlacedItem[];
  readonly selectedIds: ReadonlySet<string>;
}): ReactElement | null {
  const outlines = useMemo(() => furnitureSelectionOutlines(items, selectedIds), [items, selectedIds]);
  if (outlines.length === 0) return null;
  return <group name="selection-footprints">{outlines.map((outline) => <Outline key={outline.key} outline={outline} />)}</group>;
}
