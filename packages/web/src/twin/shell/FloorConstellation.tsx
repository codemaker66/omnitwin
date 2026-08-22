import { Suspense, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";
import { E57_TO_THREE_QUAT, e57PointToThree } from "../twin-basis.js";
import { NAV_MARKER_FLOOR_DROP_M } from "../NavMarkers.js";
import { buildParallaxBatch, type ParallaxBatch } from "../ParallaxStage.js";
import {
  CONSTELLATION_HALO_MATERIAL,
  CONSTELLATION_OCCLUDER_MATERIAL,
  CONSTELLATION_OCCLUDER_RENDER_ORDER,
  CONSTELLATION_RENDER_ORDER,
  CONSTELLATION_WEIGHTED_MATERIAL,
  constellationNeedsReweight,
  constellationOccluderPosition,
  makeConstellationWeightBuffer,
  writeConstellationWeights,
} from "./constellation-depth.js";

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
//    chrome that is on screen the entire walk. So the constellation still does
//    not animate: nothing here moves on its own. The per-vertex weights change
//    only when the EYE moves, which is the visitor moving, and they are
//    rewritten inside the frame that movement already caused — no invalidate of
//    its own, no timer, no spring. That is also why there is still no
//    prefers-reduced-motion branch: a view-dependent shade is not motion any
//    more than a specular highlight is, and there is nothing here to reduce.
//
// 4. Depth. In walk mode NOTHING writes depth (PanoStage's sphere has
//    depthWrite off; ParallaxStage's mesh is mounted only mid-hop, which is
//    exactly when this component is unmounted), so the `depthTest` this
//    component has always carried had nothing to lose to and every mark in the
//    building drew through every wall. Measured: from scan_028, 37 of the 83
//    same-storey marks are behind geometry. Give this component
//    `occluderMeshUrl` and it mounts a depth-only prepass of the real building
//    — one extra draw, no colour — and the graph becomes genuinely occluded,
//    per pixel, including edges clipped exactly where they cross a wall.
//
//    THAT PROP IS NOT PASSED BY ANYTHING TODAY. The app's only mount site is
//    TwinViewer, which renders <FloorConstellation nodes edges currentId /> and
//    nothing else, so what ships right now is the unoccluded map — the same one
//    that shipped before any of this existed. The occlusion path is implemented,
//    tested and inert. What the parent has to do to fire it is one prop, spelled
//    out on `occluderMeshUrl` in FloorConstellationProps below. The mechanism,
//    the render-order stack and the falloff curve all live in
//    constellation-depth.
//
// Draw cost is a handful of calls regardless of node count: one lineSegments
// for every edge, one points for every mark, three rings for the halo, plus one
// batched depth pass when an occluder is supplied. Geometry is built once per
// input change in useMemo and disposed on unmount — R3F only auto-disposes what
// it created from a JSX intrinsic, and these buffers are handed in as props.
// renderOrder is set on each drawn object and never on a group: three does not
// propagate it, so a group carrying one is a comment that looks like code.
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
 * The graph's renderOrder must be ABOVE the panorama's, not below it.
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
 * bucket and win on distance. The graph sits above the pano AND above the
 * occluder that now runs between them — the numbers, and the reason the
 * occluder has to be sandwiched there rather than run as an opaque prepass,
 * are in constellation-depth.ts. The cost is unchanged: a mark coinciding with
 * a nav ring paints over it, which is fine, since a 7.5 cm dim mark inside a
 * 45 cm bright ring is not a legibility problem, whereas an invisible layer is.
 *
 * The occluder position is computed once — it is a pure join of twin-basis's
 * calibrated mesh offset with the drop, and both are module constants.
 */
const OCCLUDER_POSITION = constellationOccluderPosition();

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

/**
 * One layer's per-vertex falloff weights.
 *
 * The backing array is kept alongside its attribute deliberately. Reaching for
 * `attribute.array` instead means casting a TypedArray union back to
 * Float32Array on every frame — a cast that would be correct today and silently
 * wrong the day anyone switches the buffer's precision.
 */
export interface ConstellationWeights {
  readonly attribute: BufferAttribute;
  readonly data: Float32Array;
}

export interface ConstellationGeometries {
  readonly lines: BufferGeometry;
  readonly marks: BufferGeometry;
  /** Kept so the eye-moved rewrite never has to rebuild the plan to ask where
   *  a vertex is — the positions it needs are the ones already uploaded. */
  readonly linePositions: Float32Array;
  readonly markPositions: Float32Array;
  readonly lineWeights: ConstellationWeights;
  readonly markWeights: ConstellationWeights;
}

/**
 * A four-component vertex-colour attribute, opaque, ready to be rewritten.
 *
 * `new BufferAttribute(data, 4)` and NOT `new Float32BufferAttribute(data, 4)`,
 * which is not a spelling preference: the typed subclass runs
 * `new Float32Array(array)` on its argument, so it holds a COPY. Built that way
 * the weights would be written to an array the GPU never sees — the marks would
 * sit at their opaque starting values forever, and no error would be raised.
 * Caught by the test that asserts `attribute.array` IS `data`.
 */
function weightAttribute(vertexCount: number): ConstellationWeights {
  const data = makeConstellationWeightBuffer(vertexCount);
  const attribute = new BufferAttribute(data, 4);
  // Rewritten whenever the eye moves — rarely, but never once.
  attribute.setUsage(DynamicDrawUsage);
  return { attribute, data };
}

/**
 * Build both buffers for a plan. Imperatively constructed, therefore
 * imperatively disposed — see disposeConstellationGeometries.
 *
 * Each layer gets a position attribute and a four-component colour attribute.
 * The colours start opaque white and carry only alpha thereafter: the tint
 * belongs to the material, so a weight can quieten a mark but can never
 * recolour one into something that looks like a different kind of thing.
 */
export function buildConstellationGeometries(
  plan: FloorConstellationPlan,
): ConstellationGeometries {
  const linePositions = constellationLinePositions(plan.segments);
  const lineWeights = weightAttribute(plan.segments.length * 2);
  const lines = new BufferGeometry();
  lines.setAttribute("position", new BufferAttribute(linePositions, 3));
  lines.setAttribute("color", lineWeights.attribute);

  const markPositions = constellationMarkPositions(plan.points);
  const markWeights = weightAttribute(plan.points.length);
  const marks = new BufferGeometry();
  marks.setAttribute("position", new BufferAttribute(markPositions, 3));
  marks.setAttribute("color", markWeights.attribute);

  return { lines, marks, linePositions, markPositions, lineWeights, markWeights };
}

export function disposeConstellationGeometries(geometries: ConstellationGeometries): void {
  geometries.lines.dispose();
  geometries.marks.dispose();
}

/** The depth-only building, and the scene it was built from. */
export interface ConstellationOccluderResource {
  /** The `gltf.scene` this was batched from — the cache's identity. */
  readonly scene: Object3D;
  readonly material: MeshBasicMaterial;
  /** null when the GLB contained no drawable mesh at all. */
  readonly batch: ParallaxBatch | null;
}

/**
 * The one occluder the page keeps. Module scope, not component state, and that
 * is the fix for a measured stall rather than a premature optimisation.
 *
 * TwinViewer mounts this component as `{!hopping && <FloorConstellation …/>}`,
 * so it is unmounted and remounted on EVERY hop — that is the parent's mount
 * policy and this module cannot change it. Rebuilding the batch per mount was
 * measured on 2026-08-05 against the flagship bundle at 123–161 ms of main
 * thread (four consecutive runs over the real 144-primitive, 419,218-vertex
 * GLB), which lands as a visible hitch at the exact moment the visitor arrives
 * somewhere. Holding one batch across mounts makes the second and every later
 * arrival free.
 *
 * What it costs is one batch's vertex buffer — about 5 MB of VRAM — held for as
 * long as the page shows one building. That is bounded on purpose: a second
 * scene evicts and disposes the first, so this can never grow to two. A caller
 * leaving the twin entirely should call disposeConstellationOccluderCache.
 */
let occluderResource: ConstellationOccluderResource | null = null;

/**
 * Get the depth-only batch for a GLB scene, building it only the first time.
 *
 * Exported because it is the whole of the cache's contract and the only way to
 * pin it: that a repeat acquire does NOT rebuild is the entire point, and it is
 * invisible from the rendered tree.
 */
export function acquireConstellationOccluder(scene: Object3D): ConstellationOccluderResource {
  const held = occluderResource;
  if (held !== null && held.scene === scene) {
    return held;
  }
  // A different building arrived: the old one is now unreachable, so free it
  // before standing up its replacement rather than keeping both alive.
  disposeConstellationOccluderCache();
  const material = new MeshBasicMaterial({ ...CONSTELLATION_OCCLUDER_MATERIAL, side: DoubleSide });
  const resource: ConstellationOccluderResource = {
    scene,
    material,
    batch: buildParallaxBatch(scene, material),
  };
  occluderResource = resource;
  return resource;
}

/** Release the held occluder. Safe to call when nothing is held. */
export function disposeConstellationOccluderCache(): void {
  const held = occluderResource;
  if (held === null) {
    return;
  }
  occluderResource = null;
  held.batch?.mesh.dispose();
  held.material.dispose();
}

/**
 * The depth-only prepass: the real building, drawn in no colour at all, purely
 * so the graph has something to lose a depth test to.
 *
 * It reuses ParallaxStage's `buildParallaxBatch` rather than growing a second
 * way to turn this GLB into drawable geometry — one position-only BatchedMesh,
 * one draw call for all 144 primitives, materials and UVs stripped. The GLB
 * itself is free: `useGLTF(meshUrl)` hits the same `[GLTFLoader, url]` suspense
 * entry that ParallaxStage and preloadDollhouse already populate, so nothing is
 * fetched or decoded twice. (That shared entry is also a hazard this module
 * inherits rather than creates: the loader configuration is fixed by whichever
 * consumer mounts first, and DollhouseStage's is the only one that pins a
 * version-matched meshopt decoder. This call matches ParallaxStage's exactly, so
 * it changes nothing about who wins in walk mode.)
 *
 * The root carries E57_TO_THREE_QUAT so the mesh lands in the same three-space
 * as the poses (the contract DollhouseStage pins), and OCCLUDER_POSITION, which
 * lowers it clear of the graph's own floor datum.
 */
function ConstellationOccluder({ meshUrl }: { readonly meshUrl: string }): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const gltf = useGLTF(meshUrl);
  const resource = useMemo(() => acquireConstellationOccluder(gltf.scene), [gltf.scene]);
  // The mesh arrives asynchronously, long after the graph first painted; demand
  // mode needs telling that the frame it already drew is now wrong. Deliberately
  // NO disposal on unmount — see occluderResource for why the batch outlives
  // this component, and what bounds it.
  useEffect(() => {
    invalidate();
  }, [invalidate, resource]);

  if (resource.batch === null) {
    return null;
  }
  return (
    <group
      name="twin-constellation-occluder"
      quaternion={E57_TO_THREE_QUAT}
      position={OCCLUDER_POSITION}
    >
      <primitive object={resource.batch.mesh} renderOrder={CONSTELLATION_OCCLUDER_RENDER_ORDER} />
    </group>
  );
}

