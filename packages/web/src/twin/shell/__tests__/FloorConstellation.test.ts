import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type BufferGeometry } from "three";
import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// FloorConstellation — the geometry contract, and the render contract.
//
// happy-dom has no WebGL, so the component's spatial argument is extracted into
// pure functions and pinned against known poses. Those pin the part that can be
// silently wrong on screen and still "work" — the E57→three basis, the tripod
// subtraction that puts the graph on the floor instead of at eye height, and the
// four ways a real manifest's edge list is dirtier than the happy path
// (cross-floor edges, dangling ids, self-edges, duplicates).
//
// The pure half is not enough on its own, and that gap is what the second half
// of this file closes. A constant can be right while the JSX that is supposed to
// use it is not: this suite proved CONSTELLATION_COLOR ≠ NAV_MARKER_COLOR, but
// nothing stopped the material from being handed the rings' gold directly, and
// nothing noticed whether the depth occluder was mounted, transformed, queued,
// or rebuilt from scratch on every hop. Those are now read back off the rendered
// tree and off the build count.
//
// @react-three/fiber and @react-three/drei are mocked wholesale
// (DollhouseStage.test.tsx pattern): three intrinsics render as inert custom
// elements whose array props serialise to attributes, and three itself is
// perfectly happy in Node. constellation-depth and ParallaxStage are mocked
// PARTIALLY — every real export passes through, with three functions wrapped so
// the frame loop's decisions and the occluder's build count become observable
// without the component growing a test-only seam.
// -----------------------------------------------------------------------------

const invalidate = vi.fn();

/** The only part of the R3F frame state this component reads. */
interface FrameCamera {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}
const frameCallbacks: ((state: { camera: FrameCamera }) => void)[] = [];

// useFrame is emulated rather than stubbed, because the difference is
// load-bearing here. R3F subscribes ONCE per mounted component and always calls
// the newest closure; a mock that simply pushes on every render accumulates one
// stale subscription per re-render, and those stale closures hold the previous
// render's geometry buffers. A rebuilt-plan test written against that mock
// measures the mock, not the component.
vi.mock("@react-three/fiber", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
      selector({ invalidate }),
    useFrame: (callback: (state: { camera: FrameCamera }) => void): void => {
      const latest = useRef(callback);
      latest.current = callback;
      useEffect(() => {
        const entry = (state: { camera: FrameCamera }): void => {
          latest.current(state);
        };
        frameCallbacks.push(entry);
        return () => {
          const index = frameCallbacks.indexOf(entry);
          if (index >= 0) frameCallbacks.splice(index, 1);
        };
      }, []);
    },
  };
});

/**
 * A real three scene standing in for the decoded GLB.
 *
 * Real, not a stub, because buildParallaxBatch is part of what is under test
 * here and it walks actual Mesh/BufferGeometry instances — a fake scene would
 * make the occluder tests pass by quietly returning null, which is precisely the
 * failure they exist to catch. BatchedMesh construction is pure CPU work, so
 * Node needs no WebGL to do it.
 */
function glbScene(primitives: number): Group {
  const scene = new Group();
  const material = new MeshBasicMaterial();
  for (let index = 0; index < primitives; index += 1) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.position.set(index * 2, 0, 0);
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

const GLB_SCENE = glbScene(3);
/** Swapped by the tests that need a second building, or an empty one. */
let gltfScene: Group = GLB_SCENE;
const useGLTFMock = vi.fn((_url: string) => ({ scene: gltfScene }));
vi.mock("@react-three/drei", () => ({ useGLTF: useGLTFMock }));

/** One recorded reweight decision: the values AND the array identities. */
interface ReweightCall {
  readonly previous: readonly number[] | null;
  readonly previousRef: readonly number[] | null;
  readonly eye: readonly number[];
  readonly eyeRef: readonly number[];
}
const reweightCalls: ReweightCall[] = [];
interface WriteCall {
  readonly positions: Float32Array;
  readonly out: Float32Array;
}
const writeCalls: WriteCall[] = [];

/**
 * Every flag read out of a shared material-policy constant while rendering.
 *
 * This exists because the flags are booleans and booleans are invisible from
 * here: React omits a boolean-valued unknown attribute entirely rather than
 * serialising it, so `vertexColors` cannot be read back off the rendered
 * element. Recording the READ instead pins the claim that actually matters —
 * that the drawn materials are configured from constellation-depth's single
 * policy rather than from flags written out again at the JSX.
 */
const materialFlagReads: string[] = [];

// Snapshots are taken on the way in because the frame loop mutates its scratch
// tuple in place — holding the reference alone would show every recorded call
// the LAST camera position, and the "is the committed eye a copy?" assertion
// needs the identity as well as the values.
vi.mock("../constellation-depth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../constellation-depth.js")>();
  const recordReads = <T extends object>(policy: T, label: string): T =>
    new Proxy(policy, {
      get(target, key, receiver): unknown {
        if (typeof key === "string") {
          materialFlagReads.push(`${label}.${key}`);
        }
        return Reflect.get(target, key, receiver);
      },
    });
  return {
    ...actual,
    CONSTELLATION_WEIGHTED_MATERIAL: recordReads(
      actual.CONSTELLATION_WEIGHTED_MATERIAL,
      "weighted",
    ),
    CONSTELLATION_HALO_MATERIAL: recordReads(actual.CONSTELLATION_HALO_MATERIAL, "halo"),
    constellationNeedsReweight: (
      previous: readonly [number, number, number] | null,
      eye: readonly [number, number, number],
      epsilonM?: number,
    ): boolean => {
      reweightCalls.push({
        previous: previous === null ? null : [...previous],
        previousRef: previous,
        eye: [...eye],
        eyeRef: eye,
      });
      return actual.constellationNeedsReweight(previous, eye, epsilonM);
    },
    writeConstellationWeights: (
      positions: Float32Array,
      eye: readonly [number, number, number],
      out: Float32Array,
      falloff?: Parameters<typeof actual.writeConstellationWeights>[3],
    ): Float32Array => {
      const written = actual.writeConstellationWeights(positions, eye, out, falloff);
      writeCalls.push({ positions, out });
      return written;
    },
  };
});

