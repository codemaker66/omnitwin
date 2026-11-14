// The gangway review of pieces set against the walls of a room's own floor (lib/auto-fill gangwayReview):
// the third review's own examples, each set down by the real click path, the record of one of them as the
// API takes it, and pieces slid flush along every wall of the three shaped rooms a centimetre at a time.
// Each review is judged by gangway-against-walls.ts, which holds it to the slow way: nothing the shared
// schema refuses, 0.00 m only for a wall a piece lies against, and real floor inside the room.
import { ConfigurationMetadataSchema, GangwayReviewSchema, type GangwayReview } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import type { Space } from "../../api/spaces.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { gangwayReview } from "../auto-fill.js";
import type { CatalogueItem } from "../catalogue.js";
import { recordGangwayReview, resetGangwayReviewRecordForTesting } from "../gangway-review-record.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import {
  count,
  emptyTally,
  faultsOf,
  inWords,
  NO_FAULTS,
  piece,
  room,
  said,
  setDown,
  SHAPED_ROOMS,
  sideOf,
  verdictOn,
  type Room,
} from "./gangway-against-walls.js";
import { insideWalls, nearestOnShape, squareIntoRoom, standsOnTheFloor, TOUCHING, type Shape, type Wall } from "./walls-the-slow-way.js";

const CHAIR = piece("burgess-turini-18-3");
const TRESTLE = piece("trestle-6ft");
const ROUND = piece("round-table-6ft-white");
const SCREEN = piece("projector-screen");
const PLATFORM = piece("platform");

afterEach(() => {
  resetGangwayReviewRecordForTesting();
  useEditorStore.setState({ configId: null, isPublicPreview: false, space: null });
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
  useChairDialogStore.getState().clearDialog();
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
});

/** A click in the room with `item` in hand, turned `turn`, the pointer at (x, z): what was set down. */
function clicked(r: Room, item: CatalogueItem, pointer: readonly [number, number], turn: number, snapEnabled: boolean): readonly PlacedItem[] {
  useRoomDimensionsStore.getState().setDimensions(r.dims);
  const set = setDown(item, 0, pointer[0], pointer[1], turn, snapEnabled);
  if (set === null) throw new Error(`nothing was set down at (${String(pointer[0])}, ${String(pointer[1])})`);
  return set;
}

/** Where the first piece set down stands, to the millimetre. */
function spot(set: readonly PlacedItem[]): readonly [number, number] {
  const [first] = set;
  if (first === undefined) throw new Error("nothing set down");
  return [Number(first.x.toFixed(3)), Number(first.z.toFixed(3))];
}

/** What the slow way finds wrong with the review of what was set down. */
function faults(r: Room, set: readonly PlacedItem[]): ReturnType<typeof faultsOf> {
  const tally = emptyTally();
  count(tally, verdictOn(r, set), "the piece");
  return faultsOf(tally);
}

