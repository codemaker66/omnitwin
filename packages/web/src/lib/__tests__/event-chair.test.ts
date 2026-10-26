import { afterEach, describe, expect, it } from "vitest";
import { planAutoFill, planBanquetFill } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { PLANNER_CHAIR_BY_EVENT, plannerChairSlug, UNASKED_PLANNER_CHAIR_SLUG } from "../furniture-defaults.js";
import { stockIdentity } from "../card-stock.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup, type CardParams } from "../setup-cards.js";
import { createTableGroup, newSeatChairSlug, rearrangeTableGroup, tableOwnChairs } from "../table-group.js";
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
  it("gives a seat added to a Turini round at a wedding a Turini", () => {
    const placed = createTableGroup(ROUND.id, 0, 0, 0, 8);
    const [table] = placed;
    if (table === undefined) throw new Error("no table");
    atEvent("wedding");
    expect(newSeatChairSlug(table, placed)).toBe("burgess-turini-18-3");
    expect(chairSlugs(rearrangeTableGroup(table.id, 10, placed))).toEqual(tenOf("burgess-turini-18-3"));
  });

  it("counts the venue's pink chair as the Turini it is: a pink-chair round stepped up at a wedding gets a Turini", () => {
    const [table] = createTableGroup(ROUND.id, 0, 0, 0, 0);
    if (table === undefined) throw new Error("no table");
    const pinks = Array.from({ length: 10 }, (_, i) => ({ ...createPlacedItem(item("pink-chair").id, i, 1, 0, table.groupId), id: `pink-${String(i)}` }));
    atEvent("wedding");
    expect(newSeatChairSlug(table, [table, ...pinks])).toBe("burgess-turini-18-3");
    const added = rearrangeTableGroup(table.id, 11, [table, ...pinks]).filter((piece) => piece.id !== table.id && !pinks.some((pink) => pink.id === piece.id));
    expect(chairSlugs(added)).toEqual(["burgess-turini-18-3"]);
  });

  it("counts only a table's own chairs when Group puts two rounds in one group", () => {
    const chiavariRound = createTableGroup(ROUND.id, 0, 0, 0, 4, 0, undefined, "around", "chiavari-chair");
    const [a] = chiavariRound;
    if (a === undefined || a.groupId === null) throw new Error("no round");
    const turiniRound = createTableGroup(ROUND.id, 6, 0, 0, 10, 0, undefined, "around", "burgess-turini-18-3")
      .map((piece) => ({ ...piece, groupId: a.groupId }));
    const grouped = [...chiavariRound, ...turiniRound];
    atEvent("corporate");
    // Ten Turinis in the group, four Chiavari at this round: its own four decide.
    expect(newSeatChairSlug(a, grouped)).toBe("chiavari-chair");
    const after = rearrangeTableGroup(a.id, 6, grouped);
    const aAfter = after.find((piece) => piece.id === a.id);
    if (aAfter === undefined) throw new Error("no round after");
    expect(chairSlugs(tableOwnChairs(aAfter, after))).toEqual(Array.from({ length: 6 }, () => "chiavari-chair"));
    // The other round is left as it stood.
    for (const piece of turiniRound) expect(after).toContainEqual(piece);
  });

  it("gives a table with no chairs the event's", () => {
    atEvent("wedding");
    const placed = createTableGroup(ROUND.id, 0, 0, 0, 0);
    const [table] = placed;
    if (table === undefined) throw new Error("no table");
    expect(placed).toHaveLength(1);
    expect(chairSlugs(rearrangeTableGroup(table.id, 10, placed))).toEqual(tenOf("chiavari-chair"));
  });

  it("gives a mixed table the chair most of its seats are", () => {
    const turinis = createTableGroup(ROUND.id, 0, 0, 0, 3);
    const [table] = turinis;
    if (table === undefined) throw new Error("no table");
    const chiavari = { ...createPlacedItem(item("chiavari-chair").id, 1, 1, 0, table.groupId), id: "odd-one" };
    atEvent("wedding");
    expect(newSeatChairSlug(table, [...turinis, chiavari])).toBe("burgess-turini-18-3");
  });

  it("keeps a top table's chairs where they stand when its count changes at another event", () => {
    const params = cardParamsFor("top-table");
    if (params === null) throw new Error("no top table");
    const placed = stampSetup(params, { x: 0, z: 0 }, 0);
    const [table] = placed;
    if (table === undefined) throw new Error("no table");
    const own = (pieces: readonly PlacedItem[]): readonly PlacedItem[] => pieces.filter((piece) => piece.groupId === table.groupId && piece.id !== table.id);
    const before = own(placed);
    atEvent("wedding");
    // One fewer, and one more: the seat added is a Turini too. A 6 ft trestle seats three along
    // its back (0.6 m a seat), so the step up starts from the two the step down leaves.
    const fewer = rearrangeTableGroup(table.id, before.length - 1, placed);
    const more = rearrangeTableGroup(table.id, before.length, fewer);
    for (const [after, count] of [[own(fewer), before.length - 1], [own(more), before.length]] as const) {
      expect(after).toHaveLength(count);
      expect(new Set(chairSlugs(after))).toEqual(new Set(["burgess-turini-18-3"]));
      // Along the back, set off by the Turini's depth, not the Chiavari's.
      for (const chair of after) expect(Math.abs(chair.z - table.z)).toBeCloseTo(Math.abs((before[0]?.z ?? Number.NaN) - table.z), 9);
    }
  });
});

describe("the store's count, whatever the event", () => {
  it("counts the Chiavari as itself and the Turini as the venue's pink chair", () => {
    expect(stockIdentity(item("chiavari-chair").id)).toBe(item("chiavari-chair").id);
    expect(stockIdentity(item("burgess-turini-18-3").id)).toBe(item("pink-chair").id);
  });
});

describe("the Grand Hall's figures follow the event's chair", () => {
  it("seats 170 and 204 at 0.6 m at a wedding", () => {
    atEvent("wedding");
    expect(planBanquetFill(ROUND, 0, 10, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(170);
    expect(planBanquetFill(ROUND, 0, 12, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(204);
  });

  it("seats 140 and 168 at 0.6 m at a business event", () => {
    atEvent("corporate");
    expect(planBanquetFill(ROUND, 0, 10, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(140);
    expect(planBanquetFill(ROUND, 0, 12, HALL.roomWidthM, HALL.roomLengthM)?.roomForSeats).toBe(168);
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