const buildBatchSpy = vi.fn();
vi.mock("../../ParallaxStage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ParallaxStage.js")>();
  return {
    ...actual,
    buildParallaxBatch: (
      ...args: Parameters<typeof actual.buildParallaxBatch>
    ): ReturnType<typeof actual.buildParallaxBatch> => {
      buildBatchSpy(...args);
      return actual.buildParallaxBatch(...args);
    },
  };
});

const {
  CONSTELLATION_COLOR,
  CONSTELLATION_EDGE_OPACITY,
  CONSTELLATION_FLOOR_DROP_M,
  CONSTELLATION_HALO_COLOR,
  CONSTELLATION_HALO_RINGS,
  CONSTELLATION_MARK_OPACITY,
  FloorConstellation,
  acquireConstellationOccluder,
  buildConstellationGeometries,
  constellationLinePositions,
  constellationMarkPositions,
  disposeConstellationGeometries,
  disposeConstellationOccluderCache,
  nodeFloorPosition,
  planFloorConstellation,
} = await import("../FloorConstellation.js");

const {
  CONSTELLATION_OCCLUDER_RENDER_ORDER,
  CONSTELLATION_RENDER_ORDER,
  CONSTELLATION_REWEIGHT_EPSILON_M,
  constellationOccluderPosition,
} = await import("../constellation-depth.js");

const { E57_TO_THREE_QUAT } = await import("../../twin-basis.js");

const { NAV_MARKER_COLOR, NAV_MARKER_FLOOR_DROP_M, NAV_MARKER_OUTER_RADIUS } = await import(
  "../../NavMarkers.js"
);
const { e57PointToThree } = await import("../../twin-basis.js");
const { TWIN_FIXTURE_MANIFEST } = await import("../../__fixtures__/twin-fixture.js");

/** Synthetic pose: E57 metres, Z-up, level tripod at the usual 1.5 m head. */
function node(
  id: string,
  x: number,
  y: number,
  options: { readonly z?: number; readonly floor?: number } = {},
): TwinScanNode {
  return {
    id,
    index: Number(id.slice(-3)),
    pose: { q: [1, 0, 0, 0], t: [x, y, options.z ?? 1.5] },
    floor: options.floor ?? 0,
    roomSlug: null,
  };
}

function edge(a: string, b: string, distanceM = 2.5): TwinNavEdge {
  return { a, b, distanceM };
}

/** One vertex of a position attribute — getX/getY/getZ are always numbers. */
function vertex(geometry: BufferGeometry, index: number): [number, number, number] {
  const attribute = geometry.getAttribute("position");
  return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
}

/**
 * A position as it survives a Float32Array round trip. GPU buffers are 32-bit,
 * so 0.135 does not come back out as 0.135 — comparing a read-back vertex
 * against the float64 plan without this is a guaranteed false failure.
 */
function f32(position: readonly [number, number, number]): [number, number, number] {
  return [Math.fround(position[0]), Math.fround(position[1]), Math.fround(position[2])];
}