export interface FloorConstellationProps {
  readonly nodes: readonly TwinScanNode[];
  readonly edges: readonly TwinNavEdge[];
  /** The node underfoot — picks the storey and carries the halo. */
  readonly currentId: string;
  /** Master fade, 0–1. Defaults to fully drawn; 0 renders nothing at all. */
  readonly opacity?: number;
  /**
   * The co-registered building mesh, when the viewer can afford it — the same
   * URL ParallaxStage is given. Supplied, the graph is depth-tested against the
   * real building and stops showing through walls. Omitted, it draws exactly as
   * it always has: unoccluded, and honest about it. There is deliberately no
   * fallback that approximates occlusion from the nav graph or the room map —
   * a mark hidden by a rule rather than by a wall is a guess about the building,
   * and this viewer does not guess about the building.
   *
   * NOTHING PASSES THIS YET. TwinViewer, the app's only mount site, renders this
   * component with nodes/edges/currentId alone, so the occlusion path below is
   * dead in the shipped viewer. Turning it on is exactly one edit, in a file
   * this module does not own:
   *
   *     {!hopping && (
   *       <FloorConstellation
   *         nodes={manifest.nodes}
   *         edges={manifest.edges}
   *         currentId={walk.currentId}
   *         occluderMeshUrl={parallaxReady && meshUrl !== null ? meshUrl : undefined}
   *       />
   *     )}
   *
   * The `parallaxReady && meshUrl !== null` gate is not optional and not a
   * detail: it is the same device/asset gate TwinViewer already applies to
   * ParallaxStage, and it is what keeps a ~5 MB batch off machines that were
   * judged unable to afford the mesh at all. Passing a bare `meshUrl` would put
   * the building on the weakest devices in the fleet, which is the opposite of
   * what this prop is for.
   */
  readonly occluderMeshUrl?: string;
}

