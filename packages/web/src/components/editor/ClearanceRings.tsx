import { useMemo, type ReactElement } from "react";
import { Html } from "@react-three/drei";
import { useSelectionStore } from "../../stores/selection-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import {
  clearanceRingsForSelection,
  worstFailingRing,
  type ClearanceRingModel,
} from "../../lib/clearance-ring.js";
import { circulationBandColor } from "../../lib/circulation-scene.js";
import { RENDER_SCALE } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// ClearanceRings — the judged clear zone drawn under selected dining tables.
//
// A hairline ring hugs to the nearest obstruction (radius from the model in
// lib/clearance-ring), coloured by the planning band: green when the
// single-file walkway holds, amber/red when it does not. Every failing ring
// shows its colour; only the WORST failing ring speaks — one floor pill with
// the named neighbour and the broken rule, following CirculationOverlay's
// primary-annotation philosophy so a bad layout reads as one sentence, not
// a shout in every direction.
//
// Geometry is a unit circle scaled per frame-cheap React update — the radius
// lives in `scale`, so dragging a table re-renders two transforms, never a
// geometry rebuild.
// ---------------------------------------------------------------------------

/** Unit-circle outline points (XZ plane, y = 0), shared by every ring. */
const UNIT_CIRCLE_SEGMENTS = 96;
const UNIT_CIRCLE_POSITIONS: Float32Array = (() => {
  const positions = new Float32Array(UNIT_CIRCLE_SEGMENTS * 3);
  for (let i = 0; i < UNIT_CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / UNIT_CIRCLE_SEGMENTS) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle);
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle);
  }
  return positions;
})();

/** Just above the floor; below the circulation overlay's annotation plane. */
const RING_Y = 0.02;

function ringColor(ring: ClearanceRingModel): string {
  // A lone table has no gap to band ("open") — it passes on the full
  // comfortable ring, and pass reads green.
  if (ring.verdict === "pass" && ring.band === "open") return circulationBandColor("generous");
  return circulationBandColor(ring.band);
}

function RingOutline({ ring }: { readonly ring: ClearanceRingModel }): ReactElement {
  const color = ringColor(ring);
  const scale = ring.radiusM * RENDER_SCALE;
  return (
    <group
      position={[ring.centreX * RENDER_SCALE, RING_Y, ring.centreZ * RENDER_SCALE]}
      scale={[scale, 1, scale]}
    >
      <lineLoop>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[UNIT_CIRCLE_POSITIONS, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </lineLoop>
      {/* A whisper of fill so the zone reads as area, not just an outline. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, UNIT_CIRCLE_SEGMENTS]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function ClearanceRings(): ReactElement | null {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const placedItems = usePlacementStore((s) => s.placedItems);

  const rings = useMemo(
    () => clearanceRingsForSelection(selectedIds, placedItems),
    [selectedIds, placedItems],
  );
  const worst = useMemo(() => worstFailingRing(rings), [rings]);

  if (rings.length === 0) return null;

  return (
    <group name="clearance-rings">
      {rings.map((ring) => <RingOutline key={ring.itemId} ring={ring} />)}
      {worst !== null && worst.reason !== null && (
        <Html
          position={[
            worst.centreX * RENDER_SCALE,
            RING_Y + 0.03,
            (worst.centreZ + worst.radiusM) * RENDER_SCALE,
          ]}
          center
          zIndexRange={[30, 0]}
        >
          <div
            data-testid="clearance-ring-reason"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              userSelect: "none",
              background: "rgba(24, 22, 18, 0.86)",
              color: "#fdf6e7",
              boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
            }}
            // Planning-grade language, never a legal egress claim.
            title="Planning-grade clearance estimate"
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: circulationBandColor(worst.band),
              }}
            />
            {worst.reason}
          </div>
        </Html>
      )}
    </group>
  );
}