describe("nodeFloorPosition", () => {
  it("puts the mark on the floor, not at the scanner's eye height", () => {
    const scan = node("scan_000", 3, 4);
    const [x, y, z] = nodeFloorPosition(scan);

    // Basis: E57 (Z-up) → three (Y-up) is [x, z, −y]. The sign flip on the
    // E57 y axis is what keeps the graph from mirroring the room.
    expect(e57PointToThree(scan.pose.t)).toEqual([3, 1.5, -4]);
    expect(x).toBe(3);
    expect(z).toBe(-4);

    // Height: the tripod head is subtracted, so the mark lands just above the
    // boards — a whole scanner's worth below the pose.
    expect(y).toBe(scan.pose.t[2] - CONSTELLATION_FLOOR_DROP_M);
    expect(y).toBeCloseTo(0.135, 6);
    expect(scan.pose.t[2] - y).toBeGreaterThan(1.3);
  });

  it("derives each storey's floor from that node's own pose", () => {
    // A first-floor scan stands 5.6 m up in E57 z; its floor must follow it,
    // not the ground storey's. node.floor is a bucket and never a height.
    const ground = node("scan_000", 0, 0);
    const upstairs = node("scan_100", 0, 0, { z: 5.6, floor: 1 });

    expect(nodeFloorPosition(ground)[1]).toBeCloseTo(1.5 - CONSTELLATION_FLOOR_DROP_M, 6);
    expect(nodeFloorPosition(upstairs)[1]).toBeCloseTo(5.6 - CONSTELLATION_FLOOR_DROP_M, 6);
    expect(nodeFloorPosition(upstairs)[1] - nodeFloorPosition(ground)[1]).toBeCloseTo(4.1, 6);
  });

  it("lies just under the nav rings' plane, sharing their floor datum", () => {
    // One floor truth, not two: the drop is derived from NavMarkers' constant,
    // and sits a hair below it so the rings always read on top of the graph.
    expect(CONSTELLATION_FLOOR_DROP_M).toBeGreaterThan(NAV_MARKER_FLOOR_DROP_M);
    expect(CONSTELLATION_FLOOR_DROP_M - NAV_MARKER_FLOOR_DROP_M).toBeLessThan(0.05);
  });
});

describe("planFloorConstellation", () => {
  it("draws the fixture bundle's real T-shaped nav graph", () => {
    const plan = planFloorConstellation(
      TWIN_FIXTURE_MANIFEST.nodes,
      TWIN_FIXTURE_MANIFEST.edges,
      "scan_001",
    );

    expect(plan.floor).toBe(0);
    expect(plan.points.map((point) => point.id)).toEqual([
      "scan_000",
      "scan_001",
      "scan_002",
      "scan_003",
    ]);
    // Edges connect the right pairs — the literal routes the walk can take.
    expect(plan.segments.map((segment) => [segment.a, segment.b])).toEqual([
      ["scan_000", "scan_001"],
      ["scan_001", "scan_002"],
      ["scan_001", "scan_003"],
    ]);
    expect(plan.current?.id).toBe("scan_001");
  });

  it("resolves each segment's endpoints to those nodes' floor positions", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2.5, 0)];
    const plan = planFloorConstellation(nodes, [edge("scan_000", "scan_001")], "scan_000");

    expect(plan.segments).toHaveLength(1);
    const [segment] = plan.segments;
    expect(segment?.from).toEqual(nodeFloorPosition(nodes[0]!));
    expect(segment?.to).toEqual(nodeFloorPosition(nodes[1]!));
    // Both ends on the same plane: a nav edge is a floor line, never a ramp.
    expect(segment?.from[1]).toBe(segment?.to[1]);
    expect(plan.current?.position).toEqual(nodeFloorPosition(nodes[0]!));
  });

  it("draws only the current node's storey, and no edge that leaves it", () => {
    const nodes = [
      node("scan_000", 0, 0),
      node("scan_001", 2.5, 0),
      node("scan_100", 0, 0, { z: 5.6, floor: 1 }),
      node("scan_101", 2.5, 0, { z: 5.6, floor: 1 }),
    ];
    const edges = [
      edge("scan_000", "scan_001"),
      // The stair: it must never be drawn as a line through the slab.
      edge("scan_001", "scan_101", 4.2),
      edge("scan_100", "scan_101"),
    ];

    const ground = planFloorConstellation(nodes, edges, "scan_000");
    expect(ground.floor).toBe(0);
    expect(ground.points.map((point) => point.id)).toEqual(["scan_000", "scan_001"]);
    expect(ground.segments.map((segment) => [segment.a, segment.b])).toEqual([
      ["scan_000", "scan_001"],
    ]);

    const upstairs = planFloorConstellation(nodes, edges, "scan_101");
    expect(upstairs.floor).toBe(1);
    expect(upstairs.points.map((point) => point.id)).toEqual(["scan_100", "scan_101"]);
    expect(upstairs.segments.map((segment) => [segment.a, segment.b])).toEqual([
      ["scan_100", "scan_101"],
    ]);
  });

  it("skips an edge naming a node the bundle does not contain, rather than throwing", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2.5, 0)];
    const edges = [
      edge("scan_000", "scan_999"),
      edge("scan_888", "scan_001"),
      edge("scan_000", "scan_001"),
    ];

    const plan = planFloorConstellation(nodes, edges, "scan_000");
    expect(plan.segments.map((segment) => [segment.a, segment.b])).toEqual([
      ["scan_000", "scan_001"],
    ]);
  });

  it("drops self-edges and draws a repeated or reversed pair only once", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2.5, 0)];
    const edges = [
      edge("scan_000", "scan_000", 0.1),
      edge("scan_000", "scan_001"),
      edge("scan_001", "scan_000"),
      edge("scan_000", "scan_001"),
    ];

    const plan = planFloorConstellation(nodes, edges, "scan_000");
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]?.a).toBe("scan_000");
    expect(plan.segments[0]?.b).toBe("scan_001");
  });

  it("draws nothing when the current node is unknown — no storey may be guessed", () => {
    const plan = planFloorConstellation(
      [node("scan_000", 0, 0)],
      [edge("scan_000", "scan_001")],
      "scan_404",
    );

    expect(plan).toEqual({ floor: null, points: [], segments: [], current: null });
  });

  it("survives an empty bundle without inventing a graph", () => {
    const plan = planFloorConstellation([], [], "scan_000");
    expect(plan.current).toBeNull();
    expect(plan.segments).toEqual([]);
  });
});

