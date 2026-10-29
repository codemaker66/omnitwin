import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  Float32BufferAttribute,
  OrthographicCamera,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
  type Camera,
  type Mesh,
} from "three";
import { LineDashedNodeMaterial, MeshBasicNodeMaterial } from "three/webgpu";
import { Html } from "@react-three/drei";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useDoorClearSpaceStore } from "../stores/door-clear-space-store.js";
import { useAssemblyRecallStore } from "../floor/assembly/recall.js";
import { isTableDressingApplicator } from "../lib/table-dressing.js";
import { circulationBandLabel } from "../lib/circulation.js";
import {
  placedItemsCirculation,
  circulationOverlaySegments,
  type CirculationOverlaySegment,
} from "../lib/circulation-scene.js";
import { floorLightOutput } from "./editor/floor-light-output.js";

export const MAX_RENDERED_CIRCULATION_SEGMENTS = 8;
export const CIRCULATION_OVERLAY_MIN_VIEWPORT_WIDTH = 1100;

export function shouldRenderCirculationOverlay(viewportWidth: number): boolean {
  return viewportWidth >= CIRCULATION_OVERLAY_MIN_VIEWPORT_WIDTH;
}

// ---------------------------------------------------------------------------
// CirculationOverlay — draws furniture clearances in the 3D scene.
//
// The planner HUD reports a number ("Tightest furniture clearance 0.7 m"); this turns
// it into something you can see — a dashed measurement line laid in the actual
// gap between two planning footprints, anchored at the exact closest points (from the
// convex-polygon geometry engine), with a band-coloured distance pill at the
// midpoint.
//
// It surfaces EVERY pinch point, not just the worst: the tightest clearance is the
// prominent "primary" annotation, and every other sub-comfortable (tight or
// blocked) clearance is drawn subtly so a layout with several problems shows all of
// them. Comfortable/generous layouts show just the single headline measurement.
//
// It is a tool for editing, so it shows only while the layout is being worked
// on (a piece in hand or carried, or a selection), never on a layout at rest
// or while the hall assembles. The lines and their end dots are light on the
// floor: depth-tested, so a table or a chair in front of them hides them, and
// the dots stay a few pixels across at any distance.
//
// SAFE LANGUAGE: a PLANNING-GRADE circulation estimate, never a legal egress
// route or fire-code width. The label text comes from circulationBandLabel.
// ---------------------------------------------------------------------------

/** Diameter of a clearance line's end dots on screen, CSS pixels, whatever the zoom. */
export const CIRCULATION_DOT_PX = { primary: 6, secondary: 4 } as const;

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

/** A clearance line's material: dashed light on the floor, hidden by what stands in front of it. */
export function circulationLineMaterial(color: string, primary: boolean): LineDashedNodeMaterial {
  const material = new LineDashedNodeMaterial({
    color,
    dashSize: primary ? 0.35 : 0.22,
    gapSize: primary ? 0.22 : 0.18,
    transparent: true,
    opacity: primary ? 0.95 : 0.5,
    depthWrite: false,
  });
  material.mrtNode = floorLightOutput();
  return material;
}

/** A clearance line's end dot: a small bead of light on the floor, hidden by what stands in front of it. */
export function circulationDotMaterial(color: string): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  material.mrtNode = floorLightOutput();
  return material;
}

const _inView = new Vector3();

/**
 * The world size of one CSS pixel at `point` as `camera` draws it into a
 * viewport `viewportHeight` pixels tall: by its depth in front of a
 * perspective camera, or the orthographic frustum's height.
 */
