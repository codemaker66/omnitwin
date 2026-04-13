import { useMemo, useEffect, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, LineDashedMaterial } from "three";
import { useSelectionStore } from "../stores/selection-store.js";
import {
  SNAP_GUIDE_COLOR,
  SNAP_GUIDE_Y,
  SNAP_GUIDE_DASH,
  SNAP_GUIDE_GAP,
} from "../lib/snap-guide.js";
import type { SnapGuide } from "../lib/snap-guide.js";

// ---------------------------------------------------------------------------
// SnapGuides — renders alignment guide lines on the floor during drag/place
// ---------------------------------------------------------------------------

/** Shared material for all guide lines (colour/dash are constants). */
const guideMaterial = new LineDashedMaterial({
  color: SNAP_GUIDE_COLOR,
  dashSize: SNAP_GUIDE_DASH,
  gapSize: SNAP_GUIDE_GAP,
  depthTest: false,
  transparent: true,
  opacity: 0.9,
});

/** Convert a SnapGuide to a BufferGeometry line segment. */
function guideGeometry(guide: SnapGuide): BufferGeometry {
  const geo = new BufferGeometry();

  let x0: number, z0: number, x1: number, z1: number;
  if (guide.axis === "x") {
    // Line runs along X at fixed Z = coord
    x0 = guide.start;
    z0 = guide.coord;
    x1 = guide.end;
    z1 = guide.coord;
  } else {
    // Line runs along Z at fixed X = coord
    x0 = guide.coord;
    z0 = guide.start;
    x1 = guide.coord;
    z1 = guide.end;
  }

  geo.setAttribute("position", new Float32BufferAttribute([
    x0, SNAP_GUIDE_Y, z0,
    x1, SNAP_GUIDE_Y, z1,
  ], 3));

  // lineDistance attribute required for dashed lines
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dist = Math.sqrt(dx * dx + dz * dz);
  geo.setAttribute("lineDistance", new Float32BufferAttribute([0, dist], 1));

  return geo;
}

/**
 * Renders active snap alignment guides on the floor plane.
 * Reads from selection store — guides are set during drag-move or ghost placement.
 */
export function SnapGuides(): React.ReactElement | null {
  const activeGuides = useSelectionStore((s) => s.activeGuides);

  const geometries = useMemo(() => {
    return activeGuides.map((g) => guideGeometry(g));
  }, [activeGuides]);

  // Dispose previous geometries when guides change
  const prevGeoRef = useRef<BufferGeometry[]>([]);
  useEffect(() => {
    const prev = prevGeoRef.current;
    prevGeoRef.current = [...geometries];
    return () => { for (const g of prev) g.dispose(); };
  }, [geometries]);

  if (activeGuides.length === 0) return null;

  return (
    <group name="snap-guides" renderOrder={2}>
      {geometries.map((geo, i) => (
        <lineSegments key={i} geometry={geo} material={guideMaterial} />
      ))}
    </group>
  );
}
