import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { SpaceDimensions } from "@omnitwin/types";
import type { Space } from "../../api/spaces.js";
import { placementViolationIds } from "../../components/PlacedFurniture.js";
import { toRenderSpace } from "../../constants/scale.js";
import { isPointInPolygon, roomGeometries } from "../../data/room-geometries.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../../lib/catalogue.js";
import { createGhostWorld, judgeGhost } from "../../lib/ghost-truth.js";
import { computeRotatedFootprint, createPlacedItem, isWithinRoomBounds, snapToWallEdge } from "../../lib/placement.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { usePlannerRoomDimensions } from "../use-planner-room-dimensions.js";

// The modelled Grand Hall is Trades Hall's; the venue read is answered here.
vi.mock("../use-trades-hall-venue.js", () => ({ useTradesHallVenue: () => true }));

// ---------------------------------------------------------------------------
// Audit editor-save-4. The planner used to know a room only as a box of its
// width and length centred on the origin. The Robert Adam Room's walls run
// from z = −3.7 to z = +9.0 and its lower section is half the width, the
// Reception Room steps in, the Saloon has alcoves: there the box and the
// walls disagree. These open each room as the planner does (the room hook
// fills the room store) and hold every decision about where furniture may
// stand to the room's own wall polygon (data/room-geometries).
// ---------------------------------------------------------------------------

type Polygon = readonly (readonly [number, number])[];

const SHAPED_ROOMS = ["Robert Adam Room", "Reception Room", "Saloon"] as const;

function wallsOf(name: string): Polygon {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon.map(([x, z]) => [toRenderSpace(x), toRenderSpace(z)] as const);
}

function spaceNamed(name: string): Space {
  return {
    id: `s-${name}`, venueId: "v-th", name, slug: name.toLowerCase().replaceAll(" ", "-"),
    // The stored figures are not what the planner draws a named room from.
    widthM: "1", lengthM: "1", heightM: "3",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  };
}

/** Opens a room as the planner does, and gives back what the room store then holds. */
function openRoom(name: string): SpaceDimensions {
  useEditorStore.setState({ space: spaceNamed(name) });
  renderHook(() => usePlannerRoomDimensions());
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: false });
  return useRoomDimensionsStore.getState().dimensions;
}

function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

/**
 * Whether a footprint stands wholly inside the walls, worked out the slow
 * way: its centre is inside, every centimetre of its edge is inside, and no
 * corner of a wall pokes into it. `slack` shrinks the footprint (metres), so
 * a piece set exactly against a wall is not judged on the last bit of a sum.
 */
function footprintInside(walls: Polygon, x: number, z: number, halfW: number, halfD: number, slack: number): boolean {
  const hw = halfW - slack;
  const hd = halfD - slack;
  if (!isPointInPolygon(x, z, walls)) return false;
  if (walls.some(([wx, wz]) => Math.abs(wx - x) < hw && Math.abs(wz - z) < hd)) return false;
  const n = Math.max(2, Math.ceil((2 * Math.max(hw, hd)) / 0.01));
  for (let i = 0; i <= n; i += 1) {
    const dx = -hw + (2 * hw * i) / n;
    const dz = -hd + (2 * hd * i) / n;
    if (!isPointInPolygon(x + dx, z - hd, walls) || !isPointInPolygon(x + dx, z + hd, walls)) return false;
    if (!isPointInPolygon(x - hw, z + dz, walls) || !isPointInPolygon(x + hw, z + dz, walls)) return false;
  }
  return true;
}

/** A millimetre: nearer a wall than this, the slow way and the planner may differ by rounding alone. */
const HAIR = 0.001;

function gridOver(walls: Polygon, step: number): { readonly x: number; readonly z: number }[] {
  const xs = walls.map(([x]) => x);
  const zs = walls.map(([, z]) => z);
  const points: { x: number; z: number }[] = [];
  for (let x = Math.min(...xs) - 0.6; x <= Math.max(...xs) + 0.6; x += step) {
    for (let z = Math.min(...zs) - 0.6; z <= Math.max(...zs) + 0.6; z += step) points.push({ x, z });
  }
  return points;
}

afterEach(() => {
  cleanup();
  useEditorStore.setState({ space: null });
});

describe("the Grand Hall, a rectangle centred on the origin", () => {
  it("opens as the plain 21 × 10.5 × 7 m room, exactly as before", () => {
    expect(openRoom("Grand Hall")).toStrictEqual({ width: 21, length: 10.5, height: 7 });
  });
});