export function FloorConstellation({
  nodes,
  edges,
  currentId,
  opacity = 1,
  occluderMeshUrl,
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

  // `Math.min(Math.max(NaN, 0), 1)` is NaN, and `NaN <= 0` is false, so a
  // clamp alone would let a broken fade through to the materials as a NaN
  // opacity. A fade that is not a number draws nothing.
  const alpha = Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : 0;

  // The eye the weights were last written for, and a scratch tuple to test the
  // current one against. Separate on purpose: the scratch is mutated every
  // frame and allocates nothing, while the committed eye is only ever a fresh
  // copy — sharing one array would compare the camera against itself and the
  // weights would never be rewritten again.
  const writtenEyeRef = useRef<[number, number, number] | null>(null);
  const eyeRef = useRef<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    // A rebuilt buffer is opaque white; the next frame must rewrite it whether
    // or not the visitor has moved since.
    writtenEyeRef.current = null;
    invalidate();
  }, [invalidate, geometries, alpha]);

  useFrame(({ camera }) => {
    const eye = eyeRef.current;
    eye[0] = camera.position.x;
    eye[1] = camera.position.y;
    eye[2] = camera.position.z;
    if (!constellationNeedsReweight(writtenEyeRef.current, eye)) {
      return;
    }
    // No invalidate() here, and that is the point: this runs inside a frame the
    // camera's own movement already asked for, before the draw. Requesting
    // another would pin demand mode at 60 fps for the whole visit.
    writtenEyeRef.current = [eye[0], eye[1], eye[2]];
    writeConstellationWeights(geometries.markPositions, eye, geometries.markWeights.data);
    geometries.markWeights.attribute.needsUpdate = true;
    writeConstellationWeights(geometries.linePositions, eye, geometries.lineWeights.data);
    geometries.lineWeights.attribute.needsUpdate = true;
  });

  const current = plan.current;
  if (current === null || alpha <= 0) {
    return null;
  }

  return (
    <>
      {occluderMeshUrl !== undefined && (
        // Its own boundary, so a graph already on screen is never suspended
        // back off it while the building streams in behind.
        <Suspense fallback={null}>
          <ConstellationOccluder meshUrl={occluderMeshUrl} />
        </Suspense>
      )}
      {plan.segments.length > 0 && (
        <lineSegments
          name="twin-constellation-edges"
          geometry={geometries.lines}
          renderOrder={CONSTELLATION_RENDER_ORDER}
        >
          <lineBasicMaterial
            {...CONSTELLATION_WEIGHTED_MATERIAL}
            color={CONSTELLATION_COLOR}
            opacity={CONSTELLATION_EDGE_OPACITY * alpha}
          />
        </lineSegments>
      )}
      <points
        name="twin-constellation-marks"
        geometry={geometries.marks}
        renderOrder={CONSTELLATION_RENDER_ORDER}
      >
        <pointsMaterial
          {...CONSTELLATION_WEIGHTED_MATERIAL}
          color={CONSTELLATION_COLOR}
          size={CONSTELLATION_MARK_SIZE_M}
          sizeAttenuation
          opacity={CONSTELLATION_MARK_OPACITY * alpha}
        />
      </points>
      {/* "You are here" — concentric ground rings on the standing node. They
          are depth-tested like everything else, so a ring wide enough to reach
          a wall is cut by it instead of climbing it. */}
      <group
        name="twin-constellation-halo"
        position={[current.position[0], current.position[1], current.position[2]]}
      >
        {CONSTELLATION_HALO_RINGS.map((ring) => (
          <mesh
            key={ring.innerM}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={CONSTELLATION_RENDER_ORDER}
          >
            <ringGeometry args={[ring.innerM, ring.outerM, HALO_RING_SEGMENTS]} />
            <meshBasicMaterial
              {...CONSTELLATION_HALO_MATERIAL}
              color={CONSTELLATION_HALO_COLOR}
              opacity={ring.opacity * alpha}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}
