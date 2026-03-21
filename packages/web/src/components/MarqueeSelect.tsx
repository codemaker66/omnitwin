import { useMemo } from "react";
import { Shape, ShapeGeometry, DoubleSide } from "three";
import { useSelectionStore } from "../stores/selection-store.js";

// ---------------------------------------------------------------------------
// MarqueeSelect — 3D floor-projected selection rectangle
// ---------------------------------------------------------------------------
// Renders on the floor plane (y=0.01) in world space, aligned with the grid.
// A subtle blue translucent fill + solid border gives accurate spatial feedback
// during drag-select, matching the room's coordinate system exactly.
// ---------------------------------------------------------------------------

/** Height above floor to prevent z-fighting with the grid. */
const FLOOR_OFFSET = 0.01;

/** Border width in world units. */
const BORDER_WIDTH = 0.04;

/**
 * Build a rectangular outline shape (hollow rectangle).
 * Returns a Shape with an outer path and a hole (inner rect),
 * producing a thin border when used with ShapeGeometry.
 */
function buildBorderShape(w: number, h: number, thickness: number): Shape {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, h);
  shape.lineTo(0, h);
  shape.lineTo(0, 0);

  const hole = new Shape();
  hole.moveTo(thickness, thickness);
  hole.lineTo(w - thickness, thickness);
  hole.lineTo(w - thickness, h - thickness);
  hole.lineTo(thickness, h - thickness);
  hole.lineTo(thickness, thickness);
  shape.holes.push(hole);

  return shape;
}

/**
 * 3D marquee rectangle rendered on the floor plane.
 * Must be placed inside the R3F Canvas (not in HTML overlay layer).
 */
export function MarqueeSelect(): React.ReactElement | null {
  const marqueeActive = useSelectionStore((s) => s.marqueeActive);
  const worldStart = useSelectionStore((s) => s.marqueeWorldStart);
  const worldEnd = useSelectionStore((s) => s.marqueeWorldEnd);

  // Compute rectangle bounds in world space
  const bounds = useMemo(() => {
    if (worldStart === null || worldEnd === null) return null;
    const minX = Math.min(worldStart.x, worldEnd.x);
    const maxX = Math.max(worldStart.x, worldEnd.x);
    const minZ = Math.min(worldStart.z, worldEnd.z);
    const maxZ = Math.max(worldStart.z, worldEnd.z);
    const w = maxX - minX;
    const h = maxZ - minZ;
    if (w < 0.02 && h < 0.02) return null;
    return { minX, minZ, w, h };
  }, [worldStart, worldEnd]);

  // Build fill geometry (simple plane)
  const fillGeometry = useMemo(() => {
    if (bounds === null) return null;
    const fillShape = new Shape();
    fillShape.moveTo(0, 0);
    fillShape.lineTo(bounds.w, 0);
    fillShape.lineTo(bounds.w, bounds.h);
    fillShape.lineTo(0, bounds.h);
    fillShape.lineTo(0, 0);
    return new ShapeGeometry(fillShape);
  }, [bounds]);

  // Build border geometry (hollow rectangle)
  const borderGeometry = useMemo(() => {
    if (bounds === null) return null;
    const bw = Math.min(BORDER_WIDTH, bounds.w * 0.5, bounds.h * 0.5);
    const shape = buildBorderShape(bounds.w, bounds.h, bw);
    return new ShapeGeometry(shape);
  }, [bounds]);

  if (!marqueeActive || bounds === null || fillGeometry === null || borderGeometry === null) {
    return null;
  }

  // Position at minX, floor, minZ — ShapeGeometry is in XY plane,
  // rotated +90° around X to lie flat on XZ floor (shape Y → world +Z).
  return (
    <group
      position={[bounds.minX, FLOOR_OFFSET, bounds.minZ]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      {/* Translucent fill */}
      <mesh geometry={fillGeometry}>
        <meshBasicMaterial
          color="#4499ff"
          transparent
          opacity={0.10}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Solid border */}
      <mesh geometry={borderGeometry} position={[0, 0, 0.001]}>
        <meshBasicMaterial
          color="#4499ff"
          transparent
          opacity={0.75}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