describe("constellation buffers", () => {
  it("lays each segment out as two vertices, in order", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2.5, -1)];
    const plan = planFloorConstellation(nodes, [edge("scan_000", "scan_001")], "scan_000");
    const positions = Array.from(constellationLinePositions(plan.segments));

    const from = f32(nodeFloorPosition(nodes[0]!));
    const to = f32(nodeFloorPosition(nodes[1]!));
    expect(positions).toHaveLength(6);
    expect(positions).toEqual([from[0], from[1], from[2], to[0], to[1], to[2]]);
  });

  it("lays each mark out as one vertex on the floor plane", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2.5, -1)];
    const plan = planFloorConstellation(nodes, [], "scan_000");
    const positions = Array.from(constellationMarkPositions(plan.points));

    expect(positions).toHaveLength(6);
    expect(positions[1]).toBeCloseTo(1.5 - CONSTELLATION_FLOOR_DROP_M, 6);
    expect(positions[4]).toBeCloseTo(1.5 - CONSTELLATION_FLOOR_DROP_M, 6);
  });

  it("builds three-component position attributes for lines and marks alike", () => {
    const plan = planFloorConstellation(
      TWIN_FIXTURE_MANIFEST.nodes,
      TWIN_FIXTURE_MANIFEST.edges,
      "scan_001",
    );
    const geometries = buildConstellationGeometries(plan);

    const lines = geometries.lines.getAttribute("position");
    const marks = geometries.marks.getAttribute("position");
    expect(lines.itemSize).toBe(3);
    expect(marks.itemSize).toBe(3);
    // Two vertices per edge, one per node.
    expect(lines.count).toBe(plan.segments.length * 2);
    expect(marks.count).toBe(plan.points.length);
    expect(vertex(geometries.lines, 0)).toEqual(f32(plan.segments[0]!.from));
    expect(vertex(geometries.lines, 1)).toEqual(f32(plan.segments[0]!.to));
    expect(vertex(geometries.marks, 0)).toEqual(f32(plan.points[0]!.position));

    disposeConstellationGeometries(geometries);
  });

  it("builds empty buffers for an empty plan without throwing", () => {
    const geometries = buildConstellationGeometries(
      planFloorConstellation([], [], "scan_000"),
    );

    expect(geometries.lines.getAttribute("position").count).toBe(0);
    expect(geometries.marks.getAttribute("position").count).toBe(0);
    disposeConstellationGeometries(geometries);
  });

  it("disposes both buffers — R3F only auto-disposes what it created itself", () => {
    const geometries = buildConstellationGeometries(
      planFloorConstellation([node("scan_000", 0, 0)], [], "scan_000"),
    );
    const lines = vi.spyOn(geometries.lines, "dispose");
    const marks = vi.spyOn(geometries.marks, "dispose");

    disposeConstellationGeometries(geometries);

    expect(lines).toHaveBeenCalledTimes(1);
    expect(marks).toHaveBeenCalledTimes(1);
  });
});

describe("the constellation is a map, not an affordance", () => {
  /** Rec. 709 relative luminance of a #rrggbb string, 0–255. */
  function luminance(hex: string): number {
    const channel = (offset: number): number =>
      Number.parseInt(hex.slice(1 + offset * 2, 3 + offset * 2), 16);
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  }

  it("never wears the nav rings' colour", () => {
    // A mark is drawn for every node on the storey; NavMarkers rings only the
    // two or three you can actually click. Sharing the rings' flame gold would
    // scatter dozens of inert look-alikes with no hit target and no cursor —
    // a dead button arrived at through colour rather than through markup.
    expect(CONSTELLATION_COLOR).not.toBe(NAV_MARKER_COLOR);
  });

  it("is the same gold walked down in value, not a different hue", () => {
    // Materially dimmer, so the affordance always outranks the map...
    expect(luminance(CONSTELLATION_COLOR)).toBeLessThan(luminance(NAV_MARKER_COLOR) * 0.8);
    // ...but still the house palette: warm, with red above green above blue.
    const [red, green, blue] = [1, 3, 5].map((offset) =>
      Number.parseInt(CONSTELLATION_COLOR.slice(offset, offset + 2), 16),
    );
    expect(red).toBeGreaterThan(green ?? 0);
    expect(green).toBeGreaterThan(blue ?? 0);
  });
});

