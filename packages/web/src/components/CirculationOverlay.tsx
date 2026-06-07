import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, LineDashedMaterial } from "three";
import { Html } from "@react-three/drei";
import { usePlacementStore } from "../stores/placement-store.js";
import { circulationBandLabel } from "../lib/circulation.js";
import {
  placedItemsCirculation,
  circulationOverlaySegment,
  type CirculationOverlaySegment,
} from "../lib/circulation-scene.js";

// ---------------------------------------------------------------------------
// CirculationOverlay — draws the tightest table aisle in the 3D scene.
//
// The planner HUD reports a number ("Tightest table aisle 0.7 m"); this turns
// that number into something you can see — a dashed measurement line laid in
// the actual gap between the two closest tables, anchored at the exact closest
// points (computed by the convex-polygon geometry engine), with a band-coloured
// distance pill at the midpoint. One annotation only — the single tightest
// pair — so it informs without cluttering the scene.
//
// SAFE LANGUAGE: a PLANNING-GRADE circulation estimate, never a legal egress
// route or fire-code width. The label text comes from circulationBandLabel.
// ---------------------------------------------------------------------------

const badgePill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 9px",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.2,
  borderRadius: 999,
  whiteSpace: "nowrap",
  pointerEvents: "none",
  userSelect: "none",
  background: "rgba(24, 22, 18, 0.86)",
  color: "#fdf6e7",
  boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
};

/** Build the two-point line geometry, including the lineDistance attribute that
 *  LineDashedMaterial needs for its dashes. */
function lineGeometry(seg: CirculationOverlaySegment): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [seg.from[0], seg.from[1], seg.from[2], seg.to[0], seg.to[1], seg.to[2]],
      3,
    ),
  );
  const dx = seg.to[0] - seg.from[0];
  const dy = seg.to[1] - seg.from[1];
  const dz = seg.to[2] - seg.from[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  geo.setAttribute("lineDistance", new Float32BufferAttribute([0, dist], 1));
  return geo;
}

function EndDot({
  position,
  color,
}: {
  readonly position: readonly [number, number, number];
  readonly color: string;
}): React.ReactElement {
  return (
    <mesh position={[position[0], position[1], position[2]]} renderOrder={4}>
      <sphereGeometry args={[0.14, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  );
}

export function CirculationOverlay(): React.ReactElement | null {
  const placedItems = usePlacementStore((s) => s.placedItems);

  const segment = useMemo(
    () => circulationOverlaySegment(placedItemsCirculation(placedItems)),
    [placedItems],
  );

  const geometry = useMemo(() => (segment === null ? null : lineGeometry(segment)), [segment]);
  const material = useMemo(
    () =>
      segment === null
        ? null
        : new LineDashedMaterial({
            color: segment.color,
            dashSize: 0.35,
            gapSize: 0.22,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
          }),
    [segment],
  );

  // Release GPU resources when the segment changes or the overlay unmounts.
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material?.dispose(), [material]);

  if (segment === null || geometry === null || material === null) return null;

  const gapText = `${segment.gapM.toFixed(1)} m`;
  const ariaLabel = `Tightest table aisle ${gapText}. ${circulationBandLabel(segment.band)}`;

  return (
    <group name="circulation-overlay" renderOrder={3}>
      <lineSegments geometry={geometry} material={material} renderOrder={3} />
      <EndDot position={segment.from} color={segment.color} />
      <EndDot position={segment.to} color={segment.color} />
      <group position={[segment.mid[0], segment.mid[1] + 0.45, segment.mid[2]]}>
        <Html center>
          <div style={badgePill} title={circulationBandLabel(segment.band)} aria-label={ariaLabel}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: segment.color,
                flexShrink: 0,
              }}
            />
            {gapText}
          </div>
        </Html>
      </group>
    </group>
  );
}
