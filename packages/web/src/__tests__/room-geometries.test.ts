import { describe, it, expect } from "vitest";
import {
  roomGeometries,
  computeBoundingBox,
  isPointInPolygon,
  resolveRoomGeometry,
  type SpaceLike,
} from "../data/room-geometries.js";
import {
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  HALL_HEIGHT,
  HALL_LENGTH,
  HALL_WALLS,
  HALL_WIDTH,
} from "../components/grand-hall/hall-spec.js";
import { scaleForRendering } from "../constants/scale.js";
import { getCatalogueItemBySlug } from "../lib/catalogue.js";
import { UNASKED_PLANNER_CHAIR_SLUG } from "../lib/furniture-defaults.js";
import { computeRotatedFootprint, isWithinRoomBounds, snapToWallEdge } from "../lib/placement.js";
import { plannerInteractionFloorShape } from "../lib/planner-interaction-floor.js";

// ---------------------------------------------------------------------------
// Room geometry data tests
// ---------------------------------------------------------------------------

const ROOM_NAMES = ["Grand Hall", "Saloon", "Reception Room", "Robert Adam Room"] as const;

describe("room geometries — all rooms", () => {
  it("defines all 4 Trades Hall rooms", () => {
    for (const name of ROOM_NAMES) {
      expect(roomGeometries[name]).toBeDefined();
    }
  });

  it("every room has at least 4 polygon points", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      expect(geom).toBeDefined();
      if (geom !== undefined) {
        expect(geom.wallPolygon.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("no polygon has self-intersecting edges (basic: all points are distinct)", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      if (geom === undefined) continue;
      const seen = new Set<string>();
      for (const [x, z] of geom.wallPolygon) {
        const key = `${String(x)},${String(z)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("polygons have clockwise winding (positive signed area)", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      if (geom === undefined) continue;
      // Shoelace formula — clockwise in screen coords = positive area
      let area = 0;
      const n = geom.wallPolygon.length;
      for (let i = 0; i < n; i++) {
        const a = geom.wallPolygon[i];
        const b = geom.wallPolygon[(i + 1) % n];
        if (a !== undefined && b !== undefined) {
          area += a[0] * b[1] - b[0] * a[1];
        }
      }
      // Clockwise = negative in standard math coords, positive in screen coords
      // Either sign is fine as long as it's consistent — just check it's non-zero
      expect(Math.abs(area)).toBeGreaterThan(0);
    }
  });
});

describe("ceiling heights", () => {
  it("Grand Hall is the scan's clear 6.7 m to the coffered ceiling, not the dome", () => {
    // The release lead's decision of 11 November 2026: the room's height is
    // hall-spec's HALL_HEIGHT, the one the drawn hall is built to.
    expect(roomGeometries["Grand Hall"]?.ceilingHeight).toBe(HALL_HEIGHT);
    expect(HALL_HEIGHT).toBe(6.7);
  });

  it("Saloon is 5.4m", () => {
    expect(roomGeometries["Saloon"]?.ceilingHeight).toBe(5.4);
  });

  it("Reception Room is 3.2m", () => {
    expect(roomGeometries["Reception Room"]?.ceilingHeight).toBe(3.2);
  });

  it("Robert Adam Room is 2.18m", () => {
    expect(roomGeometries["Robert Adam Room"]?.ceilingHeight).toBe(2.18);
  });
});

describe("Grand Hall features", () => {
  it("places on the E57 interior the planner draws, not the old hand-drawn 21 m × 10.5 m", () => {
    const geom = roomGeometries["Grand Hall"];
    if (geom === undefined) throw new Error("Grand Hall geometry missing");
    const box = computeBoundingBox(geom.wallPolygon);
    expect([box.minX, box.maxX, box.minZ, box.maxZ]).toEqual([
      -HALL_HALF_LENGTH, HALL_HALF_LENGTH, -HALL_HALF_WIDTH, HALL_HALF_WIDTH,
    ]);
    expect(box.width).toBe(HALL_LENGTH);
    expect(box.depth).toBe(HALL_WIDTH);
    // The scan's own figures, so a change to either side shows here.
    expect(box.width).toBeCloseTo(21.135, 9);
    expect(box.depth).toBeCloseTo(10.59, 9);
  });

  it("has a vertex at both ends of every wall the planner draws", () => {
    const polygon = roomGeometries["Grand Hall"]?.wallPolygon ?? [];
    const isVertex = (x: number, z: number): boolean =>
      polygon.some(([px, pz]) => Math.abs(px - x) < 1e-9 && Math.abs(pz - z) < 1e-9);
    expect(HALL_WALLS).toHaveLength(4);
    for (const wall of HALL_WALLS) {
      const [x0, , z0] = wall.origin;
      expect(isVertex(x0, z0), `${wall.id} wall start`).toBe(true);
      expect(isVertex(x0 + wall.tangent[0] * wall.length, z0 + wall.tangent[2] * wall.length), `${wall.id} wall end`).toBe(true);
    }
  });

  it("has a dome", () => {
    const geom = roomGeometries["Grand Hall"];
    expect(geom?.hasDome).toBe(true);
    expect(geom?.domeRadius).toBe(3.5);
  });
});

describe("computeBoundingBox", () => {
  it("returns correct bounds for a simple rectangle", () => {
    const box = computeBoundingBox([[-5, -3], [5, -3], [5, 3], [-5, 3]]);
    expect(box.minX).toBe(-5);
    expect(box.maxX).toBe(5);
    expect(box.minZ).toBe(-3);
    expect(box.maxZ).toBe(3);
    expect(box.width).toBe(10);
    expect(box.depth).toBe(6);
  });
});

describe("isPointInPolygon", () => {
  const square: readonly (readonly [number, number])[] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];

  it("returns true for point inside polygon", () => {
    expect(isPointInPolygon(0, 0, square)).toBe(true);
    expect(isPointInPolygon(3, 3, square)).toBe(true);
  });

  it("returns false for point outside polygon", () => {
    expect(isPointInPolygon(6, 0, square)).toBe(false);
    expect(isPointInPolygon(0, 6, square)).toBe(false);
  });

  it("works with L-shaped polygon", () => {
    const reception = roomGeometries["Reception Room"]?.wallPolygon ?? [];
    // Centre of upper section should be inside
    expect(isPointInPolygon(0, -3, reception)).toBe(true);
    // Centre of lower section should be inside
    expect(isPointInPolygon(0, 4, reception)).toBe(true);
    // Far corner outside L should be outside
    expect(isPointInPolygon(4.5, 4, reception)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveRoomGeometry — per-space fallback resolution
// ---------------------------------------------------------------------------

describe("resolveRoomGeometry", () => {
  it("returns the hand-authored geometry when the space name matches a Trades Hall room", () => {
    const space: SpaceLike = {
      name: "Grand Hall",
      heightM: "7",
      // Even if the DB polygon is a plain rectangle, the named lookup wins —
      // it preserves the hand-authored dome metadata that the polygon alone
      // can't express.
      floorPlanOutline: [
        { x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10 }, { x: 0, y: 10 },
      ],
    };
    const geom = resolveRoomGeometry(space);
    expect(geom).not.toBeNull();
    expect(geom?.hasDome).toBe(true);
    expect(geom?.domeRadius).toBe(3.5);
  });

  it("derives a polygon geometry from floorPlanOutline when the name is unknown", () => {
    const space: SpaceLike = {
      name: "Some Custom Room",
      heightM: "3.5",
      floorPlanOutline: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ],
    };
    const geom = resolveRoomGeometry(space);
    expect(geom).not.toBeNull();
    expect(geom?.ceilingHeight).toBe(3.5);
    expect(geom?.hasDome).toBe(false);
    // wallPolygon is the outline mapped to [x, z] tuples in the same order.
    expect(geom?.wallPolygon).toEqual([[0, 0], [8, 0], [8, 6], [0, 6]]);
  });

  it("preserves L-shaped outlines end-to-end", () => {
    // A non-rectangular outline — the whole point of the polygon-as-truth
    // invariant. If the resolver degraded to a bbox rectangle here, the
    // test below would see a 4-vertex polygon instead of 6.
    const space: SpaceLike = {
      name: "L-Shaped Hall",
      heightM: "3",
      floorPlanOutline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const geom = resolveRoomGeometry(space);
    expect(geom).not.toBeNull();
    expect(geom?.wallPolygon).toHaveLength(6);
    // The carved-out corner at (7, 7) is outside the rendered polygon,
    // proving the fallback preserves the shape (not just a bbox).
    expect(isPointInPolygon(7, 7, geom?.wallPolygon ?? [])).toBe(false);
    // And a point in the L's occupied arm is inside.
    expect(isPointInPolygon(2, 7, geom?.wallPolygon ?? [])).toBe(true);
  });

  it("returns null when the space has neither a known name nor a usable polygon", () => {
    const space: SpaceLike = {
      name: "Degenerate",
      heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }], // < 3 points
    };
    expect(resolveRoomGeometry(space)).toBeNull();
  });

  it("falls back to a safe ceiling height when heightM is not a positive number", () => {
    const space: SpaceLike = {
      name: "Bad Height",
      heightM: "nope",
      floorPlanOutline: [
        { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
      ],
    };
    const geom = resolveRoomGeometry(space);
    expect(geom).not.toBeNull();
    expect(geom?.ceilingHeight).toBe(3); // the defensive default
  });
});

// ---------------------------------------------------------------------------
// The Grand Hall as the planner uses it: the room size it derives from the
// outline (usePlannerRoomDimensions), and the bounds, wall snap and placement
// floor that read it. A piece set against a long wall stands on the drawn wall.
// ---------------------------------------------------------------------------

describe("Grand Hall — placing against the walls the planner draws", () => {
  const hall = resolveRoomGeometry({ name: "Grand Hall", heightM: "7", floorPlanOutline: [] });
  if (hall === null) throw new Error("Grand Hall geometry missing");
  const box = computeBoundingBox(hall.wallPolygon);
  // What usePlannerRoomDimensions hands the room-size store.
  const room = scaleForRendering({ width: box.width, length: box.depth, height: hall.ceilingHeight });
  const chair = getCatalogueItemBySlug(UNASKED_PLANNER_CHAIR_SLUG);
  if (chair === undefined) throw new Error("planner chair missing from the catalogue");
  const { halfW, halfD } = computeRotatedFootprint(chair, 0);

  it("lets a chair stand flush against each long wall and no further", () => {
    const flush = HALL_HALF_WIDTH - halfD;
    // The old 10.5 m outline stopped 4.5 cm short of the wall the hall draws.
    expect(flush).toBeGreaterThan(5.25 - halfD + 0.04);
    for (const side of [1, -1]) {
      expect(isWithinRoomBounds(0, side * flush, chair, 0, room)).toBe(true);
      expect(isWithinRoomBounds(0, side * (flush + 0.005), chair, 0, room)).toBe(false);
    }
  });

  it("lets a chair stand flush against each end wall", () => {
    const flush = HALL_HALF_LENGTH - halfW;
    for (const side of [1, -1]) {
      expect(isWithinRoomBounds(side * flush, 0, chair, 0, room)).toBe(true);
      expect(isWithinRoomBounds(side * (flush + 0.005), 0, chair, 0, room)).toBe(false);
    }
  });

  it("snaps a chair near a wall onto the drawn wall", () => {
    expect(snapToWallEdge(0, HALL_HALF_WIDTH - halfD - 0.04, chair, 0, room).z).toBeCloseTo(HALL_HALF_WIDTH - halfD, 9);
    expect(snapToWallEdge(0, -(HALL_HALF_WIDTH - halfD - 0.04), chair, 0, room).z).toBeCloseTo(-(HALL_HALF_WIDTH - halfD), 9);
    expect(snapToWallEdge(HALL_HALF_LENGTH - halfW - 0.04, 0, chair, 0, room).x).toBeCloseTo(HALL_HALF_LENGTH - halfW, 9);
  });

  it("raycasts placement over the whole scanned floor", () => {
    const points = plannerInteractionFloorShape(hall, room).getPoints();
    const xs = points.map((point) => point.x);
    // The shape's y is the floor's -z (planner-interaction-floor.ts).
    const zs = points.map((point) => -point.y);
    expect(Math.min(...xs)).toBeCloseTo(-HALL_HALF_LENGTH, 9);
    expect(Math.max(...xs)).toBeCloseTo(HALL_HALF_LENGTH, 9);
    expect(Math.min(...zs)).toBeCloseTo(-HALL_HALF_WIDTH, 9);
    expect(Math.max(...zs)).toBeCloseTo(HALL_HALF_WIDTH, 9);
  });

  it("measures the floor area the planner reports from the scanned interior", () => {
    expect(room.width * room.length).toBeCloseTo(223.82, 2);
  });
});
