import { GangwayReviewItemSchema, gangwayLocationCentre, gangwayReviewId } from "@omnitwin/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { Space } from "../../api/spaces.js";
import { placementViolationIds } from "../../components/PlacedFurniture.js";
import { toRealWorld, toRenderSpace } from "../../constants/scale.js";
import { isPointInPolygon, roomGeometries } from "../../data/room-geometries.js";
import { gangwayReview, planAutoFill } from "../../lib/auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../../lib/catalogue.js";
import { createGhostWorld, judgeGhost } from "../../lib/ghost-truth.js";
import { computeRotatedFootprint, createPlacedItem, isWithinRoomBounds, snapToWallEdge, type PlacedItem } from "../../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { distanceToWalls, type PlannerRoomDimensions } from "../../lib/room-floor.js";
import { seatShortfallOffer } from "../../lib/seat-shortfall.js";
import { createTableGroup } from "../../lib/table-group.js";
import { THEATRE_SPACING } from "../../lib/theatre-layout.js";
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
function openRoom(name: string): PlannerRoomDimensions {
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

// ---------------------------------------------------------------------------
// What the planner sets by itself: Banquet rounds, Theatre, the seat
// shortfall. Each used to lay its grid across the old box, so in these rooms
// tables and chairs landed through the walls. These hold every piece inside
// the walls the planner draws. Whether the layout then saves is the API's
// question, asked of the space's stored outline, and is not shown here.
// ---------------------------------------------------------------------------

/** Every placed piece any of whose footprint is outside the walls, by the slow way. */
function piecesOutside(walls: Polygon, placed: readonly PlacedItem[]): string[] {
  const outside: string[] = [];
  for (const one of placed) {
    const item = getCatalogueItem(one.catalogueItemId);
    if (item === undefined) throw new Error("unknown piece");
    const { halfW, halfD } = computeRotatedFootprint(item, one.rotationY, one.scale);
    if (!footprintInside(walls, one.x, one.z, halfW, halfD, HAIR)) outside.push(`${item.slug} at (${one.x.toFixed(2)}, ${one.z.toFixed(2)})`);
  }
  return outside;
}

const ROUND = piece("round-table-6ft-white");
const TURINI = piece("burgess-turini-18-3");

describe.each(SHAPED_ROOMS)("what the planner sets by itself in the %s", (name) => {
  const walls = wallsOf(name);

  it.each([0, 60])("sets every banquet round and chair for %i guests inside the walls", (guests) => {
    openRoom(name);
    const plan = usePlacementStore.getState().autoArrangeBanquet(ROUND.id, guests, 10);
    const placed = usePlacementStore.getState().placedItems;
    expect(piecesOutside(walls, placed)).toEqual([]);
    expect(plan?.tableCount ?? 0).toBeGreaterThan(0);
    expect(placed).toHaveLength((plan?.tableCount ?? 0) * 11);
  });

  it.each([0, 60])("sets every theatre chair for %i guests inside the walls", (guests) => {
    openRoom(name);
    const plan = usePlacementStore.getState().autoArrangeTheatre(TURINI.id, guests);
    const placed = usePlacementStore.getState().placedItems;
    expect(piecesOutside(walls, placed)).toEqual([]);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed).toHaveLength(plan?.chairs ?? -1);
  });

  it("sets no theatre row the walls cut down to one or two chairs", () => {
    openRoom(name);
    const plan = usePlacementStore.getState().autoArrangeTheatre(TURINI.id, 0);
    if (plan === null) throw new Error("no theatre plan");
    // A row is the seats abreast: at one z facing down the room's length, at one x facing along its width.
    const rows = new Map<string, number>();
    for (const seat of plan.seats) {
      const row = (seat.rotationY === 0 ? seat.zM : seat.xM).toFixed(3);
      rows.set(row, (rows.get(row) ?? 0) + 1);
    }
    expect([...rows.values()].filter((seats) => seats < 3)).toEqual([]);
    expect(rows.size).toBe(plan.rows);
    expect(plan.roomForSeats).toBe(plan.seats.length);
  });

  it("says before it fills exactly what it then sets (the prompt's plan is the store's)", () => {
    const dims = openRoom(name);
    const options = { floor: dims.floor };
    const banquet = planAutoFill("dinner-rounds", 60, toRealWorld(dims.width), toRealWorld(dims.length), TURINI.slug, options);
    const placedBanquet = usePlacementStore.getState().autoArrangeBanquet(ROUND.id, 60, 10);
    expect(placedBanquet).toEqual(banquet);
    const theatre = planAutoFill("theatre", 60, toRealWorld(dims.width), toRealWorld(dims.length), TURINI.slug, options);
    const placedTheatre = usePlacementStore.getState().autoArrangeTheatre(TURINI.id, 60);
    expect(placedTheatre).toEqual(theatre);
  });

  it("keeps the gangway fill inside the walls too", () => {
    const dims = openRoom(name);
    setPlannerFeaturesForTesting({ fillKeepOuts: true });
    try {
      const plan = usePlacementStore.getState().autoArrangeBanquet(ROUND.id, 0, 10, null);
      expect(piecesOutside(walls, usePlacementStore.getState().placedItems)).toEqual([]);
      // Nothing to set is an answer; a table through a wall is not.
      if (plan !== null) expect(usePlacementStore.getState().placedItems).toHaveLength(plan.tableCount * 11);
      else expect(dims.floor).toBeDefined();
    } finally {
      setPlannerFeaturesForTesting(null);
    }
  });
});

