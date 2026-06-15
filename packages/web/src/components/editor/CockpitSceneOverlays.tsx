import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
} from "three";
import type { AgentTrajectory, DensityHeatmapCell, RouteConflict, SpaceDimensions } from "@omnitwin/types";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useCockpitReplay } from "../../hooks/use-cockpit-replay.js";
import {
  densityPatchExtent,
  projectReplayPointToFloor,
  sampleTrajectoryAtProgress,
  trajectoryFloorPolyline,
  type ReplayRoomBounds,
  type WorldPoint,
} from "../../lib/cockpit-overlay-projection.js";
import {
  cockpitOverlayLayers,
  conflictSeverityColor,
  densityLevelColor,
  selectDensityCells,
  selectFlowTrajectories,
  selectMoteTrajectories,
  selectRouteConflicts,
  shouldLoadReplay,
} from "../../lib/cockpit-scene-overlay-model.js";

// ---------------------------------------------------------------------------
// CockpitSceneOverlays — world-anchored, camera-tracked planning overlays.
//
// This replaces the dev page's percentage-positioned 2D overlays with real
// R3F geometry that lives *inside* the editable canvas, so it pins to the
// floor and tracks the camera under orbit / pan / zoom. Everything is driven
// by the real guest-flow replay artifact + the loaded room footprint through
// the tested pure mappers; the lens + Layers toggles decide what shows.
//
// SAFE: these are *simulated* planning overlays — human review required. No
// overlay claims a measured route, a certified clearance, or a surveyed
// heritage boundary. The heritage band is an explicit planning guide and the
// lighting probe grid is an explicit placeholder.
// ---------------------------------------------------------------------------

const FLOW_Y = 0.06;
const MOTE_Y = 0.22;
const DENSITY_Y = 0.04;
const CONFLICT_Y = 0.05;
const HERITAGE_Y = 0.05;
const PROBE_Y = 0.04;

const MAX_FLOW_PATHS = 6;
const MAX_MOTES = 10;
const MAX_DENSITY = 8;
const MAX_CONFLICTS = 4;
const DEFAULT_DENSITY_CELL_SIZE_M = 1.5;

const MOTE_SPEED = 0.12; // cycles per second
const MOTE_PHASE = 0.13; // per-mote offset so they don't move in lockstep

const FLOW_COLOR = "#6bd9e8";
const MOTE_COLOR = "#d7f0ff";
const HERITAGE_COLOR = "#c9a84c";
const PROBE_COLOR = "#c9b06b";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function labelStyle(color: string): React.CSSProperties {
  return {
    transform: "translateY(-50%)",
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(18, 16, 12, 0.84)",
    border: `1px solid ${color}`,
    color: "#fdf6e7",
    font: "600 10px/1.25 'Inter', system-ui, sans-serif",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
  };
}

/** Build a line-segment-pair geometry from a world polyline (matches the
 *  repo's lineSegments idiom in CirculationOverlay). */
function polylineSegmentGeometry(points: readonly WorldPoint[]): BufferGeometry {
  const verts: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
  return geo;
}

