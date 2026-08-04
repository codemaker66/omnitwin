import { describe, expect, it, vi } from "vitest";
import type { BufferGeometry } from "three";
import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// FloorConstellation — the pure geometry contract.
//
// happy-dom has no WebGL, so nothing here renders: the component's whole
// spatial argument is extracted into pure functions and pinned against known
// poses. What is under test is the part that can be silently wrong on screen
// and still "work" — the E57→three basis, the tripod subtraction that puts the
// graph on the floor instead of at eye height, and the four ways a real
// manifest's edge list is dirtier than the happy path (cross-floor edges,
// dangling ids, self-edges, duplicates).
//
// @react-three/fiber is mocked wholesale (DollhouseStage.test.tsx pattern):
// the module under test and its NavMarkers import both pull it in for hooks
// that never run here, and three itself is perfectly happy in Node.
// -----------------------------------------------------------------------------

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) =>
    selector({ invalidate: () => undefined }),
  useFrame: (): void => undefined,
}));

const {
  CONSTELLATION_FLOOR_DROP_M,
  CONSTELLATION_HALO_RINGS,
  buildConstellationGeometries,
  constellationLinePositions,
  constellationMarkPositions,
  disposeConstellationGeometries,
  nodeFloorPosition,
  planFloorConstellation,
} = await import("../FloorConstellation.js");

const { NAV_MARKER_FLOOR_DROP_M, NAV_MARKER_OUTER_RADIUS } = await import(
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
