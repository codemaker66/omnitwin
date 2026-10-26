import { GangwayReviewItemSchema, gangwayLocationCentre, withGangwayDecisions, type GangwayReviewItem } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import {
  FILL_AISLE_RULE,
  GRAND_HALL_WALL_NAMES,
  designatedGangways,
  fillRefillIds,
  gangwayFlag,
  gangwayReview,
  grandHallExits,
  planGangwayFill,
  refillPieces,
  underGuidance,
} from "../auto-fill.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

const HALL = GRAND_HALL_RENDER_DIMENSIONS;
const OPTIONS = { wallNames: GRAND_HALL_WALL_NAMES } as const;
/** A rule whose design gives the Grand Hall a middle gangway. */
const SPINE_RULE = { ...FILL_AISLE_RULE, gangwayM: 1.2 };

let counter = 0;
function ids(): string {
  counter += 1;
  return `g-${String(counter)}`;
}

/** The outermost chair's reach from a 6 ft round's centre: its ring radius and half a chair's depth. */
const CHAIR_REACH = 0.915 + 0.05 + 0.58;

function round(x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0, ids);
}

/** A round whose outermost chair stands `gap` metres from the window wall. */
function offWindowWall(x: number, gap: number): readonly PlacedItem[] {
  return round(x, -HALL.length / 2 + gap + CHAIR_REACH);
}

/** The middle gangway's items for a layout, under the rule that gives the hall one. */
function middle(placed: readonly PlacedItem[]): readonly GangwayReviewItem[] {
  return gangwayReview(placed, HALL, grandHallExits(), { ...OPTIONS, rule: SPINE_RULE }).filter((item) => item.gangway === "the middle");
}

function only(items: readonly GangwayReviewItem[]): GangwayReviewItem {
  const [item, ...rest] = items;
  expect(rest).toEqual([]);
  if (item === undefined) throw new Error("no item");
  return item;
}

describe("the gangway review", () => {
  it("finds nothing in a layout Fill made", () => {
    const table = getCatalogueItemBySlug("round-table-6ft-white");
    if (table === undefined) throw new Error("no round");
    const plan = planGangwayFill({ table, seatsPerTable: 10, guests: 0, roomWidthM: 21, roomLengthM: 10.5, exits: grandHallExits(), rule: FILL_AISLE_RULE });
    if (plan === null) throw new Error("no plan");
    const placed = refillPieces([], fillRefillIds([], table), plan, ids);
    expect(gangwayReview(placed, HALL, grandHallExits(), OPTIONS)).toEqual([]);
  });

  it("lists a round 0.9 m off the window wall, measured exactly, located as the stretch it narrows", () => {
    const placed = offWindowWall(-4.5, 0.9);
    const item = only(gangwayReview(placed, HALL, grandHallExits(), OPTIONS));
    expect(GangwayReviewItemSchema.parse(item)).toEqual(item);
    expect(item).toMatchObject({ gangway: "the window wall", status: "open", sides: ["the window wall", "the round's chairs"] });
    expect(item.widthM).toBeCloseTo(0.9, 6);
    expect(item.guidance).toEqual({ thresholdM: 1.1, source: FILL_AISLE_RULE.source });
    if (item.location.kind !== "polygon") throw new Error("not a stretch");
    for (const point of item.location.points) {
      expect(point.z).toBeGreaterThanOrEqual(-HALL.length / 2 - 1e-9);
      expect(point.z).toBeLessThanOrEqual(-HALL.length / 2 + 1.1 + 1e-9);
    }
    expect(gangwayLocationCentre(item.location).x).toBeCloseTo(-4.5, 6);
    expect(placed.some((piece) => item.pieceIds.includes(piece.id))).toBe(true);
    expect(item.id).toBe(`gangway:zMin:${placed[0]?.groupId ?? ""}+wall:zMin`);
  });

  it("keeps a pinch's id through a small edit, and lets it go once the gangway is clear", () => {
    const placed = offWindowWall(-4.5, 0.9);
    const [before] = gangwayReview(placed, HALL, grandHallExits(), OPTIONS);
    const slid = placed.map((piece) => ({ ...piece, x: piece.x + 0.2 }));
    const [after] = gangwayReview(slid, HALL, grandHallExits(), OPTIONS);
    expect(after?.id).toBe(before?.id);
    const eased = placed.map((piece) => ({ ...piece, z: piece.z + 0.1 }));
    const [wider] = gangwayReview(eased, HALL, grandHallExits(), OPTIONS);
    expect(wider?.id).toBe(before?.id);
    expect(wider?.widthM).toBeCloseTo(1.0, 6);
    const clear = placed.map((piece) => ({ ...piece, z: piece.z + 0.25 }));
    expect(gangwayReview(clear, HALL, grandHallExits(), OPTIONS)).toEqual([]);
  });

  it("keeps the venue's decision through a 1 mm nudge on the snap grid's half metre", () => {
    // A round snapped to x = 0 sits 10.5 m along the window wall, where a rounded position would flip.
    const placed = offWindowWall(0, 0.9);
    const decided = { ...only(gangwayReview(placed, HALL, grandHallExits(), OPTIONS)), status: "approved" as const, reviewer: "The hallkeeper" };
    const nudged = gangwayReview(placed.map((piece) => ({ ...piece, x: piece.x - 0.001 })), HALL, grandHallExits(), OPTIONS);
    expect(withGangwayDecisions(nudged, [decided])[0]).toMatchObject({ id: decided.id, status: "approved" });
  });

  it("holds the stretch steady when a trestle's chairs tie and the trestle turns a hair", () => {
    const params = cardParamsFor("piece:trestle-6ft-white");
    if (params === null) throw new Error("no trestle");
    const trestle = stampSetup(params, { x: -4.5, z: -HALL.length / 2 + 0.9 + 0.38 + 0.55 }, 0, ids);
    const [square] = gangwayReview(trestle, HALL, grandHallExits(), OPTIONS);
    const turned = stampSetup(params, { x: -4.5, z: -HALL.length / 2 + 0.9 + 0.38 + 0.55 }, -0.01, ids)
      .map((piece, i) => ({ ...piece, id: trestle[i]?.id ?? piece.id, groupId: trestle[0]?.groupId ?? piece.groupId }));
    const [nudged] = gangwayReview(turned, HALL, grandHallExits(), OPTIONS);
    if (square === undefined || nudged === undefined) throw new Error("no item");
    const a = gangwayLocationCentre(square.location);
    const b = gangwayLocationCentre(nudged.location);
    expect(nudged.id).toBe(square.id);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.1);
  });

  it("leaves a wall alone that carries no gangway in the room's design", () => {
    const design = designatedGangways(21, 10.5, grandHallExits());
    expect(design?.layout.sides.xMax).toBe(false);
    const nearEnd = round(HALL.width / 2 - 0.7 - CHAIR_REACH, 0);
    expect(gangwayReview(nearEnd, HALL, grandHallExits(), OPTIONS)).toEqual([]);
  });
});

