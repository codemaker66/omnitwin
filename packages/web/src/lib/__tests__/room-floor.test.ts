import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { resolveRoomGeometry, roomGeometries } from "../../data/room-geometries.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { createGhostWorld, judgeGhost } from "../ghost-truth.js";
import { computeRotatedFootprint, createPlacedItem, isWithinRoomBounds, snapToWallEdge } from "../placement.js";
import {
  discWithinFloor,
  floorCentre,
  floorOfOutline,
  plannerRoomOf,
  rectWithinFloor,
  roomFloorOf,
  type PlannerRoomDimensions,
  type RoomFloor,
} from "../room-floor.js";

type Polygon = readonly (readonly [number, number])[];

function rectangle(minX: number, minZ: number, maxX: number, maxZ: number): Polygon {
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
}

function wallsOf(name: string): Polygon {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon;
}

function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

function floorOf(outline: Polygon): RoomFloor {
  const floor = floorOfOutline(outline);
  if (floor === undefined) throw new Error("no floor");
  return floor;
}

describe("which rooms carry a floor", () => {
  it("gives the Grand Hall none: its walls are the rectangle its dimensions already say", () => {
    expect(roomFloorOf(wallsOf("Grand Hall"))).toBeUndefined();
    expect(plannerRoomOf(wallsOf("Grand Hall"), 7)).toStrictEqual({ width: 21, length: 10.5, height: 7 });
    expect(plannerRoomOf(wallsOf("Grand Hall"), 7)).toStrictEqual(GRAND_HALL_RENDER_DIMENSIONS);
  });

  it("gives none to any rectangle centred on the origin, whichever corner it starts from and whichever way round", () => {
    expect(roomFloorOf(rectangle(-6.7, -5.6, 6.7, 5.6))).toBeUndefined();
    expect(roomFloorOf(rectangle(-4, -2, 4, 2))).toBeUndefined();
    expect(roomFloorOf([[4, 2], [4, -2], [-4, -2], [-4, 2]])).toBeUndefined();
  });

  it.each(["Robert Adam Room", "Reception Room", "Saloon"])("gives the %s its own walls", (name) => {
    const floor = roomFloorOf(wallsOf(name));
    expect(floor?.outline).toEqual(wallsOf(name));
    expect(roomFloorOf(wallsOf(name))).toBe(floor);
    expect(plannerRoomOf(wallsOf(name), 3).floor).toBe(floor);
  });

  it("gives one to a rectangle that is not centred, and to a centred shape that is not a rectangle", () => {
    expect(roomFloorOf(rectangle(0, 0, 21, 10.5))).toMatchObject({ minX: 0, maxX: 21, minZ: 0, maxZ: 10.5 });
    expect(roomFloorOf([[-2, -2], [2, -2], [2, 2], [0, 3], [-2, 2]])).toBeDefined();
    expect(roomFloorOf([[-2, -2], [2, -2], [0, 2]])).toBeDefined();
  });

  it("puts the Robert Adam Room's bounds where its walls are: 2.65 m off the origin", () => {
    const floor = roomFloorOf(wallsOf("Robert Adam Room"));
    expect(floor).toMatchObject({ minX: -5.7, maxX: 5.7, minZ: -3.7 });
    expect(floor?.maxZ).toBeCloseTo(9.0, 9);
    expect(floor === undefined ? null : floorCentre(floor).z).toBeCloseTo(2.65, 9);
    expect(plannerRoomOf(wallsOf("Robert Adam Room"), 2.18)).toMatchObject({ width: 11.4, height: 2.18 });
  });

  it("carries a floor for a room drawn from its stored outline when that outline starts at a corner", () => {
    const geometry = resolveRoomGeometry({ name: "Hired Hall", heightM: "4", floorPlanOutline: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }] });
    if (geometry === null) throw new Error("no geometry");
    const room = plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight);
    const chair = piece("burgess-turini-18-3");
    expect(room).toMatchObject({ width: 12, length: 8, height: 4 });
    // The box centred on the origin took (−3, −2) for floor and (9, 6) for wall.
    expect(isWithinRoomBounds(9, 6, chair, 0, room)).toBe(true);
    expect(isWithinRoomBounds(-3, -2, chair, 0, room)).toBe(false);
  });
});

