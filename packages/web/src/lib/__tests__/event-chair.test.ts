import { afterEach, describe, expect, it } from "vitest";
import { FILL_AISLE_RULE, grandHallExits, planAutoFill, planBanquetFill, planGangwayFill } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { PLANNER_CHAIR_BY_EVENT, plannerChairSlug, UNASKED_PLANNER_CHAIR_SLUG } from "../furniture-defaults.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup, type CardParams } from "../setup-cards.js";
import { createTableGroup, newSeatChairSlug, rearrangeTableGroup } from "../table-group.js";
import { usePlannerEventStore, type PlannerEventKind } from "../../stores/planner-event-store.js";

const HALL = { roomWidthM: 21, roomLengthM: 10.5 } as const;

function item(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`${slug} missing`);
  return found;
}

const ROUND = item("round-table-6ft-white");

function atEvent(kind: PlannerEventKind | null): void {
  usePlannerEventStore.getState().setEventKind(kind);
}

/** The slugs of a stamp's chairs. */
function chairSlugs(pieces: readonly PlacedItem[]): readonly string[] {
  return pieces.flatMap((piece) => {
    const catalogue = getCatalogueItem(piece.catalogueItemId);
    return catalogue?.category === "chair" ? [catalogue.slug] : [];
  });
}

/** How far a stamp's chairs stand from its table's centre, the farthest. */
function ringReach(pieces: readonly PlacedItem[]): number {
  const [table, ...chairs] = pieces;
  if (table === undefined) throw new Error("no table");
  return Math.max(...chairs.map((chair) => Math.hypot(chair.x - table.x, chair.z - table.z)));
}

function card(id: "round" | "long-table"): CardParams {
  const params = cardParamsFor(id);
  if (params === null) throw new Error(`no ${id}`);
  return params;
}

function tenOf(slug: string): readonly string[] {
  return Array.from({ length: 10 }, () => slug);
}

afterEach(() => { atEvent(null); });

describe("the chair the event sets (Blake, 26 Oct 2026)", () => {
  it("is the Chiavari at a wedding and the pink velvet chair at a business event", () => {
    expect(plannerChairSlug("wedding")).toBe("chiavari-chair");
    expect(plannerChairSlug("corporate")).toBe("burgess-turini-18-3");
    atEvent("wedding");
    expect(plannerChairSlug()).toBe("chiavari-chair");
  });

  it("is the chair the planner always set until it has asked what the event is", () => {
    expect(plannerChairSlug()).toBe(UNASKED_PLANNER_CHAIR_SLUG);
    expect(UNASKED_PLANNER_CHAIR_SLUG).toBe("burgess-turini-18-3");
  });

  it("names a chair the catalogue has, for every kind of event", () => {
    for (const slug of Object.values(PLANNER_CHAIR_BY_EVENT)) expect(item(slug).category).toBe("chair");
  });
});

describe("a card set down at a wedding", () => {
  it("seats a Round of 10 on Chiavari, its ring nearer the table than the pink chair's", () => {
    atEvent("wedding");
    const wedding = stampSetup(card("round"), { x: 0, z: 0 }, 0);
    atEvent("corporate");
    const business = stampSetup(card("round"), { x: 0, z: 0 }, 0);
    expect(chairSlugs(wedding)).toEqual(tenOf("chiavari-chair"));
    expect(chairSlugs(business)).toEqual(tenOf("burgess-turini-18-3"));
    // The ring is spaced by the chair it is: the Chiavari is 17 cm shallower.
    expect(ringReach(business) - ringReach(wedding)).toBeGreaterThan(0.05);
  });

  it("seats a long table's trestles on the event's chair too", () => {
    atEvent("wedding");
    const slugs = chairSlugs(stampSetup(card("long-table"), { x: 0, z: 0 }, 0));
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs)).toEqual(new Set(["chiavari-chair"]));
  });

  it("seats the chair named over the event's, as the setup pictures ask", () => {
    atEvent("corporate");
    expect(chairSlugs(stampSetup(card("round"), { x: 0, z: 0 }, 0, undefined, "chiavari-chair"))).toEqual(tenOf("chiavari-chair"));
  });
});

describe("a table keeps its own chairs", () => {
  it("gives a seat added to a pink-chair round at a wedding a pink chair", () => {
    const placed = createTableGroup(ROUND.id, 0, 0, 0, 8);
    const [table] = placed;
    if (table === undefined) throw new Error("no table");
    atEvent("wedding");
    expect(newSeatChairSlug(table, placed)).toBe("burgess-turini-18-3");
    expect(chairSlugs(rearrangeTableGroup(table.id, 10, placed))).toEqual(tenOf("burgess-turini-18-3"));
  });

  it("gives a table with no chairs the event's", () => {
    atEvent("wedding");
    const placed = createTableGroup(ROUND.id, 0, 0, 0, 0);
    const [table] = placed;
    if (table === undefined) throw new Error("no table");
    expect(placed).toHaveLength(1);
    expect(chairSlugs(rearrangeTableGroup(table.id, 10, placed))).toEqual(tenOf("chiavari-chair"));
  });
});

describe("the Grand Hall's figures follow the event's chair", () => {
  function gangwayFill(seatsPerTable: number): number | undefined {
    return planGangwayFill({ table: ROUND, seatsPerTable, guests: 0, ...HALL, exits: grandHallExits(), rule: FILL_AISLE_RULE })?.roomForSeats;
  }

  it("seats 170 and 204 at 0.6 m, 140 and 168 with gangways, at a wedding", () => {
    atEvent("wedding");
    expect(planBanquetFill(ROUND, 0, 10, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(170);
    expect(planBanquetFill(ROUND, 0, 12, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(204);
    expect(gangwayFill(10)).toBe(140);
    expect(gangwayFill(12)).toBe(168);
  });

  it("seats 140 and 168 at 0.6 m, 110 and 132 with gangways, at a business event", () => {
    atEvent("corporate");
    expect(planBanquetFill(ROUND, 0, 10, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(140);
    expect(planBanquetFill(ROUND, 0, 12, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(168);
    expect(gangwayFill(10)).toBe(110);
    expect(gangwayFill(12)).toBe(132);
  });

  it("sets theatre rows with the event's chair, on the rows' own fixed pitch", () => {
    atEvent("wedding");
    const wedding = planAutoFill("theatre", 0, HALL.roomWidthM, HALL.roomLengthM);
    const business = planAutoFill("theatre", 0, HALL.roomWidthM, HALL.roomLengthM, "burgess-turini-18-3");
    expect(wedding?.style === "theatre" ? wedding.chairItemId : null).toBe(getCatalogueItemBySlug("chiavari-chair")?.id);
    expect(business?.style === "theatre" ? business.chairItemId : null).toBe(getCatalogueItemBySlug("burgess-turini-18-3")?.id);
    // The rows are laid out by planTheatreLayout's own spacing, whichever chair sits in them.
    expect(wedding?.roomForSeats).toBe(business?.roomForSeats);
  });
});
