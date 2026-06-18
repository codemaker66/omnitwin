import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, LineDashedMaterial } from "three";
import { Html } from "@react-three/drei";
import { usePlacementStore } from "../stores/placement-store.js";
import { circulationBandLabel } from "../lib/circulation.js";
import {
  placedItemsCirculation,
  circulationOverlaySegments,
  type CirculationOverlaySegment,
} from "../lib/circulation-scene.js";

export const MAX_RENDERED_CIRCULATION_SEGMENTS = 8;
export const CIRCULATION_OVERLAY_MIN_VIEWPORT_WIDTH = 1100;

export function shouldRenderCirculationOverlay(viewportWidth: number): boolean {
  return viewportWidth >= CIRCULATION_OVERLAY_MIN_VIEWPORT_WIDTH;
}

// ---------------------------------------------------------------------------
// CirculationOverlay — draws the table aisles in the 3D scene.
//
// The planner HUD reports a number ("Tightest table aisle 0.7 m"); this turns
// it into something you can see — a dashed measurement line laid in the actual
// gap between two tables, anchored at the exact closest points (from the
// convex-polygon geometry engine), with a band-coloured distance pill at the
// midpoint.
//
// It surfaces EVERY pinch point, not just the worst: the tightest aisle is the
// prominent "primary" annotation, and every other sub-comfortable (tight or
// blocked) aisle is drawn subtly so a layout with several problems shows all of
// them. Comfortable/generous layouts show just the single headline measurement.
//
// SAFE LANGUAGE: a PLANNING-GRADE circulation estimate, never a legal egress
// route or fire-code width. The label text comes from circulationBandLabel.
// ---------------------------------------------------------------------------

const basePill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
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
  radius,
}: {
  readonly position: readonly [number, number, number];
  readonly color: string;
  readonly radius: number;
}): React.ReactElement {
  return (
    <mesh position={[position[0], position[1], position[2]]} renderOrder={4}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  );
}

/** One aisle annotation. Primary (tightest) is prominent; secondaries are subtle. */
function CirculationSegment({
  segment,
  showLabel,
}: {
  readonly segment: CirculationOverlaySegment;
  readonly showLabel: boolean;
}): React.ReactElement {
  const { primary } = segment;

  const geometry = useMemo(() => lineGeometry(segment), [segment]);
  const material = useMemo(
    () =>
      new LineDashedMaterial({
        color: segment.color,
        dashSize: primary ? 0.35 : 0.22,
        gapSize: primary ? 0.22 : 0.18,
        depthTest: false,
        transparent: true,
        opacity: primary ? 0.95 : 0.5,
      }),
    [segment, primary],
  );

  // Release GPU resources when the segment changes or the overlay unmounts.
  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);
  useEffect(() => {
    return () => { material.dispose(); };
  }, [material]);

  const gapText = `${segment.gapM.toFixed(1)} m`;
  const bandLabel = circulationBandLabel(segment.band);
  const ariaLabel = primary
    ? `Tightest table aisle ${gapText}. ${bandLabel}`
    : `Secondary table aisle ${gapText}. ${bandLabel}`;
  const dotRadius = primary ? 0.14 : 0.1;
  const dotSize = primary ? 8 : 6;

  return (
    <group renderOrder={3}>
      <lineSegments geometry={geometry} material={material} renderOrder={3} />
      <EndDot position={segment.from} color={segment.color} radius={dotRadius} />
      <EndDot position={segment.to} color={segment.color} radius={dotRadius} />
      {showLabel && (
        <group position={[segment.mid[0], segment.mid[1] + (primary ? 0.45 : 0.32), segment.mid[2]]}>
          <Html center>
            <div
              style={{
                ...basePill,
                fontSize: primary ? 11 : 10,
                padding: primary ? "3px 9px" : "2px 7px",
                opacity: primary ? 1 : 0.82,
              }}
              title={bandLabel}
              aria-label={ariaLabel}
            >
              <span
                aria-hidden="true"
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  background: segment.color,
                  flexShrink: 0,
                }}
              />
              {gapText}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

export function CirculationOverlay(): React.ReactElement | null {
  const viewportWidth = useThree((state) => state.size.width);
  const placedItems = usePlacementStore((s) => s.placedItems);
  const renderOverlay = shouldRenderCirculationOverlay(viewportWidth);

  const segments = useMemo(
    () => (
      renderOverlay
        ? circulationOverlaySegments(placedItemsCirculation(placedItems))
          .slice(0, MAX_RENDERED_CIRCULATION_SEGMENTS)
        : []
    ),
    [placedItems, renderOverlay],
  );

  if (!renderOverlay || segments.length === 0) return null;

  return (
    <group name="circulation-overlay" renderOrder={3}>
      {segments.map((seg, index) => (
        <CirculationSegment
          key={`${String(seg.from[0])},${String(seg.from[2])}-${String(seg.to[0])},${String(seg.to[2])}`}
          segment={seg}
          showLabel={index === 0}
        />
      ))}
    </group>
  );
}
