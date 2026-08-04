import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "../twin-basis.js";
import { NAV_MARKER_FLOOR_DROP_M } from "../NavMarkers.js";

// -----------------------------------------------------------------------------
// FloorConstellation — the nav graph, drawn on the ground the visitor is
// standing on.
//
// The design mockup asked for "glowing rings and a node graph lying on the
// floor". This is that, made honest: every line is a real edge of
// manifest.edges — a corridor the walk can actually traverse — and every mark
// is a real scan pose. Nothing here is decorative graph-shaped noise; if the
// forge drops an edge, the line disappears with it.
//
// THREE THINGS THAT ARE EASY TO GET WRONG, AND WHY THEY ARE DONE THIS WAY:
//
// 1. Height. Node poses are the SCANNER's position — a tripod head roughly
//    1.5 m above the boards. Drawing the graph at pose height would hang it at
//    eye level like a washing line. Every position therefore drops by
//    CONSTELLATION_FLOOR_DROP_M, which is derived from NavMarkers' floor datum
//    rather than re-guessed: NAV_MARKER_FLOOR_DROP_M is the only floor truth
//    the bundle has (there is no floor plane in the manifest and no mesh
//    raycast anywhere in the twin), so a second, disagreeing constant would
//    show up as two misaligned floors in the same frame. The drop is applied
//    PER NODE, so a multi-storey bundle needs no special case — and node.floor
//    is a storey BUCKET, never a height, so it is used for filtering only.
//
// 2. Basis. Positions go through e57PointToThree — the capture frame is Z-up
//    and three is Y-up ([x, z, −y]), and the sign flip on the E57 y axis is
//    what puts the graph on the floor with the correct handedness. Get it
//    wrong and the constellation is a mirror of the room the visitor is in.
//    The marks live in raw three space, deliberately OUTSIDE any group
//    carrying E57_TO_THREE_QUAT: pose-frame geometry never rides the mesh's
//    rotated group (the contract DollhouseStage pins).
//
// 3. Frames. The canvas is frameloop="demand". A continuously animating
//    overlay would either freeze (no invalidate) or pin the GPU at 60 fps for
//    the whole visit (unconditional invalidate), and neither is acceptable for
//    chrome that is on screen the entire walk. So the constellation does not
//    animate at all: it is a static draw that repaints only when its inputs
//    change. Because nothing moves, there is deliberately no
//    prefers-reduced-motion branch — there is no motion to reduce.
//
// Draw cost is a handful of calls regardless of node count: one lineSegments
// for every edge, one points for every mark, three rings for the halo.
// Geometry is built once per input change in useMemo and disposed on unmount —
// R3F only auto-disposes what it created from a JSX intrinsic, and these
// buffers are handed in as props.
//
// Intended for walk mode, where PanoStage's sphere writes no depth and the
// overlay is unoccluded. depthTest is left on so that if it is ever mounted
// over the dollhouse mesh it hides behind walls rather than floating through
// them; depthWrite is off everywhere so it never occludes the nav rings.
// -----------------------------------------------------------------------------

/**
 * Metres below a scan pose the constellation lies — fifteen millimetres under
 * the nav rings' plane so the rings always read on top of the graph they sit
 * in. The rings are the affordance; the graph is the map behind them.
 */
export const CONSTELLATION_FLOOR_DROP_M = NAV_MARKER_FLOOR_DROP_M + 0.015;

/**
 * Edge and mark colour — deliberately NOT NAV_MARKER_COLOR.
 *
 * The constellation is a map; the nav rings are an affordance. A mark is drawn
 * for every node on the storey, while NavMarkers renders a clickable ring only
 * for the two or three immediate neighbours — so sharing the rings' flame gold
 * would scatter dozens of inert look-alikes across the floor of a 149-node
 * capture, none of them with a hit target or a cursor. That is a dead button
 * arrived at through colour rather than through markup, and it costs the real
 * rings their meaning. This is the same gold walked well down in value: still
 * unmistakably the house palette, never mistakable for something to press.
 */
export const CONSTELLATION_COLOR = "#8a7346";
/** Halo colour — the brighter --gold-2, so "you are here" outranks the graph. */
export const CONSTELLATION_HALO_COLOR = "#f0c66b";

/** Resting opacities, all scaled by the caller's `opacity`. */
export const CONSTELLATION_EDGE_OPACITY = 0.3;
export const CONSTELLATION_MARK_OPACITY = 0.55;

/**
 * Mark size in metres. Points billboard toward the camera, which is a feature
 * here rather than a compromise: a flat 7 cm disc lying on the boards is
 * invisible at grazing eye-height angles, whereas a billboarded mark stays
 * legible all the way down a 21 m hall. Size attenuation keeps distance honest.
 */