describe("the Robert Adam Room, filled", () => {
  const walls = wallsOf("Robert Adam Room");

  it("adds a seat shortfall's tables inside the walls", () => {
    openRoom("Robert Adam Room");
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND.id, -2.5, 0, 0, 10)] });
    const fix = usePlacementStore.getState().fillSeatShortfall(40);
    expect(fix?.offer.kind).toBe("tables");
    expect(piecesOutside(walls, usePlacementStore.getState().placedItems)).toEqual([]);
  });

  it("offers in the panel the tables the fix then adds", () => {
    const dims = openRoom("Robert Adam Room");
    const placedItems = [...createTableGroup(ROUND.id, -2.5, 0, 0, 10)];
    usePlacementStore.setState({ placedItems });
    const offer = seatShortfallOffer({ placedItems, guests: 40, roomWidthM: toRealWorld(dims.width), roomLengthM: toRealWorld(dims.length), floor: dims.floor });
    expect(usePlacementStore.getState().fillSeatShortfall(40)?.offer).toEqual(offer);
  });

  it("keeps a theatre seat the rows' wall band from every wall, the notch's included", () => {
    openRoom("Robert Adam Room");
    usePlacementStore.getState().autoArrangeTheatre(TURINI.id, 0);
    const floor = useRoomDimensionsStore.getState().dimensions.floor;
    if (floor === undefined) throw new Error("no floor");
    const near = usePlacementStore.getState().placedItems.filter((one) => distanceToWalls(floor, one.x, one.z) < THEATRE_SPACING.wallClearanceM - 1e-6);
    expect(near).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The gangway review goes to the venue with a layout. In these rooms a gangway
// runs along the walls that are there: the curve, the stepped-in corners, the
// piers between the alcoves, not the sides of a box drawn round them.
// ---------------------------------------------------------------------------

/** A room's walls in metres, as the review's figures are. */
function wallsInMetres(name: string): Polygon {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon;
}

/**
 * How far a round's rim stands from the nearest wall, worked out with nothing
 * of the planner's: every wall walked a millimetre at a time.
 */
function rimToNearestWall(walls: Polygon, x: number, z: number, radius: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  walls.forEach(([ax, az], i) => {
    const [bx, bz] = walls[(i + 1) % walls.length] ?? [ax, az];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.001));
    for (let s = 0; s <= steps; s += 1) {
      nearest = Math.min(nearest, Math.hypot(ax + ((bx - ax) * s) / steps - x, az + ((bz - az) * s) / steps - z));
    }
  });
  return nearest - radius;
}