describe.each(SHAPED_ROOMS)("where a piece may stand in the %s", (name) => {
  const walls = wallsOf(name);

  it.each([
    ["a chair", "burgess-turini-18-3", 0, 0.17],
    ["a 6 ft trestle turned a quarter", "trestle-6ft", Math.PI / 2, 0.29],
    ["a 6 ft round", "round-table-6ft-white", 0, 0.37],
  ])("lets %s stand exactly where its whole footprint is inside the walls", (_what, slug, rotationY, step) => {
    const dims = openRoom(name);
    const item = piece(slug);
    const { halfW, halfD } = computeRotatedFootprint(item, rotationY);
    const wrong: string[] = [];
    let judged = 0;
    for (const { x, z } of gridOver(walls, step)) {
      const inside = footprintInside(walls, x, z, halfW, halfD, HAIR);
      // Within a hair of a wall the slow way cannot say; everywhere else it can.
      if (inside !== footprintInside(walls, x, z, halfW, halfD, -HAIR)) continue;
      judged += 1;
      if (isWithinRoomBounds(x, z, item, rotationY, dims) !== inside) wrong.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) should be ${inside ? "inside" : "outside"}`);
    }
    expect(judged).toBeGreaterThan(400);
    expect(wrong).toEqual([]);
  });

  it("never shows a ghost as valid with any of it outside the walls, and never refuses one wholly inside for the walls", () => {
    openRoom(name);
    const chair = piece("burgess-turini-18-3");
    const { halfW, halfD } = computeRotatedFootprint(chair, 0);
    const wrong: string[] = [];
    for (const { x, z } of gridOver(walls, 0.23)) {
      if (!isPointInPolygon(x, z, walls)) continue; // the pointer is always on the room's floor
      usePlacementStore.getState().updateGhost(x, z, chair.id);
      const { ghostPosition, ghostValid, ghostInvalidReason } = usePlacementStore.getState();
      if (ghostPosition === null) throw new Error("no ghost");
      const [gx, , gz] = ghostPosition;
      if (ghostValid && !footprintInside(walls, gx, gz, halfW, halfD, HAIR)) wrong.push(`valid outside the walls at (${gx.toFixed(2)}, ${gz.toFixed(2)})`);
      if (!ghostValid && footprintInside(walls, gx, gz, halfW, halfD, -HAIR)) wrong.push(`"${ghostInvalidReason ?? ""}" inside the walls at (${gx.toFixed(2)}, ${gz.toFixed(2)})`);
    }
    expect(wrong).toEqual([]);
  });

  it.each([
    ["a chair", "burgess-turini-18-3", 0],
    ["a 6 ft trestle", "trestle-6ft", 0],
    ["a 6 ft round, which keeps room for its chairs", "round-table-6ft-white", 0],
  ])("pulls %s only to walls that are there: never to a spot outside them", (_what, slug, rotationY) => {
    const dims = openRoom(name);
    const item = piece(slug);
    const { halfW, halfD } = computeRotatedFootprint(item, rotationY);
    const wrong: string[] = [];
    let pulled = 0;
    for (const { x, z } of gridOver(walls, 0.27)) {
      if (!isPointInPolygon(x, z, walls)) continue;
      const to = snapToWallEdge(x, z, item, rotationY, dims);
      if (to.x === x && to.z === z) continue;
      pulled += 1;
      if (!footprintInside(walls, to.x, to.z, halfW, halfD, HAIR)) {
        wrong.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) pulled to (${to.x.toFixed(2)}, ${to.z.toFixed(2)}), outside the walls`);
      }
    }
    expect(pulled).toBeGreaterThan(50);
    expect(wrong).toEqual([]);
  });

  it("gives the ghost of a card the same floor: fits only inside the walls, and a push lands inside them", () => {
    const dims = openRoom(name);
    const chair = piece("burgess-turini-18-3");
    const { halfW, halfD } = computeRotatedFootprint(chair, 0);
    const world = createGhostWorld([], dims);
    const wrong: string[] = [];
    for (const { x, z } of gridOver(walls, 0.21)) {
      const verdict = judgeGhost([createPlacedItem(chair.id, x, z)], world);
      const at = `(${x.toFixed(2)}, ${z.toFixed(2)})`;
      if (verdict.state === "refused") {
        if (footprintInside(walls, x, z, halfW, halfD, -HAIR)) wrong.push(`refused inside the walls at ${at}`);
        else if (verdict.obstacle?.kind !== "outside_room") wrong.push(`refused at ${at} without naming the wall`);
      } else if (!footprintInside(walls, x + verdict.dx, z + verdict.dz, halfW, halfD, HAIR)) {
        wrong.push(`${verdict.state} outside the walls at ${at}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the Robert Adam Room's own walls", () => {
  const chair = piece("burgess-turini-18-3");
  const { halfW, halfD } = computeRotatedFootprint(chair, 0);
  const NORTH = -3.7;
  const SOUTH = 8.7;
  const LOWER_EAST = -0.1;

  it("stops a chair at the north wall, 2.65 m inside the old box", () => {
    const dims = openRoom("Robert Adam Room");
    expect(isWithinRoomBounds(0, NORTH + halfD + 0.01, chair, 0, dims)).toBe(true);
    expect(isWithinRoomBounds(0, NORTH + halfD - 0.01, chair, 0, dims)).toBe(false);
    // Where the 60-guest banquet used to set its north row of tables.
    expect(isWithinRoomBounds(0, -4.19, chair, 0, dims)).toBe(false);
  });

  it("lets a chair stand all the way to the south wall, 2.35 m past the old box", () => {
    const dims = openRoom("Robert Adam Room");
    expect(isWithinRoomBounds(-2.85, SOUTH - halfD - 0.01, chair, 0, dims)).toBe(true);
    expect(isWithinRoomBounds(-2.85, SOUTH - halfD + 0.01, chair, 0, dims)).toBe(false);
  });

  it("stops a chair at the east edge of the lower section, and keeps the floor beside it shut", () => {
    const dims = openRoom("Robert Adam Room");
    expect(isWithinRoomBounds(LOWER_EAST - halfW - 0.01, 6, chair, 0, dims)).toBe(true);
    expect(isWithinRoomBounds(LOWER_EAST - halfW + 0.01, 6, chair, 0, dims)).toBe(false);
    expect(isWithinRoomBounds(3, 5, chair, 0, dims)).toBe(false);
  });

  it("pulls a chair to the real north and south walls, and to no wall in between", () => {
    const dims = openRoom("Robert Adam Room");
    expect(snapToWallEdge(0, -3.0, chair, 0, dims).z).toBeCloseTo(NORTH + halfD, 9);
    expect(snapToWallEdge(-2.85, 8.2, chair, 0, dims).z).toBeCloseTo(SOUTH - halfD, 9);
    // 6.35 m was the old box's far wall: nothing stands there.
    expect(snapToWallEdge(-2.85, 6.6, chair, 0, dims)).toEqual({ x: -2.85, z: 6.6 });
  });

  it("marks placed pieces by the same walls: one beyond the north wall is flagged, one by the south wall is not", () => {
    const dims = openRoom("Robert Adam Room");
    const beyondNorth = createPlacedItem(chair.id, 0, -4.19);
    const bySouth = createPlacedItem(chair.id, -2.85, 8.2);
    const placed = [beyondNorth, bySouth, createPlacedItem(chair.id, 2, 0)];
    expect([...placementViolationIds(placed, placed, dims)]).toEqual([beyondNorth.id]);
    // The same verdict from the one-by-one scan the lean path uses.
    expect([...placementViolationIds([bySouth], placed, dims)]).toEqual([]);
    expect([...placementViolationIds([beyondNorth], placed, dims)]).toEqual([beyondNorth.id]);
  });

  it("shows the ghost valid by the south wall and refuses it through the north one", () => {
    openRoom("Robert Adam Room");
    usePlacementStore.getState().updateGhost(-2.85, 6.6, chair.id);
    expect(usePlacementStore.getState().ghostValid).toBe(true);
    expect(usePlacementStore.getState().ghostPosition).toEqual([-2.85, 0, 6.6]);
    const world = createGhostWorld([], useRoomDimensionsStore.getState().dimensions);
    const through = judgeGhost([createPlacedItem(chair.id, 0, NORTH + halfD - 0.5)], world);
    expect(through.state).toBe("refused");
    expect(through.obstacle?.obstacleLabel).toBe("the wall");
    expect(through.obstacle?.depthM).toBeCloseTo(0.5, 6);
    const nudged = judgeGhost([createPlacedItem(chair.id, 0, NORTH + halfD - 0.1)], world);
    expect(nudged.state).toBe("pushed");
    expect(nudged.dz).toBeCloseTo(0.1, 5);
  });
});

describe("notches in the other rooms", () => {
  const chair = piece("burgess-turini-18-3");

  it("keeps the Reception Room's stepped-in corners shut", () => {
    const dims = openRoom("Reception Room");
    expect(isWithinRoomBounds(3.0, 3.0, chair, 0, dims)).toBe(true);
    expect(isWithinRoomBounds(4.3, 3.0, chair, 0, dims)).toBe(false);
    expect(isWithinRoomBounds(-4.3, 3.0, chair, 0, dims)).toBe(false);
  });

  it("lets a chair into a Saloon alcove, and not into the wall between two", () => {
    const dims = openRoom("Saloon");
    expect(isWithinRoomBounds(6.25, -1.05, chair, 0, dims)).toBe(true);
    expect(isWithinRoomBounds(6.25, 0, chair, 0, dims)).toBe(false);
  });
});