export const CONSTELLATION_MARK_SIZE_M = 0.075;

/**
 * The "you are here" ground halo — concentric rings on the current node,
 * fading outward. The innermost sits clear of NAV_MARKER_OUTER_RADIUS (0.45 m)
 * so the halo never collides with the ring the visitor is standing in.
 */
export const CONSTELLATION_HALO_RINGS: readonly {
  readonly innerM: number;
  readonly outerM: number;
  readonly opacity: number;
}[] = [
  { innerM: 0.62, outerM: 0.655, opacity: 0.5 },
  { innerM: 1.18, outerM: 1.205, opacity: 0.3 },
  { innerM: 1.95, outerM: 1.97, opacity: 0.16 },
];

/** Ring tessellation — 96 segments stays smooth at a ~2 m radius. */
const HALO_RING_SEGMENTS = 96;

/**
 * Must be ABOVE the panorama's, not below it.
 *
 * The instinct is to sit at -1 so the graph reads as the layer underneath the
 * nav rings. That renders it invisible. PanoStage's sphere is BackSide,
 * `transparent: true` and `depthWrite: false` at renderOrder 0, and it wraps
 * the camera — so it covers the whole frame. three sorts the transparent pass
 * by renderOrder ASCENDING, so anything at -1 is drawn first and the pano then
 * paints straight over it; having set depthWrite:false, the graph leaves no
 * depth behind to defend itself. It was being drawn and erased every frame.
 *
 * The nav rings get away with renderOrder 0 only because they share the pano's
 * bucket and win on distance. This sits one above, which guarantees the graph
 * survives the pano. The cost is that a mark coinciding with a nav ring paints
 * over it — acceptable, since a 7.5 cm dim mark inside a 45 cm bright ring is
 * not a legibility problem, whereas an invisible layer is.
 */
const CONSTELLATION_RENDER_ORDER = 1;

/** One scan pose, resolved to its position on the floor in three space. */
export interface ConstellationPoint {
  readonly id: string;
  readonly position: readonly [number, number, number];
}

/** One walkable edge, resolved to both of its floor endpoints. */
export interface ConstellationSegment {
  readonly a: string;
  readonly b: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

/** Everything the constellation draws, computed without touching three. */
export interface FloorConstellationPlan {
  /** The storey being drawn; null when the current node is unknown. */
  readonly floor: number | null;
  readonly points: readonly ConstellationPoint[];
  readonly segments: readonly ConstellationSegment[];
  readonly current: ConstellationPoint | null;
}

const EMPTY_PLAN: FloorConstellationPlan = {
  floor: null,
  points: [],
  segments: [],
  current: null,
};

/**
 * A node's position on the floor beneath it, in three space. The pose is the
 * scanner's own height, so this is the only place the tripod is subtracted.
 */
export function nodeFloorPosition(node: TwinScanNode): [number, number, number] {
  const pose = e57PointToThree(node.pose.t);
  return [pose[0], pose[1] - CONSTELLATION_FLOOR_DROP_M, pose[2]];
}

/**
 * Resolve the manifest's nav graph into drawable floor geometry for the storey
 * the visitor is on.
 *
 * Deliberate omissions, each of which is a real condition in shipped bundles:
 * nodes on another storey are dropped (and their edges with them — a stair
 * edge would otherwise be drawn as a line straight through a floor slab), an
 * edge naming a node absent from `nodes` is skipped rather than throwing, a
 * self-edge is skipped, and a pair listed twice — or once in each direction —
 * is drawn once. An unknown `currentId` yields an empty plan: without a
 * current node there is no storey to choose, and guessing one is exactly the
 * kind of invention this viewer does not do.
 */
export function planFloorConstellation(
  nodes: readonly TwinScanNode[],
  edges: readonly TwinNavEdge[],
  currentId: string,
): FloorConstellationPlan {
  const currentNode = nodes.find((node) => node.id === currentId);
  if (currentNode === undefined) {
    return EMPTY_PLAN;
  }

  const floor = currentNode.floor;
  const onFloor = new Map<string, ConstellationPoint>();
  for (const node of nodes) {
    if (node.floor === floor) {
      onFloor.set(node.id, { id: node.id, position: nodeFloorPosition(node) });
    }
  }

  const segments: ConstellationSegment[] = [];
  const drawn = new Set<string>();
  for (const edge of edges) {
    const from = onFloor.get(edge.a);
    const to = onFloor.get(edge.b);
    if (from === undefined || to === undefined || from.id === to.id) {
      continue;
    }
    const key = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
    if (drawn.has(key)) {
      continue;
    }
    drawn.add(key);
    segments.push({ a: from.id, b: to.id, from: from.position, to: to.position });
  }

  return {
    floor,
    points: [...onFloor.values()],
    segments,
    current: onFloor.get(currentId) ?? null,
  };
}

/** Flat [x,y,z, x,y,z, …] pairs — two vertices per segment, for LineSegments. */
export function constellationLinePositions(
  segments: readonly ConstellationSegment[],
): Float32Array {
  const positions = new Float32Array(segments.length * 6);
  let cursor = 0;
  for (const segment of segments) {
    positions[cursor] = segment.from[0];
    positions[cursor + 1] = segment.from[1];
    positions[cursor + 2] = segment.from[2];
    positions[cursor + 3] = segment.to[0];
    positions[cursor + 4] = segment.to[1];
    positions[cursor + 5] = segment.to[2];
    cursor += 6;
  }
  return positions;
}

/** Flat [x,y,z, …] — one vertex per mark, for Points. */
export function constellationMarkPositions(
  points: readonly ConstellationPoint[],
): Float32Array {
  const positions = new Float32Array(points.length * 3);
  let cursor = 0;
  for (const point of points) {
    positions[cursor] = point.position[0];
    positions[cursor + 1] = point.position[1];
    positions[cursor + 2] = point.position[2];
    cursor += 3;
  }
  return positions;
}

export interface ConstellationGeometries {
  readonly lines: BufferGeometry;
  readonly marks: BufferGeometry;
}

/**
 * Build both buffers for a plan. Imperatively constructed, therefore
 * imperatively disposed — see disposeConstellationGeometries.
 */
export function buildConstellationGeometries(
  plan: FloorConstellationPlan,
): ConstellationGeometries {
  const lines = new BufferGeometry();
  lines.setAttribute(
    "position",
    new Float32BufferAttribute(constellationLinePositions(plan.segments), 3),
  );
  const marks = new BufferGeometry();
  marks.setAttribute(
    "position",
    new Float32BufferAttribute(constellationMarkPositions(plan.points), 3),
  );
  return { lines, marks };
}

export function disposeConstellationGeometries(geometries: ConstellationGeometries): void {
  geometries.lines.dispose();
  geometries.marks.dispose();
}

export interface FloorConstellationProps {
  readonly nodes: readonly TwinScanNode[];
  readonly edges: readonly TwinNavEdge[];
  /** The node underfoot — picks the storey and carries the halo. */
  readonly currentId: string;
  /** Master fade, 0–1. Defaults to fully drawn; 0 renders nothing at all. */
  readonly opacity?: number;
}

export function FloorConstellation({
  nodes,
  edges,
  currentId,
  opacity = 1,
}: FloorConstellationProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);

