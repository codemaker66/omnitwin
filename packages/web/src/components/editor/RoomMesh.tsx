import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Shape, DoubleSide, BufferGeometry, Float32BufferAttribute, type Group } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { RoomGeometry, RoomFeature } from "../../data/room-geometries.js";
import { FLOOR_COLOR, GRID_COLOR, DOME_COLOR, WALL_COLOR } from "../../constants/colors.js";
import { sectionClipPlanes, noClipPlanes } from "../SectionPlane.js";
import { useVisibilityStore, type WallKey } from "../../stores/visibility-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import {
  useLayoutTimelinePreviewStore,
  type LayoutTimelinePreviewSessionMode,
  type LayoutTimelinePreviewState,
} from "../../stores/layout-timeline-preview-store.js";
import { BrickWall } from "../BrickWall.js";
import { GrandHallOrnaments } from "../GrandHallOrnaments.js";
import { GrandHallDome } from "../GrandHallDome.js";
import { SyntheticTradesHallFacade } from "./SyntheticTradesHallFacade.js";
import {
  createDomeInteriorTexture,
  createParquetFloorTexture,
} from "../../lib/grand-hall-textures.js";
import { TIMELINE_IMPERATIVE_MORPH_THRESHOLD } from "../../lib/layout-timeline.js";

// ---------------------------------------------------------------------------
// RoomMesh — renders accurate room geometry from polygon data
// Walls use BrickWall for click-to-toggle brick animation.
// Camera-based auto-fade driven via the visibility store.
// ---------------------------------------------------------------------------

const GRID_Y = 0.002;
export const GRAND_HALL_ORNAMENT_MIN_VIEWPORT_WIDTH = 1100;
export const DETAILED_ROOM_SHELL_MIN_VIEWPORT_WIDTH = 1100;

interface GrandHallOrnamentBudgetInput {
  readonly isGrandHall: boolean;
  readonly viewportWidth: number;
  readonly detail?: RoomMeshDetail;
}

export function shouldRenderGrandHallOrnaments({
  isGrandHall,
  viewportWidth,
  detail = "auto",
}: GrandHallOrnamentBudgetInput): boolean {
  if (!isGrandHall || detail === "lean") return false;
  return detail === "detailed" || viewportWidth >= GRAND_HALL_ORNAMENT_MIN_VIEWPORT_WIDTH;
}

export function shouldUseLeanPlannerRoomShell(viewportWidth: number): boolean {
  return viewportWidth < DETAILED_ROOM_SHELL_MIN_VIEWPORT_WIDTH;
}

function polygonToShape(polygon: readonly (readonly [number, number])[]): Shape {
  const shape = new Shape();
  const first = polygon[0];
  if (first === undefined) return shape;
  shape.moveTo(toRenderSpace(first[0]), toRenderSpace(first[1]));
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i];
    if (pt !== undefined) {
      shape.lineTo(toRenderSpace(pt[0]), toRenderSpace(pt[1]));
    }
  }
  shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// Wall segment — precomputed from polygon
// ---------------------------------------------------------------------------

interface WallSegment {
  readonly cx: number;
  readonly cz: number;
  readonly width: number;
  readonly rotY: number;
  readonly normalX: number;
  readonly normalZ: number;
  /** Cardinal wall key this segment maps to (based on dominant normal direction). */
  readonly wallKey: WallKey;
}

/** Maps a wall outward normal to the nearest cardinal WallKey. */
function normalToWallKey(nx: number, nz: number): WallKey {
  if (Math.abs(nx) > Math.abs(nz)) {
    return nx > 0 ? "wall-right" : "wall-left";
  }
  return nz > 0 ? "wall-front" : "wall-back";
}

function computeWallSegments(polygon: readonly (readonly [number, number])[]): readonly WallSegment[] {
  const segments: WallSegment[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;

    const ax = toRenderSpace(a[0]);
    const az = toRenderSpace(a[1]);
    const bx = toRenderSpace(b[0]);
    const bz = toRenderSpace(b[1]);

    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue; // skip degenerate segments
    const rotY = -Math.atan2(dz, dx);

    // Outward normal for clockwise winding
    const nx = dz / len;
    const nz = -dx / len;

    segments.push({ cx, cz, width: len, rotY, normalX: nx, normalZ: nz, wallKey: normalToWallKey(nx, nz) });
  }
  return segments;
}

interface RenderBounds {
  readonly width: number;
  readonly length: number;
}