describe("the per-vertex falloff buffers", () => {
  it("gives both layers a four-component weight attribute, one entry per vertex", () => {
    const plan = planFloorConstellation(
      TWIN_FIXTURE_MANIFEST.nodes,
      TWIN_FIXTURE_MANIFEST.edges,
      "scan_001",
    );
    const geometries = buildConstellationGeometries(plan);

    // itemSize 4 is the whole feature: three compiles USE_COLOR_ALPHA only at
    // four components, and at three the per-mark fade is silently dropped.
    const marks = geometries.marks.getAttribute("color");
    const lines = geometries.lines.getAttribute("color");
    expect(marks.itemSize).toBe(4);
    expect(lines.itemSize).toBe(4);
    expect(marks.count).toBe(plan.points.length);
    expect(lines.count).toBe(plan.segments.length * 2);

    disposeConstellationGeometries(geometries);
  });

  it("hands back the backing arrays, so the frame loop needs no cast off the attribute", () => {
    const plan = planFloorConstellation(
      [node("scan_000", 0, 0), node("scan_001", 2.5, 0)],
      [edge("scan_000", "scan_001")],
      "scan_000",
    );
    const geometries = buildConstellationGeometries(plan);

    expect(geometries.markWeights.attribute.array).toBe(geometries.markWeights.data);
    expect(geometries.lineWeights.attribute.array).toBe(geometries.lineWeights.data);
    expect(geometries.markWeights.data).toHaveLength(plan.points.length * 4);
    expect(geometries.lineWeights.data).toHaveLength(plan.segments.length * 2 * 4);
    // The positions travel with the buffers too: the weights are recomputed
    // from them every time the eye moves, and re-deriving them per frame would
    // rebuild the whole plan to answer a question already answered.
    expect(Array.from(geometries.markPositions)).toEqual(
      Array.from(constellationMarkPositions(plan.points)),
    );
    expect(Array.from(geometries.linePositions)).toEqual(
      Array.from(constellationLinePositions(plan.segments)),
    );

    disposeConstellationGeometries(geometries);
  });

  it("starts every vertex opaque — an unwritten buffer must look like the old graph", () => {
    const geometries = buildConstellationGeometries(
      planFloorConstellation([node("scan_000", 0, 0)], [], "scan_000"),
    );

    expect(Array.from(geometries.markWeights.data)).toEqual([1, 1, 1, 1]);

    disposeConstellationGeometries(geometries);
  });
});

