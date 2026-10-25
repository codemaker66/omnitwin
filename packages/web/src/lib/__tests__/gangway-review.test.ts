import { GangwayReviewItemSchema } from "@omnitwin/types";
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
} from "../auto-fill.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

const HALL = GRAND_HALL_RENDER_DIMENSIONS;
const OPTIONS = { wallNames: GRAND_HALL_WALL_NAMES } as const;

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

describe("the gangway review", () => {
  it("finds nothing in a layout Fill made", () => {
    const table = getCatalogueItemBySlug("round-table-6ft-white");
    if (table === undefined) throw new Error("no round");
    const plan = planGangwayFill({ table, seatsPerTable: 10, guests: 0, roomWidthM: 21, roomLengthM: 10.5, exits: grandHallExits(), rule: FILL_AISLE_RULE });
    if (plan === null) throw new Error("no plan");
    const placed = refillPieces([], fillRefillIds([], table), plan, ids);
    expect(gangwayReview(placed, HALL, grandHallExits(), OPTIONS)).toEqual([]);
  });

  it("lists a round 0.9 m off the window wall, measured exactly, for the venue to decide", () => {
    const placed = offWindowWall(-4.5, 0.9);
    const [item, ...rest] = gangwayReview(placed, HALL, grandHallExits(), OPTIONS);
    expect(rest).toEqual([]);
    if (item === undefined) throw new Error("no item");
    expect(GangwayReviewItemSchema.parse(item)).toEqual(item);
    expect(item).toMatchObject({ gangway: "the window wall", status: "open", sides: ["the window wall", "the round's chairs"] });
    expect(item.widthM).toBeCloseTo(0.9, 6);
    expect(item.guidance).toEqual({ thresholdM: 1.1, source: FILL_AISLE_RULE.source });
    if (item.location.kind !== "segment") throw new Error("not a segment");
    expect(Math.hypot(item.location.to.x - item.location.from.x, item.location.to.z - item.location.from.z)).toBeCloseTo(0.9, 6);
    expect(item.location.from.z).toBeCloseTo(-HALL.length / 2, 9);
    expect(placed.some((piece) => item.pieceIds.includes(piece.id))).toBe(true);
    expect(item.id).toBe(`gangway:zMin:6:${placed[0]?.groupId ?? ""}+wall:zMin`);
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

  it("leaves a wall alone that carries no gangway in the room's design", () => {
    const design = designatedGangways(21, 10.5, grandHallExits());
    expect(design?.layout.sides.xMax).toBe(false);
    const nearEnd = round(HALL.width / 2 - 0.7 - CHAIR_REACH, 0);
    expect(gangwayReview(nearEnd, HALL, grandHallExits(), OPTIONS)).toEqual([]);
  });

  it("measures the gap across a middle gangway, where the design has one", () => {
    const rule = { ...FILL_AISLE_RULE, gangwayM: 1.2 };
    expect(designatedGangways(21, 10.5, grandHallExits(), rule)?.layout.spine).toBe(true);
    const placed = [...round(-1, -(0.4 + CHAIR_REACH)), ...round(-1, 0.4 + CHAIR_REACH)];
    const middle = gangwayReview(placed, HALL, grandHallExits(), { ...OPTIONS, rule }).filter((item) => item.gangway === "the middle");
    expect(middle).toHaveLength(1);
    expect(middle[0]?.widthM).toBeCloseTo(0.8, 6);
    expect(middle[0]?.id).toMatch(/^gangway:spine:/u);
  });

  it("flags a narrow gangway plainly", () => {
    expect(gangwayFlag(0.95)).toBe("Gangway 0.95 m · under the 1.1 m guidance · the venue will review");
  });
});