function computeRenderBounds(polygon: readonly (readonly [number, number])[]): RenderBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    const rx = toRenderSpace(x);
    const rz = toRenderSpace(z);
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz);
    maxZ = Math.max(maxZ, rz);
  }
  return {
    width: Math.max(0, maxX - minX),
    length: Math.max(0, maxZ - minZ),
  };
}

// ---------------------------------------------------------------------------
// CameraWallDriver — updates visibility store from camera position
// ---------------------------------------------------------------------------

function CameraWallDriver(): null {
  const { camera, invalidate } = useThree();

  useFrame((_state, delta) => {
    const mode = useVisibilityStore.getState().mode;
    if (mode === "manual") return;

    const transitioning = useVisibilityStore.getState().updateAutoWalls(
      camera.position.x, camera.position.z, delta,
    );
    if (transitioning) {
      invalidate();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Feature mesh
// ---------------------------------------------------------------------------

function FeatureMesh({ feature }: { readonly feature: RoomFeature }): React.ReactElement {
  const shape = useMemo(() => polygonToShape(feature.polygon), [feature.polygon]);
  return (
    <mesh
      name={`feature-${feature.label.toLowerCase().replace(/\s+/g, "-")}`}
      position={[0, feature.height / 2, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <extrudeGeometry args={[shape, { depth: feature.height, bevelEnabled: false }]} />
      <meshStandardMaterial color="#8a7a6a" roughness={0.85} metalness={0} clippingPlanes={noClipPlanes} />
    </mesh>
  );
}

function LeanWall({
  segment,
  wallHeight,
  color,
}: {
  readonly segment: WallSegment;
  readonly wallHeight: number;
  readonly color: string;
}): React.ReactElement {
  return (
    <mesh
      name={segment.wallKey}
      position={[segment.cx, wallHeight / 2, segment.cz]}
      rotation={[0, segment.rotY, 0]}
    >
      <boxGeometry args={[segment.width, wallHeight, 0.08]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.86}
        clippingPlanes={sectionClipPlanes}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Floor grid
// ---------------------------------------------------------------------------

function FloorGrid({
  polygon,
  opacity = 0.22,
}: {
  readonly polygon: readonly (readonly [number, number])[];
  readonly opacity?: number;
}): React.ReactElement {
  const gridGeom = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of polygon) {
      const rx = toRenderSpace(x);
      const rz = toRenderSpace(z);
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    const margin = 2;
    minX -= margin; maxX += margin;
    minZ -= margin; maxZ += margin;

    const vertices: number[] = [];
    for (let z = Math.floor(minZ); z <= maxZ + 0.001; z += 1) {
      vertices.push(minX, 0, z, maxX, 0, z);
    }
    for (let x = Math.floor(minX); x <= maxX + 0.001; x += 1) {
      vertices.push(x, 0, minZ, x, 0, maxZ);
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    return geom;
  }, [polygon]);

  return (
    <lineSegments geometry={gridGeom} position={[0, GRID_Y, 0]}>
      <lineBasicMaterial color={GRID_COLOR} transparent opacity={opacity} />
    </lineSegments>
  );
}

function SyntheticGrandHallFoundation({
  width,
  length,
}: RenderBounds): React.ReactElement {
  return (
    <group name="synthetic-grand-hall-foundation">
      <mesh name="synthetic-grand-hall-plinth" position={[0, -0.24, 0]}>
        <boxGeometry args={[width + 0.56, 0.4, length + 0.56]} />
        <meshStandardMaterial color="#15110e" roughness={0.88} metalness={0.04} />
      </mesh>
      <mesh name="synthetic-grand-hall-floor-shadow" rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.445, 0]}>
        <planeGeometry args={[width + 1.1, length + 1.1]} />
        <meshBasicMaterial color="#05080b" transparent opacity={0.72} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// RoomMesh — main component
// ---------------------------------------------------------------------------

export type RoomMeshDetail = "auto" | "lean" | "detailed";
export type RoomMeshVariant = "grand-hall" | "grand-hall-synthetic" | "generic";

interface RoomMeshProps {
  readonly geometry: RoomGeometry;
  readonly variant?: RoomMeshVariant;
  readonly detail?: RoomMeshDetail;
}

export function shouldShowDetailedRoomDuringTimelineMotion(
  mode: LayoutTimelinePreviewSessionMode,
  itemCount: number,
): boolean {
  return mode !== "transition" || itemCount <= TIMELINE_IMPERATIVE_MORPH_THRESHOLD;
}

function timelinePreviewItemCount(state: LayoutTimelinePreviewState): number {
  return state.transition === null
    ? state.currentItems.length
    : Math.max(state.transition.fromItems.length, state.transition.toItems.length);
}

function TimelineRoomMotionDetailDriver({
  proxyGroupRef,
  detailGroupRef,
  useLeanRoomShell,
}: {
  readonly proxyGroupRef: RefObject<Group | null>;
  readonly detailGroupRef: RefObject<Group | null>;
  readonly useLeanRoomShell: boolean;
}): null {
  const invalidate = useThree((state) => state.invalidate);
  const domElement = useThree((state) => state.gl.domElement);

  useLayoutEffect(() => {
    let previousMode: "detailed" | "lean" | "proxy" | null = null;
    const apply = (state: LayoutTimelinePreviewState): void => {
      const showTimelineDetail = shouldShowDetailedRoomDuringTimelineMotion(
        state.mode,
        timelinePreviewItemCount(state),
      );
      const mode = useLeanRoomShell ? "lean" : showTimelineDetail ? "detailed" : "proxy";
      if (mode === previousMode) return;
      previousMode = mode;
      if (proxyGroupRef.current !== null) {
        proxyGroupRef.current.visible = mode !== "detailed";
      }
      if (detailGroupRef.current !== null) {
        detailGroupRef.current.visible = mode === "detailed";
      }
      domElement.closest(".planner-scene-canvas-host")
        ?.setAttribute("data-room-motion-detail", mode);
      invalidate();
    };

    apply(useLayoutTimelinePreviewStore.getState());
    return useLayoutTimelinePreviewStore.subscribe(apply);
  }, [detailGroupRef, domElement, invalidate, proxyGroupRef, useLeanRoomShell]);

  return null;
}

export function shouldUseRoomMeshLeanShell(
  detail: RoomMeshDetail,
  viewportWidth: number,
  cameraInteractionActive = false,
): boolean {
  if (cameraInteractionActive) return true;
  if (detail === "lean") return true;
  if (detail === "detailed") return false;
  return shouldUseLeanPlannerRoomShell(viewportWidth);
}

export function shouldRenderSyntheticTradesHallFacade(
  isSyntheticGrandHall: boolean,
  useLeanRoomShell: boolean,
): boolean {
  return isSyntheticGrandHall && !useLeanRoomShell;
}

export function RoomMesh({
  geometry,
  variant = "generic",
  detail = "auto",
}: RoomMeshProps): React.ReactElement {
  const { size } = useThree();
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const floorShape = useMemo(() => polygonToShape(geometry.wallPolygon), [geometry.wallPolygon]);
  const walls = useMemo(() => computeWallSegments(geometry.wallPolygon), [geometry.wallPolygon]);
  const bounds = useMemo(() => computeRenderBounds(geometry.wallPolygon), [geometry.wallPolygon]);
  const { ceilingHeight } = geometry;
  const isGrandHall = variant === "grand-hall" || variant === "grand-hall-synthetic";
  const isSyntheticGrandHall = variant === "grand-hall-synthetic";
  const useLeanRoomShell = shouldUseRoomMeshLeanShell(detail, size.width, cameraInteractionActive);
  const renderSyntheticFacade = shouldRenderSyntheticTradesHallFacade(isSyntheticGrandHall, useLeanRoomShell);
  const renderGrandHallOrnaments = shouldRenderGrandHallOrnaments({
    isGrandHall,
    viewportWidth: size.width,
    detail,
  });
  const proxyGroupRef = useRef<Group | null>(null);
  const detailGroupRef = useRef<Group | null>(null);

  const surfaceTextures = useMemo(() => {
    if (!isGrandHall || useLeanRoomShell || typeof document === "undefined") return null;
    try {
      return {
        floor: createParquetFloorTexture(),
        dome: createDomeInteriorTexture(),
      };
    } catch {
      return null;
    }
  }, [isGrandHall, useLeanRoomShell]);

  useEffect(() => {
    return () => {
      surfaceTextures?.floor.dispose();
      surfaceTextures?.dome.dispose();
    };
  }, [surfaceTextures]);

  const syntheticDomeRadius = Math.min(bounds.width, bounds.length) * 0.2;
  const domeRadius = geometry.hasDome ? geometry.domeRadius : syntheticDomeRadius;
  const showDome = geometry.hasDome && !isSyntheticGrandHall;

  return (
    <group
      name={isSyntheticGrandHall ? "synthetic-grand-hall-stand-in" : "room-mesh"}
      userData={isSyntheticGrandHall ? { presentationSource: "synthetic-stand-in" } : undefined}
    >
      {/* Lighting */}
      {!useLeanRoomShell && (
        <>
          <hemisphereLight
            args={isSyntheticGrandHall
              ? ["#7994ad", "#bd7844", 0.82]
              : ["#f0f0ff", "#d0c8c0", 1.2]}
          />
          <ambientLight intensity={isSyntheticGrandHall ? 0.28 : 0.3} />
          {isSyntheticGrandHall && (
            <directionalLight color="#ffd09a" position={[-8, 13, 9]} intensity={1.08} />
          )}
        </>
      )}

      {/* Camera-driven wall auto-fade */}
      {!useLeanRoomShell && <CameraWallDriver />}

      {/* The synthetic Grand Hall uses an explicit rectangular deck. The
          generic polygon floor remains untouched for measured/custom rooms. */}
      {isSyntheticGrandHall ? (
        <mesh name="floor" position={[0, -0.03, 0]}>
          <boxGeometry args={[bounds.width, 0.06, bounds.length]} />
          {useLeanRoomShell ? (
            <meshBasicMaterial color="#c18c4f" />
          ) : (
            <meshStandardMaterial
              color="#d5a164"
              map={surfaceTextures?.floor ?? null}
              roughness={0.58}
              metalness={0.04}
            />
          )}
        </mesh>
      ) : (
        <mesh name="floor" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <shapeGeometry args={[floorShape]} />
          {useLeanRoomShell ? (
            <meshBasicMaterial
              color={FLOOR_COLOR}
              side={DoubleSide}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              clippingPlanes={noClipPlanes}
            />
          ) : (
            <meshStandardMaterial
              color={FLOOR_COLOR}
              map={surfaceTextures?.floor ?? null}
              side={DoubleSide}
              roughness={isGrandHall ? 0.62 : 0.95}
              metalness={isGrandHall ? 0.05 : 0}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              clippingPlanes={noClipPlanes}
            />
          )}
        </mesh>
      )}

      {isSyntheticGrandHall && <SyntheticGrandHallFoundation {...bounds} />}

      {/* Floor grid */}
      <FloorGrid polygon={geometry.wallPolygon} opacity={isSyntheticGrandHall ? 0.075 : 0.22} />

      {/* The proxy walls are always allocated. Dense timeline motion can hide
          the detailed graph without paying a dispose/rebuild cost at settle. */}
      <group
        ref={proxyGroupRef}
        name="room-motion-proxy-walls"
        visible={useLeanRoomShell}
      >
        {walls.map((w, i) => (
          <LeanWall
            key={`wall-${String(i)}`}
            segment={w}
            wallHeight={ceilingHeight}
            color={WALL_COLOR}
          />
        ))}
      </group>

      {!useLeanRoomShell && (
        <group ref={detailGroupRef} name="room-architectural-detail">
          {renderSyntheticFacade && (
            <SyntheticTradesHallFacade
              width={bounds.width}
              length={bounds.length}
              height={ceilingHeight}
            />
          )}

          {/* Walls — BrickWall instances with click-to-toggle animation.
              Each segment maps to a cardinal WallKey so the visibility store
              drives auto-fade from camera position AND click toggles. */}
          {walls.map((w, i) => (
            <BrickWall
              key={`wall-${String(i)}`}
              name={w.wallKey}
              wallWidth={w.width}
              wallHeight={ceilingHeight}
              position={[w.cx, ceilingHeight / 2, w.cz]}
              rotation={[0, w.rotY, 0]}
              color={WALL_COLOR}
            />
          ))}

          {/* Features (balconies, platforms) */}
          {geometry.features.map((f, i) => (
            <FeatureMesh key={`feature-${String(i)}`} feature={f} />
          ))}

          {/* Dome */}
          {showDome && domeRadius > 0 && (
            <GrandHallDome
              radius={domeRadius}
              ceilingHeight={ceilingHeight}
              color={DOME_COLOR}
              texture={surfaceTextures?.dome ?? null}
              clippingPlanes={sectionClipPlanes}
            />
          )}

          {renderGrandHallOrnaments && (
            <GrandHallOrnaments
              width={bounds.width}
              length={bounds.length}
              height={ceilingHeight}
              domeRadius={domeRadius}
              cutaway={isSyntheticGrandHall}
            />
          )}
        </group>
      )}
      <TimelineRoomMotionDetailDriver
        proxyGroupRef={proxyGroupRef}
        detailGroupRef={detailGroupRef}
        useLeanRoomShell={useLeanRoomShell}
      />
    </group>
  );
}