describe("the you-are-here halo", () => {
  it("rings outward, fading, and never collides with the nav ring underfoot", () => {
    let previousOuter = NAV_MARKER_OUTER_RADIUS;
    let previousOpacity = 1;
    for (const ring of CONSTELLATION_HALO_RINGS) {
      expect(ring.innerM).toBeGreaterThan(previousOuter);
      expect(ring.outerM).toBeGreaterThan(ring.innerM);
      expect(ring.opacity).toBeLessThan(previousOpacity);
      previousOuter = ring.outerM;
      previousOpacity = ring.opacity;
    }
    expect(CONSTELLATION_HALO_RINGS.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// The render contract. Everything above this line would still pass if the
// component rendered nothing at all.
// =============================================================================

const MESH_URL = "/twin/trades-hall/mesh/dollhouse.glb";

/** Three poses in a line: underfoot, four metres on, and across the hall. */
const WALK_NODES: readonly TwinScanNode[] = [
  node("scan_000", 0, 0),
  node("scan_001", 4, 0),
  node("scan_002", 22, 0),
];
const WALK_EDGES: readonly TwinNavEdge[] = [
  edge("scan_000", "scan_001", 4),
  edge("scan_001", "scan_002", 18),
];

interface MountOptions {
  readonly currentId?: string;
  readonly opacity?: number;
  readonly occluderMeshUrl?: string;
}

function mount(options: MountOptions = {}): ReturnType<typeof render> {
  return render(
    createElement(FloorConstellation, {
      nodes: WALK_NODES,
      edges: WALK_EDGES,
      currentId: options.currentId ?? "scan_000",
      ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
      ...(options.occluderMeshUrl === undefined
        ? {}
        : { occluderMeshUrl: options.occluderMeshUrl }),
    }),
  );
}

/** Drive one R3F frame with the eye at a given three-space position. */
function frame(x: number, y: number, z: number): void {
  for (const callback of frameCallbacks) {
    callback({ camera: { position: { x, y, z } } });
  }
}

/** The weight buffer written for a layer of `vertexCount` vertices. */
function writeFor(vertexCount: number): WriteCall | undefined {
  return writeCalls.find((call) => call.positions.length === vertexCount * 3);
}

beforeEach(() => {
  gltfScene = GLB_SCENE;
  frameCallbacks.length = 0;
  reweightCalls.length = 0;
  writeCalls.length = 0;
  materialFlagReads.length = 0;
  invalidate.mockClear();
  useGLTFMock.mockClear();
  buildBatchSpy.mockClear();
});

afterEach(() => {
  cleanup();
  // The occluder is deliberately cached at module scope across mounts, so it
  // must be released between tests or the build-count assertions measure the
  // previous test's warm cache instead of their own.
  disposeConstellationOccluderCache();
});

describe("the rendered layers", () => {
  it("draws marks, edges and the halo, all queued above the panorama", () => {
    const { container } = mount();

    const marks = container.querySelector('points[name="twin-constellation-marks"]');
    const edges = container.querySelector('linesegments[name="twin-constellation-edges"]');
    const halo = container.querySelector('group[name="twin-constellation-halo"]');
    expect(marks).not.toBeNull();
    expect(edges).not.toBeNull();
    expect(halo).not.toBeNull();

    // renderOrder is set on each drawn object, never on a group: three does not
    // propagate it, so a group carrying one is a comment shaped like code.
    const order = String(CONSTELLATION_RENDER_ORDER);
    expect(marks?.getAttribute("renderorder")).toBe(order);
    expect(edges?.getAttribute("renderorder")).toBe(order);
    for (const ring of halo?.querySelectorAll("mesh") ?? []) {
      expect(ring.getAttribute("renderorder")).toBe(order);
    }
  });

  it("stands the halo on the current node's own floor position", () => {
    const { container } = mount({ currentId: "scan_001" });
    const halo = container.querySelector('group[name="twin-constellation-halo"]');
    expect(halo?.getAttribute("position")).toBe(nodeFloorPosition(WALK_NODES[1]!).join(","));
  });

  it("gives the halo one ring per pinned radius, at that ring's opacity", () => {
    const { container } = mount();
    const rings = [
      ...(container
        .querySelector('group[name="twin-constellation-halo"]')
        ?.querySelectorAll("ringgeometry") ?? []),
    ];
    expect(rings).toHaveLength(CONSTELLATION_HALO_RINGS.length);
    for (const [index, ring] of CONSTELLATION_HALO_RINGS.entries()) {
      expect(rings[index]?.getAttribute("args")?.startsWith(`${String(ring.innerM)},`)).toBe(true);
    }
  });

  it("draws nothing when the current node is unknown — no storey may be guessed", () => {
    const { container } = mount({ currentId: "scan_404" });
    expect(container.querySelector("points")).toBeNull();
    expect(container.querySelector('group[name="twin-constellation-halo"]')).toBeNull();
  });

  it("draws nothing once the master fade reaches zero, or stops being a number", () => {
    expect(mount({ opacity: 0 }).container.querySelector("points")).toBeNull();
    cleanup();
    // A NaN fade must not reach the materials: `Math.min(Math.max(NaN,0),1)` is
    // NaN and `NaN <= 0` is false, so a clamp on its own would let it through
    // and hand the GPU an undefined alpha.
    expect(mount({ opacity: Number.NaN }).container.querySelector("points")).toBeNull();
  });

  it("scales every layer by the master fade", () => {
    const { container } = mount({ opacity: 0.5 });
    expect(container.querySelector("pointsmaterial")?.getAttribute("opacity")).toBe(
      String(CONSTELLATION_MARK_OPACITY * 0.5),
    );
    expect(container.querySelector("linebasicmaterial")?.getAttribute("opacity")).toBe(
      String(CONSTELLATION_EDGE_OPACITY * 0.5),
    );
    expect(
      container
        .querySelector('group[name="twin-constellation-halo"]')
        ?.querySelector("meshbasicmaterial")
        ?.getAttribute("opacity"),
    ).toBe(String((CONSTELLATION_HALO_RINGS[0]?.opacity ?? 0) * 0.5));
  });

  it("hands the drawn materials the map's colour, and never the rings'", () => {
    // The companion to the constant test below. Proving CONSTELLATION_COLOR is
    // not NAV_MARKER_COLOR says nothing about what the JSX actually passes: a
    // material given the rings' gold directly would leave that test green and
    // still scatter dozens of inert look-alikes across the floor. This reads the
    // colour back off every material the component actually renders.
    const { container } = mount();
    expect(container.querySelector("pointsmaterial")?.getAttribute("color")).toBe(
      CONSTELLATION_COLOR,
    );
    expect(container.querySelector("linebasicmaterial")?.getAttribute("color")).toBe(
      CONSTELLATION_COLOR,
    );
    for (const material of container.querySelectorAll(
      "pointsmaterial, linebasicmaterial, meshbasicmaterial",
    )) {
      expect(material.getAttribute("color")).not.toBe(NAV_MARKER_COLOR);
    }
    // The halo is allowed to be brighter than the map, because it marks one
    // point rather than dozens — but it is still not the rings' colour.
    expect(
      container
        .querySelector('group[name="twin-constellation-halo"]')
        ?.querySelector("meshbasicmaterial")
        ?.getAttribute("color"),
    ).toBe(CONSTELLATION_HALO_COLOR);
  });

  it("configures the drawn materials from the shared depth policy, never from inline flags", () => {
    // three compiles USE_COLOR_ALPHA only when the MATERIAL asks for vertex
    // colours and the attribute has four components. The buffer half is pinned
    // in constellation-depth.test.ts; this is the other half. Restating the
    // flags at the JSX instead of spreading the policy is how the two halves
    // drift apart, and the drift is silent — every mark simply draws at full
    // strength with no error anywhere.
    const { container } = mount();

    // Counted, not merely present. "Was this flag read at all" is satisfied by
    // ONE of the two weighted layers spreading the policy while the other
    // restates it inline — which is exactly the drift being guarded against, and
    // it leaves half the graph un-faded.
    const weightedLayers = container.querySelectorAll(
      "pointsmaterial, linebasicmaterial",
    ).length;
    expect(weightedLayers).toBe(2);
    for (const flag of ["vertexColors", "transparent", "depthTest", "depthWrite"]) {
      expect(materialFlagReads.filter((read) => read === `weighted.${flag}`)).toHaveLength(
        weightedLayers,
      );
    }
    expect(materialFlagReads.filter((read) => read === "halo.depthTest")).toHaveLength(
      CONSTELLATION_HALO_RINGS.length,
    );
    // The halo has no colour attribute, so it must never be handed vertex
    // colours: three would read the disabled attribute's default — black — and
    // paint three dark rings on the floorboards instead of gold ones.
    expect(materialFlagReads).not.toContain("halo.vertexColors");
  });

  it("omits the edge layer entirely when the storey has no edges to draw", () => {
    render(
      createElement(FloorConstellation, {
        nodes: WALK_NODES,
        edges: [],
        currentId: "scan_000",
      }),
    );
    expect(document.querySelector("linesegments")).toBeNull();
    expect(document.querySelector('points[name="twin-constellation-marks"]')).not.toBeNull();
  });
});

describe("the depth occluder", () => {
  it("mounts no prepass, and loads no building, unless one is supplied", () => {
    // The shipped configuration: TwinViewer passes nodes/edges/currentId only.
    const { container } = mount();
    expect(container.querySelector('group[name="twin-constellation-occluder"]')).toBeNull();
    expect(useGLTFMock).not.toHaveBeenCalled();
    expect(buildBatchSpy).not.toHaveBeenCalled();
  });

  it("mounts the real building, rotated into the pose frame and lowered clear of it", () => {
    const { container } = mount({ occluderMeshUrl: MESH_URL });

    expect(useGLTFMock).toHaveBeenCalledWith(MESH_URL);
    const occluder = container.querySelector('group[name="twin-constellation-occluder"]');
    expect(occluder).not.toBeNull();
    // E57 Z-up → three Y-up. Without this the occluder clips the graph against
    // a building lying on its side, which hides the wrong marks rather than none.
    expect(occluder?.getAttribute("quaternion")).toBe(E57_TO_THREE_QUAT.join(","));
    // Lowered from the calibrated mesh offset, so the mesh floor is provably
    // below the graph's pose-derived floor at every pose in the capture.
    expect(occluder?.getAttribute("position")).toBe(constellationOccluderPosition().join(","));
    expect(occluder?.querySelector("primitive")?.getAttribute("renderorder")).toBe(
      String(CONSTELLATION_OCCLUDER_RENDER_ORDER),
    );
  });

  it("queues the prepass after the panorama and before the graph", () => {
    const { container } = mount({ occluderMeshUrl: MESH_URL });
    const occluder = Number(
      container
        .querySelector('group[name="twin-constellation-occluder"] primitive')
        ?.getAttribute("renderorder"),
    );
    const marks = Number(
      container.querySelector('points[name="twin-constellation-marks"]')?.getAttribute(
        "renderorder",
      ),
    );
    // Above PanoStage's two spheres (0 and 1), or the prepass erases the
    // photograph; below the graph, or the graph is never tested against it.
    expect(occluder).toBeGreaterThan(1);
    expect(marks).toBeGreaterThan(occluder);
  });

  it("builds the batch once and reuses it across hops", () => {
    // TwinViewer mounts this as `{!hopping && <FloorConstellation …/>}`, so the
    // component is unmounted and remounted on every hop. Rebuilding the batch
    // per mount measured 123–161 ms of main thread against the real
    // 419,218-vertex bundle — a hitch at the exact moment the visitor arrives.
    const first = mount({ occluderMeshUrl: MESH_URL });
    expect(buildBatchSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = mount({ occluderMeshUrl: MESH_URL });
    expect(buildBatchSpy).toHaveBeenCalledTimes(1);
    expect(
      second.container.querySelector('group[name="twin-constellation-occluder"]'),
    ).not.toBeNull();
  });

  it("keeps the held batch alive through an unmount, and disposes it on demand", () => {
    const held = acquireConstellationOccluder(GLB_SCENE);
    expect(held.batch).not.toBeNull();
    const disposed = vi.spyOn(held.batch!.mesh, "dispose");
    const materialDisposed = vi.spyOn(held.material, "dispose");

    mount({ occluderMeshUrl: MESH_URL }).unmount();
    expect(disposed).not.toHaveBeenCalled();

    disposeConstellationOccluderCache();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
  });

  it("evicts and frees the previous building when a different one arrives", () => {
    // The cache is bounded at one entry on purpose: two live batches would be
    // ~10 MB of VRAM for a building the visitor has already left.
    const first = acquireConstellationOccluder(GLB_SCENE);
    const disposed = vi.spyOn(first.batch!.mesh, "dispose");

    const other = glbScene(2);
    const second = acquireConstellationOccluder(other);

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(second.scene).toBe(other);
    expect(acquireConstellationOccluder(other)).toBe(second);
  });

  it("gives the prepass a material that writes depth and no colour, on both faces", () => {
    const { material } = acquireConstellationOccluder(GLB_SCENE);
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    // Transparent is the mechanism, not decoration: it is what puts the prepass
    // in the queue where renderOrder decides, i.e. AFTER the panorama.
    expect(material.transparent).toBe(true);
    // A single-sided building leaks depth wherever the visitor sees a back face.
    expect(material.side).toBe(2);
  });

  it("draws no prepass, and does not throw, when the GLB holds no drawable mesh", () => {
    gltfScene = new Group();
    const { container } = mount({ occluderMeshUrl: MESH_URL });
    expect(container.querySelector('group[name="twin-constellation-occluder"]')).toBeNull();
    // The graph itself still draws — an absent building degrades to the
    // unoccluded map, never to a blank floor.
    expect(container.querySelector('points[name="twin-constellation-marks"]')).not.toBeNull();
  });

  it("tells demand mode the frame it already drew is now wrong", () => {
    // The building arrives long after the graph first painted. Without this the
    // occluder appears only when something else happens to request a frame.
    invalidate.mockClear();
    mount({ occluderMeshUrl: MESH_URL });
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("the eye-moved reweight", () => {
  it("registers exactly one frame callback and writes both layers on the first frame", () => {
    mount();
    expect(frameCallbacks).toHaveLength(1);

    frame(0, 1.53, 0);

    // A null previous eye always writes: the buffers are built opaque, so the
    // first frame is the one frame where skipping is visible.
    expect(reweightCalls[0]?.previous).toBeNull();
    expect(writeCalls).toHaveLength(2);
    expect(writeFor(WALK_NODES.length)).toBeDefined();
    expect(writeFor(WALK_EDGES.length * 2)).toBeDefined();
  });

  it("commits a COPY of the eye, never the scratch tuple it mutates each frame", () => {
    // Sharing one array would compare the camera against itself: needsReweight
    // would see previous === eye for ever and the graph would freeze at the
    // brightness of whichever frame happened to be first.
    mount();
    frame(0, 1.53, 0);
    frame(0, 1.53, 0);

    const second = reweightCalls[1];
    expect(second?.previousRef).not.toBeNull();
    expect(second?.previousRef).not.toBe(second?.eyeRef);
    expect(second?.previous).toEqual([0, 1.53, 0]);
  });

  it("does not rewrite a single buffer for a look-drag", () => {
    // The weights depend on camera POSITION only. Look is most of what happens
    // in walk mode, and it must cost nothing.
    mount();
    frame(0, 1.53, 0);
    expect(writeCalls).toHaveLength(2);

    frame(0, 1.53, 0);
    frame(CONSTELLATION_REWEIGHT_EPSILON_M / 4, 1.53, 0);
    expect(writeCalls).toHaveLength(2);
  });

  it("rewrites once the eye has actually travelled", () => {
    mount();
    frame(0, 1.53, 0);
    frame(2, 1.53, 0);
    expect(writeCalls).toHaveLength(4);
  });

  it("leaves the mark underfoot at full strength and quietens the one across the hall", () => {
    // The brief's requirement, read off the buffer the component actually
    // uploads rather than off the curve in isolation.
    mount();
    frame(0, 1.53, 0);

    const marks = writeFor(WALK_NODES.length);
    expect(marks).toBeDefined();
    const alpha = (index: number): number => marks?.out[index * 4 + 3] ?? Number.NaN;
    expect(alpha(0)).toBe(1);
    expect(alpha(2)).toBeLessThan(alpha(1));
    expect(alpha(2)).toBeLessThan(0.25);
    // Quiet, never absent: a mark that fades to nothing claims the walk stops
    // where the fade does.
    expect(alpha(2)).toBeGreaterThan(0.05);
  });

  it("rebuilds from opaque when the plan changes, without waiting for the eye to move", () => {
    const view = mount({ currentId: "scan_000" });
    frame(0, 1.53, 0);
    const before = writeCalls.length;

    view.rerender(
      createElement(FloorConstellation, {
        nodes: WALK_NODES,
        edges: WALK_EDGES,
        currentId: "scan_001",
      }),
    );
    // Same camera, brand new buffers — which are opaque white until written.
    frame(0, 1.53, 0);

    expect(writeCalls.length).toBe(before + 2);
    expect(reweightCalls[reweightCalls.length - 1]?.previous).toBeNull();
  });
});