export function worldPerPixel(camera: Camera, viewportHeight: number, point: Vector3): number {
  if (camera instanceof OrthographicCamera) {
    return (camera.top - camera.bottom) / (camera.zoom * viewportHeight);
  }
  if (camera instanceof PerspectiveCamera) {
    const depth = Math.max(camera.near, -_inView.copy(point).applyMatrix4(camera.matrixWorldInverse).z);
    return (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / (camera.zoom * viewportHeight);
  }
  return 0;
}

/** Build the two-point line geometry, including the lineDistance attribute that
 *  LineDashedNodeMaterial needs for its dashes. */
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

/** An end dot, resized each frame to `px` CSS pixels across. */
function EndDot({
  position,
  geometry,
  material,
  px,
}: {
  readonly position: readonly [number, number, number];
  readonly geometry: SphereGeometry;
  readonly material: MeshBasicNodeMaterial;
  readonly px: number;
}): React.ReactElement {
  const mesh = useRef<Mesh>(null);
  useFrame(({ camera, size }) => {
    const dot = mesh.current;
    if (dot !== null) dot.scale.setScalar((px / 2) * worldPerPixel(camera, size.height, dot.position));
  });
  return (
    <mesh
      ref={mesh}
      position={[position[0], position[1], position[2]]}
      scale={0.02}
      geometry={geometry}
      material={material}
      renderOrder={4}
    />
  );
}

/** One clearance annotation. Primary (tightest) is prominent; secondaries are subtle. */
function CirculationSegment({
  segment,
  dotGeometry,
  showLabel,
}: {
  readonly segment: CirculationOverlaySegment;
  readonly dotGeometry: SphereGeometry;
  readonly showLabel: boolean;
}): React.ReactElement {
  const { primary, color } = segment;

  const geometry = useMemo(() => lineGeometry(segment), [segment]);
  // Keyed on the look, not the segment: a carry moves the segments every frame.
  const material = useMemo(() => circulationLineMaterial(color, primary), [color, primary]);
  const dotMaterial = useMemo(() => circulationDotMaterial(color), [color]);

  // Release GPU resources when the segment changes or the overlay unmounts.
  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);
  useEffect(() => {
    return () => { material.dispose(); };
  }, [material]);
  useEffect(() => {
    return () => { dotMaterial.dispose(); };
  }, [dotMaterial]);

  const gapText = `${segment.gapM.toFixed(1)} m`;
  const bandLabel = circulationBandLabel(segment.band);
  const ariaLabel = primary
    ? `Tightest furniture clearance ${gapText}. ${bandLabel}`
    : `Secondary furniture clearance ${gapText}. ${bandLabel}`;
  const dotPx = primary ? CIRCULATION_DOT_PX.primary : CIRCULATION_DOT_PX.secondary;
  const dotSize = primary ? 8 : 6;

  return (
    <group renderOrder={3}>
      <lineSegments geometry={geometry} material={material} renderOrder={3} />
      <EndDot position={segment.from} geometry={dotGeometry} material={dotMaterial} px={dotPx} />
      <EndDot position={segment.to} geometry={dotGeometry} material={dotMaterial} px={dotPx} />
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

/**
 * Whether the layout is being worked on: a piece in hand (a cloth or a place
 * setting dresses a table instead), a piece carried, or a selection; never
 * while the hall assembles.
 */
function usePlannerEditing(): boolean {
  const selecting = useSelectionStore((state) => state.selectedIds.size > 0);
  const placing = useCatalogueStore((state) => state.selectedItemId !== null && !isTableDressingApplicator(state.selectedItemId));
  const carrying = useDoorClearSpaceStore((state) => state.carrying);
  const assembling = useAssemblyRecallStore((state) => state.active);
  return !assembling && (selecting || placing || carrying);
}

export function CirculationOverlay(): React.ReactElement | null {
  const viewportWidth = useThree((state) => state.size.width);
  const placedItems = usePlacementStore((s) => s.placedItems);
  const editing = usePlannerEditing();
  const renderOverlay = editing && shouldRenderCirculationOverlay(viewportWidth);

  const segments = useMemo(
    () => (
      renderOverlay
        ? circulationOverlaySegments(placedItemsCirculation(placedItems))
          .slice(0, MAX_RENDERED_CIRCULATION_SEGMENTS)
        : []
    ),
    [placedItems, renderOverlay],
  );
  const dotGeometry = useMemo(() => new SphereGeometry(1, 12, 8), []);
  useEffect(() => {
    return () => { dotGeometry.dispose(); };
  }, [dotGeometry]);

  if (!renderOverlay || segments.length === 0) return null;

  return (
    <group name="circulation-overlay" renderOrder={3}>
      {segments.map((seg, index) => (
        <CirculationSegment
          key={`${String(seg.from[0])},${String(seg.from[2])}-${String(seg.to[0])},${String(seg.to[2])}`}
          segment={seg}
          dotGeometry={dotGeometry}
          showLabel={index === 0}
        />
      ))}
    </group>
  );
}