describe("the gangway review of a piece set against a wall by a click, by the third review's examples", () => {
  it("lists the Saloon's west wall alone, at 0.00 m, for a projector screen turned along it across the pier, and the schema takes it", () => {
    const r = room("Saloon");
    // Grid off. The screen stands along the wall line x = −5.95: against the wall south of the alcove and against
    // the pier, across the alcove's mouth between them. It reaches the alcoves' side walls only at their ends.
    const set = clicked(r, SCREEN, [-6.435, -1.035], Math.PI / 2, false);
    expect(spot(set)).toEqual([-5.65, -1.035]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMin", 0]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the pier at 0.00 m for a 6 ft trestle set against it, and the alcoves' side walls, which it only reaches the ends of, not at all", () => {
    const r = room("Saloon");
    // Grid on. The trestle stands against the pier between the west alcoves, x = −5.95 from z = −0.15 to 0.15,
    // and across both their mouths. The far corner of each mouth is 1.035 m from its end: a corner's gap each.
    const set = clicked(r, TRESTLE, [-6.435, -0.345], Math.PI / 2, true);
    expect(spot(set)).toEqual([-5.57, 0]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMin", 0], ["zMax", 1.035], ["zMin", 1.035]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the Robert Adam Room's bottom wall at 0.00 m for a 6 ft trestle set against it, and the wall to its west at the 0.785 m it stands off", () => {
    const r = room("Robert Adam Room");
    // Grid on. The trestle stands against the bottom wall, z = 8.7, either side of a door recess. The recess's
    // side walls it only reaches the ends of. The short wall to its west at x = −5.7 is 0.785 m from its end.
    const set = clicked(r, TRESTLE, [-4.435, 6.535], 0, true);
    expect(spot(set)).toEqual([-4, 8.32]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMin", 0.785], ["zMax", 0], ["zMin", 0.321]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the Robert Adam Room's bottom wall at 0.00 m for a projector screen set along it across both door recesses, and the schema takes it", () => {
    const r = room("Robert Adam Room");
    // Grid off. Against the bottom wall west of the first recess and between the two, across both their mouths.
    // The recesses' side walls it reaches only at their ends; the far corner of the second recess, (−1.6, 8.7),
    // is 0.435 m from its end.
    const set = clicked(r, SCREEN, [-3.285, 6.995], 0, false);
    expect(spot(set)).toEqual([-3.285, 8.4]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMax", 0.435], ["zMax", 0], ["zMin", 0.692]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the bottom wall alone at 0.00 m for a projector screen that reaches from the far jamb of one door recess to the far jamb of the other", () => {
    const r = room("Robert Adam Room");
    // Grid off. The screen is 2.5 m long, and the far jambs of the two recesses, (−4.1, 8.7) and (−1.6, 8.7), are 2.5 m
    // apart: it lies against the wall between the recesses and its two ends touch the jambs, each a corner of the bottom
    // wall beyond and of a recess's side wall. Its side is on the bottom wall's line, so both corners are the bottom
    // wall's: nothing is listed to its east or west at 0.00 m.
    const set = clicked(r, SCREEN, [-2.85, 6.995], 0, false);
    expect(spot(set)).toEqual([-2.85, 8.4]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review).filter(([, width]) => width === 0)).toEqual([["zMax", 0]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the wall a trestle lies along at 0.00 m, and the wall round the corner at its chairs' own gap to it", () => {
    const r = room("Robert Adam Room");
    // Grid on. The trestle stands against the upper section's south wall, z = 3.7, for the last 15 mm of it, and
    // reaches the lower section's east wall, x = −0.1, only at the corner between them. Its chairs to the south
    // stand in front of that east wall: its gangway is as wide as their gap to it, not 0.00 m.
    useRoomDimensionsStore.getState().setDimensions(r.dims);
    const set = setDown(TRESTLE, 6, -1.445, 1.705, 0, true);
    if (set === null) throw new Error("nothing was set down");
    expect(set).toHaveLength(7);
    expect(spot(set)).toEqual([-1, 3.32]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review).map(([side, width]) => [side, width === 0])).toEqual([["xMax", false], ["zMax", true]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });
});

describe("the gangway review of the third review's two examples no click reaches", () => {
  // A click within 1.5 m of a wall pulls the piece flush against it (lib/placement WALL_SNAP_THRESHOLD), so
  // neither spot is where a click leaves a piece: a drag, a nudge or typed coordinates can. Set directly, as
  // the review set them.
  it("gives a 6 ft trestle against the Robert Adam Room's bottom wall at x = −2.45, across a door recess, a location the schema takes", () => {
    const r = room("Robert Adam Room");
    // Against the wall both sides of the recess from x = −2.4 to −1.6, and reaching the recess to its west only
    // at its corner (−3.3, 8.7). The far corner of that recess, (−4.1, 8.7), is 0.735 m from its end.
    const set = [createPlacedItem(TRESTLE.id, -2.45, 8.7 - TRESTLE.depth / 2, 0, null, 0, "piece-1")];
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMin", 0.735], ["zMax", 0]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });

  it("lists the Saloon's east wall alone, at 0.00 m, for a stage platform turned along it across the pier at (5.34, −1)", () => {
    const r = room("Saloon");
    const set = [createPlacedItem(PLATFORM.id, 5.95 - PLATFORM.depth / 2, -1, Math.PI / 2, null, 0, "piece-1")];
    expect(spot(set)).toEqual([5.34, -1]);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMax", 0]]);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });
});

describe("the gangway review of a chair set flush in a Saloon alcove's corner, by the fourth review's examples", () => {
  // Grid on, turned 0. The click pulls the banquet chair flush into the alcove's corner beside the pier: against the
  // alcove's back wall, x = ±6.55, and the pier's side wall, z = ±0.15. The next alcove's corner on the far side of
  // the pier is 0.30 m away straight through the solid pier, and some 1.05 m round its face: no gap of 0.30 m.
  it.each([
    ["the south-east alcove's north-east corner", [6.2104, -0.6471], [6.325, -0.375], [["xMax", 0], ["zMax", 0]]],
    ["the north-east alcove's south-east corner", [6.2104, 0.6471], [6.325, 0.375], [["xMax", 0], ["zMin", 0]]],
    ["the south-west alcove's north-west corner", [-6.2104, -0.6471], [-6.325, -0.375], [["xMin", 0], ["zMax", 0]]],
    ["the north-west alcove's south-west corner", [-6.2104, 0.6471], [-6.325, 0.375], [["xMin", 0], ["zMin", 0]]],
  ] as const)("lists the two walls of %s at 0.00 m and no gap through the pier", (_corner, pointer, at, sides) => {
    const r = room("Saloon");
    const set = clicked(r, piece("banquet-chair"), pointer, 0, true);
    expect(spot(set)).toEqual(at);
    const review = gangwayReview(set, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual(sides);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });
});

describe("the gangway review of a unit with a piece that touches a wall only at that wall's far end, by the fourth review's examples", () => {
  it("lists the 3.9 cm pinch a high chair leaves at a Robert Adam Room door jamb, though a microphone of its group touches that wall's other end", () => {
    const r = room("Robert Adam Room");
    // One group. The microphone stands in the first door recess, flush on its west side wall, x = −2.4, and touches the
    // bottom wall between the recesses, z = 8.7 from x = −2.4 to −3.3, only at that wall's end (−2.4, 8.7). The high
    // chair stands 0.0387 m from the second recess's jamb (−3.3, 8.7), that wall's other end, and is nearer the jamb
    // than any other point of either wall that meets there. The microphone has reached the far end of the wall and
    // takes no part at the jamb: the pinch is the high chair's, as it is with the microphone gone.
    const unit = [
      createPlacedItem(piece("handheld-microphone").id, -2.375, 8.725, Math.PI / 2, "unit-1", 0, "piece-1"),
      createPlacedItem(piece("highchair-blue").id, -3.626371, 8.557646, 0.666842, "unit-1", 0, "piece-2"),
    ];
    const [, highChair] = unit;
    if (highChair === undefined) throw new Error("no high chair");
    expect(said(gangwayReview([{ ...highChair, groupId: null }], r.dims, null))).toContainEqual(["xMax", 0.039]);
    const review = gangwayReview(unit, r.dims, null);
    expect(GangwayReviewSchema.safeParse({ items: review }).success).toBe(true);
    expect(said(review)).toEqual([["xMax", 0.039], ["xMin", 0], ["zMax", 0.072]]);
    expect(Math.abs((review.find((item) => sideOf(item) === "xMax")?.widthM ?? 0) - 0.038722)).toBeLessThan(1e-6);
    expect(faults(r, unit)).toEqual(NO_FAULTS);
  });

  it.each([
    ["west", -5.95 + 0.225, 0.375, [["xMin", 0]]],
    ["east", 5.95 - 0.225, -0.375, [["xMax", 0]]],
  ] as const)("lists no gap at the far front corner of the Saloon's %s pier for a chair that touches only its near front corner", (_pier, x, z, sides) => {
    const r = room("Saloon");
    // The chair's corner is on the pier's front corner, its sides on the lines of the two walls that meet there: it
    // touches the pier's 0.3 m face only at that end, and is listed there at 0.00 m. The face's other end is 0.30 m
    // from the chair along the face. The chair has reached the face's near end and takes no part at its far end: that
    // corner is no gangway of its own, whether the chair is asked as a candidate there or as making the face nearer.
    const set = [createPlacedItem(piece("banquet-chair").id, x, z, 0, null, 0, "piece-1")];
    expect(said(gangwayReview(set, r.dims, null))).toEqual(sides);
    expect(faults(r, set)).toEqual(NO_FAULTS);
  });
});

// ---------------------------------------------------------------------------
// Lone chairs set all through the Saloon's four alcoves and the floor before
// their mouths, every 3 cm from flush against the back wall and flush against
// the side wall beside the pier, turned 0, 15, 30 and 45 degrees: wholly on the
// floor, against a wall or clear of it. Where a chair's gap to a corner beyond
// the pier is measured through the pier, the judge says so (falseGap).
// ---------------------------------------------------------------------------

describe("lone chairs set through the Saloon's alcoves", () => {
  const CHAIR_IN_ALCOVES = piece("banquet-chair");

  it.each([0, 15, 30, 45])("turned %i°: no gap measured through a pier, and nothing else the slow way finds wrong", (degrees) => {
    const r = room("Saloon");
    const turn = (degrees * Math.PI) / 180;
    const halfW = CHAIR_IN_ALCOVES.width / 2;
    const halfD = CHAIR_IN_ALCOVES.depth / 2;
    // How far the turned chair reaches from its middle along x and along z.
    const reachX = halfW * Math.abs(Math.cos(turn)) + halfD * Math.abs(Math.sin(turn));
    const reachZ = halfW * Math.abs(Math.sin(turn)) + halfD * Math.abs(Math.cos(turn));
    const tally = emptyTally();
    // A chair that comes within a millimetre of a corner of the walls without touching it (turned, its corner a fraction
    // of a millimetre from a pier's front corner) is in the band the fourth review's finding 4 names, between the
    // planner's 1 µm and 1 mm, left as it is this round: counted here, not judged.
    let inTheBand = 0;
    // Each alcove by the way into it from the room (east +1, west −1) and the way from its pier along it (north +1, south −1).
    for (const east of [1, -1]) {
      for (const north of [1, -1]) {
        for (let i = 0; i <= 30; i += 1) {
          for (let j = 0; j <= 60; j += 1) {
            // From flush against the back wall, x = ±6.55, out past the mouth; from flush against the pier's side wall, z = ±0.15, along the alcove.
            const x = east * (6.55 - reachX - 0.03 * i);
            const z = north * (0.15 + reachZ + 0.03 * j);
            const chair = createPlacedItem(CHAIR_IN_ALCOVES.id, x, z, turn, null, 0, "chair-1");
            const shape: Shape = { kind: "box", x, z, halfW, halfD, turn };
            if (!standsOnTheFloor(r.walls, shape)) continue;
            const toAnEnd = Math.min(...r.walls.map(([wx, wz]) => nearestOnShape(shape, wx, wz).gap));
            if (toAnEnd > TOUCHING && toAnEnd <= 0.001) {
              inTheBand += 1;
              continue;
            }
            count(tally, verdictOn(r, [chair]), `turned ${String(degrees)}° at (${x.toFixed(3)}, ${z.toFixed(3)})`);
          }
        }
      }
    }
    console.log(`alcoves | chairs turned ${String(degrees)}°: ${inWords(tally)}; within a millimetre of a corner of the walls, not judged ${String(inTheBand)}`);
    // Six at 15° and six at 30°, of some six thousand each.
    expect(inTheBand).toBeLessThanOrEqual(6);
    expect(tally.units).toBeGreaterThan(4000);
    expect(tally.againstAWall).toBeGreaterThan(100);
    expect(faultsOf(tally)).toEqual(NO_FAULTS);
  }, 600_000);
});

describe("recording the review of a piece set against a wall", () => {
  // The Saloon as production stores it (the note in lib/room-floor): 12 m by 7 m, centred.
  const SALOON: Space = {
    id: "space-saloon", venueId: "venue-1", name: "Saloon", slug: "saloon",
    widthM: "12", lengthM: "7", heightM: "5.4",
    floorPlanOutline: [{ x: -6, y: -3.5 }, { x: 6, y: -3.5 }, { x: 6, y: 3.5 }, { x: -6, y: 3.5 }],
  };

  it("writes the review of a screen along the Saloon's west wall: the schema the API holds a layout's metadata to takes it", async () => {
    const r = room("Saloon");
    clicked(r, SCREEN, [-6.435, -1.035], Math.PI / 2, false);
    useEditorStore.setState({ configId: "cfg-saloon", isPublicPreview: false, space: SALOON });
    const writes: (GangwayReview | null | undefined)[] = [];
    const recorded = recordGangwayReview({
      flush: () => Promise.resolve(true),
      read: () => Promise.resolve({}),
      // The API's PATCH /configurations/:id answers 400 VALIDATION_ERROR to metadata this schema refuses (routes/configurations.ts).
      write: (_configId, metadata) => {
        const parsed = ConfigurationMetadataSchema.safeParse(metadata);
        if (!parsed.success) return Promise.reject(new Error(`400 VALIDATION_ERROR ${JSON.stringify(parsed.error.issues[0])}`));
        writes.push(metadata.gangwayReview);
        return Promise.resolve({});
      },
    });
    await expect(recorded).resolves.toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.items.map((item) => item.widthM)).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// A piece slid flush along every wall of a room, a centimetre at a time, from
// wholly before the wall's first end to wholly past its last: past every
// corner, pier, alcove mouth and door recess, and at each the place where its
// end is exactly at the wall's. Every place where the piece's middle is on the
// floor is judged, whether or not the piece then pokes through another wall:
// a drag can leave it so.
// ---------------------------------------------------------------------------

/** How a piece is slid: its long side along the wall, or end on to it. A round has no ends. */
type Lie = "along" | "end on";

/** A piece set flush against a wall's line, its middle `along` metres from the wall's first end. */
function flushAgainst(r: Room, wall: Wall, item: CatalogueItem, lie: Lie, along: number): PlacedItem {
  const [ax, az, bx, bz] = wall;
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  const [nx, nz] = squareIntoRoom(r.walls, wall);
  // A piece's own (lx, lz) stands at (lx cos + lz sin, −lx sin + lz cos): its long side runs along the wall when (cos, −sin) is the wall's way.
  const alongWall = Math.atan2(-uz, ux);
  const off = item.tableShape === "round" ? item.width / 2 : lie === "along" ? item.depth / 2 : item.width / 2;
  const turn = item.tableShape === "round" ? 0 : lie === "along" ? alongWall : alongWall + Math.PI / 2;
  return createPlacedItem(item.id, ax + ux * along + nx * off, az + uz * along + nz * off, turn, null, 0, "slid-1");
}

/** How far a slid piece reaches along the wall from its middle. */
function halfAlong(item: CatalogueItem, lie: Lie): number {
  return item.tableShape === "round" || lie === "along" ? item.width / 2 : item.depth / 2;
}

const SLID: readonly (readonly [string, CatalogueItem, Lie])[] = [
  ["a chair", CHAIR, "along"],
  ["a 6 ft trestle, its long side along the wall", TRESTLE, "along"],
  ["a 6 ft trestle, end on to the wall", TRESTLE, "end on"],
  ["a projector screen, along the wall", SCREEN, "along"],
  ["a stage platform, along the wall", PLATFORM, "along"],
  ["a 6 ft round", ROUND, "along"],
];

describe.each(SHAPED_ROOMS)("pieces slid flush along the walls of the %s", (name) => {
  it.each(SLID)("%s: nothing refused, no item without floor, 0.00 m only for a wall it lies against", (what, item, lie) => {
    const r = room(name);
    const tally = emptyTally();
    let places = 0;
    const half = halfAlong(item, lie);
    for (const wall of r.straight) {
      const length = Math.hypot(wall[2] - wall[0], wall[3] - wall[1]);
      const steps = Math.round((length + 2 * half + 0.6) / 0.01);
      for (let i = 0; i <= steps; i += 1) {
        const along = -(half + 0.3) + i * 0.01;
        const slid = flushAgainst(r, wall, item, lie, along);
        places += 1;
        if (!insideWalls(r.walls, slid.x, slid.z)) continue;
        count(tally, verdictOn(r, [slid]), `flush against ${JSON.stringify(wall)} at (${slid.x.toFixed(3)}, ${slid.z.toFixed(3)}) turned ${slid.rotationY.toFixed(3)}`);
      }
    }
    console.log(`slid ${name} | ${what}: places ${String(places)}, ${inWords(tally)}`);
    expect(tally.units).toBeGreaterThan(1000);
    expect(tally.againstAWall).toBeGreaterThan(500);
    expect(faultsOf(tally)).toEqual(NO_FAULTS);
  }, 600_000);
});