describe("a footprint on a floor", () => {
  const lShape = floorOf([[0, 0], [6, 0], [6, 3], [3, 3], [3, 8], [0, 8]]);

  it("stands inside when wholly within the walls, flush against them included", () => {
    expect(rectWithinFloor(lShape, 1, 1, 1, 1)).toBe(true);
    expect(rectWithinFloor(lShape, 5, 2, 1, 1)).toBe(true);
    expect(rectWithinFloor(lShape, 1.5, 6.5, 1.5, 1.5)).toBe(true);
    // The last bit of a sum must not put a flush piece outside.
    expect(rectWithinFloor(lShape, 6 - 0.21, 3 - 0.29, 0.21, 0.29)).toBe(true);
  });

  it("stands outside when any of it is through a wall, the inner corner included", () => {
    expect(rectWithinFloor(lShape, 5.5, 1, 1, 1)).toBe(false);
    expect(rectWithinFloor(lShape, 3, 3, 0.5, 0.5)).toBe(false);
    expect(rectWithinFloor(lShape, 4.5, 5, 0.5, 0.5)).toBe(false);
    expect(rectWithinFloor(lShape, 3.002, 6, 1, 1)).toBe(false);
    // Wide enough to bridge the notch with every corner on floor or beyond it.
    expect(rectWithinFloor(lShape, 3, 4, 3, 4)).toBe(false);
  });

  it("keeps a disc as far from every wall as its radius", () => {
    expect(discWithinFloor(lShape, 1.5, 5, 1.5)).toBe(true);
    expect(discWithinFloor(lShape, 1.5, 5, 1.51)).toBe(false);
    // The inner corner is 1.41 m from (2, 2) and 1.13 m from (2.2, 2.2).
    expect(discWithinFloor(lShape, 2, 2, 1.3)).toBe(true);
    expect(discWithinFloor(lShape, 2.2, 2.2, 1.2)).toBe(false);
    expect(discWithinFloor(lShape, 4.5, 5, 0.1)).toBe(false);
  });

  it("reads the same floor whichever way round the walls are listed", () => {
    const reversed = floorOf([...lShape.outline].reverse());
    for (const [x, z, hw, hd] of [[1, 1, 1, 1], [5.5, 1, 1, 1], [3, 3, 0.5, 0.5], [1.5, 6.5, 1.5, 1.5]] as const) {
      expect(rectWithinFloor(reversed, x, z, hw, hd)).toBe(rectWithinFloor(lShape, x, z, hw, hd));
    }
    expect(reversed.walls.map((wall) => wall.roomSide).sort()).toEqual(lShape.walls.map((wall) => wall.roomSide).sort());
  });
});

describe("the floor's rules on a centred rectangle are the rectangle's own", () => {
  // The Grand Hall never carries a floor. Given one all the same, the walls' rule must say what the rectangle's says.
  const plain: PlannerRoomDimensions = { width: 21, length: 10.5, height: 7 };
  const walled: PlannerRoomDimensions = { ...plain, floor: floorOf(wallsOf("Grand Hall")) };
  const poses = [
    { item: piece("burgess-turini-18-3"), rotationY: 0 },
    { item: piece("trestle-6ft"), rotationY: Math.PI / 4 },
    { item: piece("round-table-6ft-white"), rotationY: 0 },
    { item: piece("platform"), rotationY: 0 },
  ];

  it("lets a piece stand on the same floor", () => {
    let compared = 0;
    for (const { item, rotationY } of poses) {
      for (let x = -11.5; x <= 11.5; x += 0.25) {
        for (let z = -6.25; z <= 6.25; z += 0.25) {
          compared += 1;
          expect(isWithinRoomBounds(x, z, item, rotationY, walled), `${item.slug} at (${String(x)}, ${String(z)})`)
            .toBe(isWithinRoomBounds(x, z, item, rotationY, plain));
        }
      }
    }
    expect(compared).toBeGreaterThan(15000);
  });

  it("pulls a piece to the same walls, wherever the rectangle's pull leaves it inside the room", () => {
    let compared = 0;
    for (const { item, rotationY } of poses) {
      for (let x = -11.5; x <= 11.5; x += 0.25) {
        for (let z = -6.25; z <= 6.25; z += 0.25) {
          const was = snapToWallEdge(x, z, item, rotationY, plain);
          if (!isWithinRoomBounds(was.x, was.z, item, rotationY, plain)) continue;
          compared += 1;
          expect(snapToWallEdge(x, z, item, rotationY, walled), `${item.slug} at (${String(x)}, ${String(z)})`).toEqual(was);
        }
      }
    }
    expect(compared).toBeGreaterThan(10000);
  });

  it("gives the ghost the same verdict, push and depth", () => {
    const chair = piece("burgess-turini-18-3");
    const { halfW, halfD } = computeRotatedFootprint(chair, 0);
    const was = createGhostWorld([], plain);
    const now = createGhostWorld([], walled);
    for (let x = -11.4; x <= 11.4; x += 0.19) {
      for (let z = -6.2; z <= 6.2; z += 0.17) {
        // Within a thousandth of a millimetre of a wall the two rules may round differently.
        if (Math.abs(Math.abs(x) + halfW - 10.5) < 1e-5 || Math.abs(Math.abs(z) + halfD - 5.25) < 1e-5) continue;
        const stamp = [createPlacedItem(chair.id, x, z)];
        const a = judgeGhost(stamp, was);
        const b = judgeGhost(stamp, now);
        const at = `(${String(x)}, ${String(z)})`;
        expect(b.state, at).toBe(a.state);
        expect(b.dx, at).toBeCloseTo(a.dx, 9);
        expect(b.dz, at).toBeCloseTo(a.dz, 9);
        expect(b.obstacle?.kind, at).toBe(a.obstacle?.kind);
        expect(b.obstacle?.depthM ?? 0, at).toBeCloseTo(a.obstacle?.depthM ?? 0, 9);
      }
    }
  });
});