function rectOutlineGeometry(halfWidth: number, halfLength: number, y: number): BufferGeometry {
  const corners: WorldPoint[] = [
    [-halfWidth, y, -halfLength],
    [halfWidth, y, -halfLength],
    [halfWidth, y, halfLength],
    [-halfWidth, y, halfLength],
  ];
  const verts: number[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (a === undefined || b === undefined) continue;
    verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
  return geo;
}

function FlowPath({ points }: { readonly points: readonly WorldPoint[] }): ReactElement {
  const geometry = useMemo(() => polylineSegmentGeometry(points), [points]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  return (
    <lineSegments geometry={geometry} renderOrder={3}>
      <lineBasicMaterial color={FLOW_COLOR} transparent opacity={0.55} depthTest={false} />
    </lineSegments>
  );
}

function FlowPaths({
  trajectories,
  bounds,
  dimensions,
}: {
  readonly trajectories: readonly AgentTrajectory[];
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  return (
    <group name="cockpit-flow-paths" renderOrder={3}>
      {trajectories.map((trajectory) => (
        <FlowPath
          key={trajectory.agentId}
          points={trajectoryFloorPolyline(trajectory.points, bounds, dimensions, FLOW_Y)}
        />
      ))}
    </group>
  );
}

function AgentMotes({
  trajectories,
  bounds,
  dimensions,
}: {
  readonly trajectories: readonly AgentTrajectory[];
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<Group>(null);
  const progress = useRef(0);
  const reduced = prefersReducedMotion();

  useFrame((_state, delta) => {
    if (reduced) return;
    const group = groupRef.current;
    if (group === null) return;
    progress.current = (progress.current + delta * MOTE_SPEED) % 1;
    group.children.forEach((child, index) => {
      const trajectory = trajectories[index];
      if (trajectory === undefined) return;
      const t = (progress.current + index * MOTE_PHASE) % 1;
      const p = sampleTrajectoryAtProgress(trajectory.points, t, bounds, dimensions, MOTE_Y);
      child.position.set(p[0], p[1], p[2]);
    });
    invalidate();
  });

  return (
    <group ref={groupRef} name="cockpit-agent-motes" renderOrder={4}>
      {trajectories.map((trajectory, index) => {
        const t0 = reduced ? index / Math.max(1, trajectories.length) : (index * MOTE_PHASE) % 1;
        const p = sampleTrajectoryAtProgress(trajectory.points, t0, bounds, dimensions, MOTE_Y);
        return (
          <mesh key={trajectory.agentId} position={[p[0], p[1], p[2]]} renderOrder={4}>
            <sphereGeometry args={[0.17, 12, 12]} />
            <meshBasicMaterial
              color={MOTE_COLOR}
              transparent
              opacity={0.92}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function DensityPatches({
  cells,
  cellSizeM,
  bounds,
  dimensions,
}: {
  readonly cells: readonly DensityHeatmapCell[];
  readonly cellSizeM: number;
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const { sizeX, sizeZ } = densityPatchExtent(cellSizeM, bounds, dimensions);
  return (
    <group name="cockpit-density" renderOrder={2}>
      {cells.map((cell) => {
        const [x, , z] = projectReplayPointToFloor(cell, bounds, dimensions, DENSITY_Y);
        return (
          <mesh
            key={`${String(cell.x)}:${String(cell.y)}:${String(cell.count)}`}
            position={[x, DENSITY_Y, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
          >
            <planeGeometry args={[sizeX, sizeZ]} />
            <meshBasicMaterial
              color={densityLevelColor(cell.level)}
              transparent
              opacity={cell.level === "high" ? 0.36 : 0.22}
              blending={AdditiveBlending}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function RouteConflictMarker({
  conflict,
  bounds,
  dimensions,
}: {
  readonly conflict: RouteConflict;
  readonly bounds: ReplayRoomBounds;
  readonly dimensions: SpaceDimensions;
}): ReactElement {
  const setBeam = useCockpitStore((state) => state.setBeam);
  const clearBeam = useCockpitStore((state) => state.clearBeam);
  const [x, , z] = projectReplayPointToFloor(conflict.point, bounds, dimensions, CONFLICT_Y);
  const color = conflictSeverityColor(conflict.severity);
  const tone = conflict.severity === "review" ? "review" : "info";
  const caption = conflict.severity === "review" ? "Simulated · review required" : "Simulated · attention";

  const raiseBeam = (): void => {
    setBeam({ anchor: [x, CONFLICT_Y, z], label: conflict.message, tone });
  };

  return (
    <group position={[x, CONFLICT_Y, z]} renderOrder={5}>
      {/* Floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[0.5, 0.66, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} side={DoubleSide} />
      </mesh>
      {/* Pin the hover/focus zone sits on; raising the evidence beam */}
      <mesh
        position={[0, 0.5, 0]}
        onPointerOver={raiseBeam}
        onPointerOut={() => { clearBeam(); }}
        renderOrder={5}
      >
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial color={color} depthWrite={false} />
      </mesh>
      <group position={[0, 1, 0]}>
        <Html center>
          <button
            type="button"
            style={{ ...labelStyle(color), pointerEvents: "auto", cursor: "default" }}
            onMouseEnter={raiseBeam}
            onMouseLeave={() => { clearBeam(); }}
            onFocus={raiseBeam}
            onBlur={() => { clearBeam(); }}
            aria-label={`${caption}. ${conflict.message}`}
          >
            {caption}
          </button>
        </Html>
      </group>
    </group>
  );
}

function HeritageBufferBand({ dimensions }: { readonly dimensions: SpaceDimensions }): ReactElement {
  // Honest planning guide: a band inset from the room perimeter where it is
  // wise to keep furniture clear of walls / protected features. It is NOT a
  // surveyed heritage boundary — the label says so.
  const inset = 1.2;
  const halfWidth = Math.max(0.5, dimensions.width / 2 - inset);
  const halfLength = Math.max(0.5, dimensions.length / 2 - inset);
  const geometry = useMemo(
    () => rectOutlineGeometry(halfWidth, halfLength, HERITAGE_Y),
    [halfWidth, halfLength],
  );
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  return (
    <group name="cockpit-heritage" renderOrder={3}>
      <lineSegments geometry={geometry} renderOrder={3}>
        <lineBasicMaterial color={HERITAGE_COLOR} transparent opacity={0.5} depthTest={false} />
      </lineSegments>
      <group position={[0, 0.9, -halfLength]}>
        <Html center>
          <span style={labelStyle(HERITAGE_COLOR)}>
            Heritage &amp; wall buffer · planning guide — confirm protected features with the venue
          </span>
        </Html>
      </group>
    </group>
  );
}

function LightingProbeGrid({ dimensions }: { readonly dimensions: SpaceDimensions }): ReactElement {
  // Explicit placeholder: a regular probe grid, not measured photometrics.
  const cols = 3;
  const rows = 2;
  const halfWidth = dimensions.width / 2;
  const halfLength = dimensions.length / 2;
  const probes: WorldPoint[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = -halfWidth * 0.6 + (c / (cols - 1)) * halfWidth * 1.2;
      const z = -halfLength * 0.6 + (r / (rows - 1)) * halfLength * 1.2;
      probes.push([x, PROBE_Y, z]);
    }
  }
  return (
    <group name="cockpit-lighting-probes" renderOrder={3}>
      {probes.map((p, index) => (
        <mesh key={`probe-${String(index)}`} position={[p[0], PROBE_Y, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[0.28, 0.36, 20]} />
          <meshBasicMaterial color={PROBE_COLOR} transparent opacity={0.5} depthWrite={false} side={DoubleSide} />
        </mesh>
      ))}
      <group position={[0, 0.7, 0]}>
        <Html center>
          <span style={labelStyle(PROBE_COLOR)}>
            Lighting probe grid · planning placeholder (no measured photometrics)
          </span>
        </Html>
      </group>
    </group>
  );
}

export function CockpitSceneOverlays(): ReactElement | null {
  const overlayVisibility = useCockpitStore((state) => state.overlayVisibility);
  const activeMode = useCockpitStore((state) => state.activeMode);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const invalidate = useThree((state) => state.invalidate);

  const layers = useMemo(
    () => cockpitOverlayLayers(overlayVisibility, activeMode),
    [overlayVisibility, activeMode],
  );
  const replayNeeded = useMemo(
    () => shouldLoadReplay(overlayVisibility, activeMode),
    [overlayVisibility, activeMode],
  );
  const { artifact, bounds } = useCockpitReplay(replayNeeded);

  // Redraw the demand-mode canvas whenever the visible overlay set changes.
  useEffect(() => { invalidate(); }, [layers, artifact, dimensions, invalidate]);

  const flowTrajectories = useMemo(
    () => (artifact === null ? [] : selectFlowTrajectories(artifact.trajectories, MAX_FLOW_PATHS)),
    [artifact],
  );
  const moteTrajectories = useMemo(
    () => (artifact === null ? [] : selectMoteTrajectories(artifact.trajectories, MAX_MOTES)),
    [artifact],
  );
  const densityCells = useMemo(
    () => (artifact === null ? [] : selectDensityCells(artifact.densityHeatmap.cells, MAX_DENSITY)),
    [artifact],
  );
  const densityCellSizeM = artifact?.densityHeatmap.cellSizeM ?? DEFAULT_DENSITY_CELL_SIZE_M;
  const conflicts = useMemo(
    () => (artifact === null ? [] : selectRouteConflicts(artifact.routeConflicts, MAX_CONFLICTS)),
    [artifact],
  );

  const showReplayLayers = artifact !== null && bounds !== null;
  const anyVisible = layers.flowPaths || layers.agentMotes || layers.densityHeatmap
    || layers.routeConflicts || layers.heritageBuffer || layers.lightingProbes;
  if (!anyVisible) return null;

  return (
    <group name="cockpit-scene-overlays">
      {showReplayLayers && (
        <>
          {layers.densityHeatmap && (
            <DensityPatches
              cells={densityCells}
              cellSizeM={densityCellSizeM}
              bounds={bounds}
              dimensions={dimensions}
            />
          )}
          {layers.flowPaths && (
            <FlowPaths trajectories={flowTrajectories} bounds={bounds} dimensions={dimensions} />
          )}
          {layers.agentMotes && (
            <AgentMotes trajectories={moteTrajectories} bounds={bounds} dimensions={dimensions} />
          )}
          {layers.routeConflicts && conflicts.map((conflict) => (
            <RouteConflictMarker
              key={conflict.id}
              conflict={conflict}
              bounds={bounds}
              dimensions={dimensions}
            />
          ))}
        </>
      )}
      {layers.heritageBuffer && <HeritageBufferBand dimensions={dimensions} />}
      {layers.lightingProbes && <LightingProbeGrid dimensions={dimensions} />}
    </group>
  );
}