/** Whether a point is inside the walls, by how far the walls turn round it: a full turn inside, none outside. */
function windsRound(walls: Polygon, x: number, z: number): boolean {
  let turned = 0;
  walls.forEach(([ax, az], i) => {
    const [bx, bz] = walls[(i + 1) % walls.length] ?? [ax, az];
    let step = Math.atan2(bz - z, bx - x) - Math.atan2(az - z, ax - x);
    if (step > Math.PI) step -= 2 * Math.PI;
    if (step < -Math.PI) step += 2 * Math.PI;
    turned += step;
  });
  return Math.abs(turned) > Math.PI;
}

const ROUND_RADIUS_M = ROUND.width / 2;
/** The review draws a round as 32 sides touching its rim, at most this far outside it (metres), and the slow way walks the walls a millimetre at a time. */
const OUTLINE_SLACK_M = 0.006;

describe.each(SHAPED_ROOMS)("the gangway review in the %s", (name) => {
  it("lists a 6 ft round exactly where its rim is under 1.1 m from a wall, at the width to the nearest one", () => {
    const dims = openRoom(name);
    const walls = wallsInMetres(name);
    const wrong: string[] = [];
    let narrowed = 0;
    let clear = 0;
    for (const { x, z } of gridOver(walls, 0.37)) {
      const gap = rimToNearestWall(walls, x, z, ROUND_RADIUS_M);
      // The round stands inside the walls, and not within the outline's slack of the guidance itself.
      if (!windsRound(walls, x, z) || gap < 0.01 || Math.abs(gap - 1.1) < 2 * OUTLINE_SLACK_M) continue;
      const review = gangwayReview([createPlacedItem(ROUND.id, x, z)], dims, null);
      const at = `(${x.toFixed(2)}, ${z.toFixed(2)})`;
      if (gap >= 1.1) {
        clear += 1;
        if (review.length > 0) wrong.push(`${at} is ${gap.toFixed(3)} m from the nearest wall, listed at ${String(review[0]?.widthM.toFixed(3))} m`);
        continue;
      }
      narrowed += 1;
      const narrowest = review[0]?.widthM;
      if (narrowest === undefined) wrong.push(`${at} is ${gap.toFixed(3)} m from the nearest wall, not listed`);
      else if (Math.abs(narrowest - gap) > OUTLINE_SLACK_M) wrong.push(`${at} is ${gap.toFixed(3)} m from the nearest wall, listed at ${narrowest.toFixed(3)} m`);
    }
    expect(narrowed).toBeGreaterThan(100);
    expect(clear).toBeGreaterThan(0);
    expect({ wrong: wrong.length, first: wrong[0] ?? null }).toEqual({ wrong: 0, first: null });
  });
});