describe("a middle gangway", () => {
  it("is in the design when the guidance is 1.2 m", () => {
    expect(designatedGangways(21, 10.5, grandHallExits(), SPINE_RULE)?.layout.spine).toBe(true);
  });

  it("measures the gap straight across it", () => {
    const item = only(middle([...round(-1, -(0.4 + CHAIR_REACH)), ...round(-1, 0.4 + CHAIR_REACH)]));
    expect(item.widthM).toBeCloseTo(0.8, 6);
    expect(item.id).toMatch(/^gangway:spine:g-\d+\+g-\d+$/u);
  });

  it("catches a round pushed past its edge into the gangway", () => {
    // Its chair reaches 0.65 m past the centre line; the round opposite keeps to its own edge.
    expect(only(middle([...round(-1, 0.65 - CHAIR_REACH), ...round(-1, 1.25 + CHAIR_REACH)])).widthM).toBeCloseTo(0.6, 6);
  });

  it("catches a round pushed past the centre line from the far side", () => {
    expect(only(middle([...round(-1, -1.4 - CHAIR_REACH), ...round(-1, -0.65 + CHAIR_REACH)])).widthM).toBeCloseTo(0.75, 6);
  });

  it("reads chairs back to back as no way through", () => {
    expect(only(middle([...round(-1, -CHAIR_REACH), ...round(-1, CHAIR_REACH)])).widthM).toBeCloseTo(0, 6);
  });

  it("catches two rounds on the slant, with no stretch in common", () => {
    // Centres 3.1 m apart along the gangway and 2.4 m across it: the rings meet corner to corner, under a metre apart.
    const item = only(middle([...round(-1.55, -1.2), ...round(1.55, 1.2)]));
    expect(item.widthM).toBeGreaterThan(0.4);
    expect(item.widthM).toBeLessThan(1.2);
  });
});

describe("the guidance in words", () => {
  it("flags a narrow gangway plainly, and never rounds one up to the guidance", () => {
    expect(gangwayFlag(0.95)).toBe("Gangway 0.95 m · under the 1.1 m guidance · goes to the venue with this layout");
    expect(gangwayFlag(1.096)).toBe("Gangway 1.09 m · under the 1.1 m guidance · goes to the venue with this layout");
    expect(underGuidance(1.1)).toBe(false);
    expect(underGuidance(1.0999)).toBe(true);
  });
});

describe("Fill's merge", () => {
  it("leaves a group made by hand whole: two rounds and a lectern grouped together", () => {
    const table = getCatalogueItemBySlug("round-table-6ft-white");
    const lecternParams = cardParamsFor("piece:lectern");
    if (table === undefined || lecternParams === null) throw new Error("missing catalogue pieces");
    const byHand = [...round(-6, 0), ...round(-2, 0), ...stampSetup(lecternParams, { x: 2, z: 0 }, 0, ids)].map((piece) => ({ ...piece, groupId: "by-hand" }));
    const stamped = round(6, 0);
    const refill = fillRefillIds([...byHand, ...stamped], table);
    expect([...refill].sort()).toEqual(stamped.map((piece) => piece.id).sort());
  });
});