  const plan = useMemo(
    () => planFloorConstellation(nodes, edges, currentId),
    [nodes, edges, currentId],
  );
  const geometries = useMemo(() => buildConstellationGeometries(plan), [plan]);
  useEffect(
    () => () => {
      disposeConstellationGeometries(geometries);
    },
    [geometries],
  );

  const alpha = Math.min(Math.max(opacity, 0), 1);

  // Nothing here animates, so the only thing that can make demand mode paint
  // is an input change — ask for the frame this commit is about to need.
  useEffect(() => {
    invalidate();
  }, [invalidate, geometries, alpha]);

  const current = plan.current;
  if (current === null || alpha <= 0) {
    return null;
  }

  return (
    <group renderOrder={CONSTELLATION_RENDER_ORDER}>
      {plan.segments.length > 0 && (
        <lineSegments geometry={geometries.lines} renderOrder={CONSTELLATION_RENDER_ORDER}>
          <lineBasicMaterial
            color={CONSTELLATION_COLOR}
            transparent
            opacity={CONSTELLATION_EDGE_OPACITY * alpha}
            depthWrite={false}
          />
        </lineSegments>
      )}
      <points geometry={geometries.marks} renderOrder={CONSTELLATION_RENDER_ORDER}>
        <pointsMaterial
          color={CONSTELLATION_COLOR}
          size={CONSTELLATION_MARK_SIZE_M}
          sizeAttenuation
          transparent
          opacity={CONSTELLATION_MARK_OPACITY * alpha}
          depthWrite={false}
        />
      </points>
      {/* "You are here" — concentric ground rings on the standing node. */}
      <group position={[current.position[0], current.position[1], current.position[2]]}>
        {CONSTELLATION_HALO_RINGS.map((ring) => (
          <mesh
            key={ring.innerM}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={CONSTELLATION_RENDER_ORDER}
          >
            <ringGeometry args={[ring.innerM, ring.outerM, HALO_RING_SEGMENTS]} />
            <meshBasicMaterial
              color={CONSTELLATION_HALO_COLOR}
              transparent
              opacity={ring.opacity * alpha}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