describe("the gangway review in the Robert Adam Room", () => {
  const walls = wallsInMetres("Robert Adam Room");

  it("measures a gangway from where the walls stand, not from the old box", () => {
    const dims = openRoom("Robert Adam Room");
    // In the lower section, 1.28 m clear of the curved wall and of the east wall, and further from the rest. The old box's far wall ran through it.
    expect(rimToNearestWall(walls, -2.3, 6.2, ROUND_RADIUS_M)).toBeGreaterThan(1.1);
    expect(gangwayReview([createPlacedItem(ROUND.id, -2.3, 6.2)], dims, null)).toEqual([]);
    // Half a metre from the real north wall: under the 1.1 m guidance. The old box put that wall 2.65 m further off.
    const review = gangwayReview([createPlacedItem(ROUND.id, 0, -3.7 + 0.5 + ROUND.width / 2)], dims, null);
    expect(review.map((item) => item.gangway)).toEqual(["the wall"]);
    expect(review[0]?.widthM).toBeCloseTo(0.5, 2);
  });

  it.each([
    ["0.713 m from the curved west wall", -2.9, 6.5, 0.713, "xMin"],
    ["0.5 m from the curve's apex", -3.085, 6.2, 0.5, "xMin"],
    ["0.5 m from the lower section's east wall", -1.515, 6.2, 0.5, "xMax"],
    ["0.5 m from the upper section's south wall, east half", 2.5, 2.285, 0.5, "zMax"],
    ["0.5 m from the south wall, which the box put 0.3 m further off", -2.85, 7.285, 0.5, "zMax"],
    ["0.5 m from the north wall", 0, -2.285, 0.5, "zMin"],
  ] as const)("lists a 6 ft round %s", (_where, x, z, gapM, side) => {
    const dims = openRoom("Robert Adam Room");
    // The figure in the case's name is the slow way's own.
    expect(rimToNearestWall(walls, x, z, ROUND_RADIUS_M)).toBeCloseTo(gapM, 2);
    const placed = createPlacedItem(ROUND.id, x, z);
    const [item] = gangwayReview([placed], dims, null);
    if (item === undefined) throw new Error(`a round ${gapM.toFixed(3)} m from a wall is not listed`);
    expect(Math.abs(item.widthM - gapM)).toBeLessThan(OUTLINE_SLACK_M);
    expect(item).toMatchObject({ gangway: "the wall", status: "open", pieceIds: [placed.id] });
    expect(item.id).toBe(gangwayReviewId(side, [{ wall: side }, { unit: placed.id }]));
    expect(GangwayReviewItemSchema.parse(item)).toEqual(item);
  });

  it("locates a pinch on the wall it is measured to", () => {
    const dims = openRoom("Robert Adam Room");
    const [item] = gangwayReview([createPlacedItem(ROUND.id, -1.515, 6.2)], dims, null);
    if (item === undefined || item.location.kind !== "polygon") throw new Error("no stretch");
    // The 1.1 m of gangway inside the lower section's east wall (x = −0.1), beside the round.
    for (const point of item.location.points) {
      expect(point.x).toBeGreaterThanOrEqual(-0.1 - 1.1 - 1e-9);
      expect(point.x).toBeLessThanOrEqual(-0.1 + 1e-9);
      expect(Math.abs(point.z - 6.2)).toBeLessThanOrEqual(ROUND_RADIUS_M + OUTLINE_SLACK_M);
    }
    const centre = gangwayLocationCentre(item.location);
    expect(centre.x).toBeCloseTo(-0.65, 6);
    expect(centre.z).toBeCloseTo(6.2, 6);
  });

  it("measures a trestle's edge to the wall beside it, corner or side", () => {
    const dims = openRoom("Robert Adam Room");
    const trestle = piece("trestle-6ft");
    // Turned to run along the lower section's east wall, its long side 0.4 m off it.
    const placed = createPlacedItem(trestle.id, -0.1 - 0.4 - trestle.depth / 2, 6.2, Math.PI / 2);
    const [item, ...rest] = gangwayReview([placed], dims, null);
    expect(rest).toEqual([]);
    expect(item?.widthM).toBeCloseTo(0.4, 9);
    expect(item?.id).toBe(gangwayReviewId("xMax", [{ wall: "xMax" }, { unit: placed.id }]));
  });
});

describe("the gangway review in the Saloon", () => {
  it("lists a round half a metre from the pier between the east alcoves, once", () => {
    const dims = openRoom("Saloon");
    expect(rimToNearestWall(wallsInMetres("Saloon"), 4.535, 0, ROUND_RADIUS_M)).toBeCloseTo(0.5, 2);
    const placed = createPlacedItem(ROUND.id, 4.535, 0);
    const review = gangwayReview([placed], dims, null);
    // The pier's face and its two corners are one gangway, to the round's east.
    expect(review.map((item) => item.id)).toEqual([gangwayReviewId("xMax", [{ wall: "xMax" }, { unit: placed.id }])]);
    expect(review[0]?.widthM).toBeCloseTo(0.5, 6);
  });
});
