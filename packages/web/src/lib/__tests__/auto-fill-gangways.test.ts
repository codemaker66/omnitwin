import { describe, expect, it } from "vitest";
import {
  fillKeepOuts,
  fillRefillIds,
  gangwaysServeExits,
  grandHallExits,
  planBanquetFill,
  planGangwayFill,
  refillPieces,
  seatReach,
  type AisleRule,
  type GangwayFillInput,
  type GangwayFillPlan,
  type GangwayLayout,
} from "../auto-fill.js";
import { rectsOverlap, type LayoutRect } from "../auto-layout.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup, type CardId } from "../setup-cards.js";
import { tableGroupPlanningRadius } from "../table-group.js";

const RULE: AisleRule = { gangwayM: 1.1, betweenTablesM: 0.6, wallBandM: 0.6, source: "test rule" };
const HALL = { roomWidthM: 21, roomLengthM: 10.5 } as const;

function item(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`${slug} missing`);
  return found;
}

const ROUND = item("round-table-6ft-white");

function fill(overrides: Partial<GangwayFillInput> = {}): GangwayFillPlan {
  const plan = planGangwayFill({ table: ROUND, seatsPerTable: 12, guests: 0, ...HALL, exits: grandHallExits(), rule: RULE, ...overrides });
  if (plan === null) throw new Error("no plan");
  return plan;
}

let counter = 0;
function ids(): string {
  counter += 1;
  return `f-${String(counter)}`;
}

function stamp(card: CardId, x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor(card);
  if (params === null) throw new Error(`no ${card}`);
  return stampSetup(params, { x, z }, 0, ids);
}

function gapToRect(xM: number, zM: number, radiusM: number, rect: LayoutRect): number {
  const dx = Math.max(Math.abs(xM - rect.cx) - rect.width / 2, 0);
  const dz = Math.max(Math.abs(zM - rect.cz) - rect.depth / 2, 0);
  return Math.hypot(dx, dz) - radiusM;
}

describe("Fill with gangways in the Grand Hall", () => {
  it("states the figure it reaches with rounds of 10 and of 12", () => {
    expect(fill().roomForSeats).toBe(132);
    expect(fill({ seatsPerTable: 10 }).roomForSeats).toBe(110);
    expect(fill({ rule: { ...RULE, gangwayM: 1.2 } }).roomForSeats).toBe(120);
  });

  it("puts a gangway on every wall a door opens in, joined into one route", () => {
    const plan = fill();
    expect(plan.layout.sides.zMax).toBe(true);
    expect(plan.layout.sides.xMin).toBe(true);
    expect(gangwaysServeExits(plan.layout, grandHallExits(), "x")).toBe(true);
  });

  it("keeps every gangway clear, 0.6 m between every other pair and the walls' bands", () => {
    const plan = fill();
    const r = tableGroupPlanningRadius(ROUND, 12);
    for (const [i, a] of plan.tables.entries()) {
      for (const rect of plan.gangways) expect(gapToRect(a.xM, a.zM, r, rect)).toBeGreaterThanOrEqual(-1e-9);
      const band = (side: keyof GangwayLayout["sides"]): number => (plan.layout.sides[side] ? RULE.gangwayM : RULE.wallBandM);
      expect(a.xM - r + HALL.roomWidthM / 2).toBeGreaterThanOrEqual(band("xMin") - 1e-9);
      expect(HALL.roomWidthM / 2 - a.xM - r).toBeGreaterThanOrEqual(band("xMax") - 1e-9);
      expect(a.zM - r + HALL.roomLengthM / 2).toBeGreaterThanOrEqual(band("zMin") - 1e-9);
      expect(HALL.roomLengthM / 2 - a.zM - r).toBeGreaterThanOrEqual(band("zMax") - 1e-9);
      for (const b of plan.tables.slice(i + 1)) {
        expect(Math.hypot(a.xM - b.xM, a.zM - b.zM)).toBeGreaterThanOrEqual(2 * r + RULE.betweenTablesM - 1e-9);
      }
    }
  });

  it("keeps every table in reach of a gangway", () => {
    const plan = fill();
    expect(seatReach(plan.tables, tableGroupPlanningRadius(ROUND, 12), RULE.betweenTablesM, plan.gangways)).toBe(true);
  });

  it("sets a gangway on every wall when the room's doors are not recorded", () => {
    const plan = fill({ exits: null });
    expect(Object.values(plan.layout.sides)).toEqual([true, true, true, true]);
  });

  it("places only what the guests need, from the middle out, and says what the room holds", () => {
    const plan = fill({ guests: 60 });
    expect(plan.tableCount).toBe(5);
    expect(plan.meetsTarget).toBe(true);
    expect(plan.roomForSeats).toBe(132);
    expect(fill({ guests: 200 }).meetsTarget).toBe(false);
  });

  it("works round a dance floor kept where it is", () => {
    const floor = stamp("dance-floor", 0, 0);
    const keepOuts = fillKeepOuts(floor, new Set(), RULE.betweenTablesM);
    const plan = fill({ keepOuts });
    const r = tableGroupPlanningRadius(ROUND, 12);
    expect(plan.tableCount).toBeLessThan(fill().tableCount);
    for (const table of plan.tables) {
      for (const rect of keepOuts) expect(rectsOverlap({ cx: table.xM, cz: table.zM, width: 2 * r, depth: 2 * r }, rect)).toBe(false);
    }
  });

  it("leaves the old fill as it was when no gangway rule is asked for", () => {
    expect(planBanquetFill(ROUND, 0, 10, 21, 10.5)?.roomForSeats).toBe(140);
    expect(planBanquetFill(ROUND, 0, 12, 21, 10.5)?.roomForSeats).toBe(168);
  });
});

describe("which gangways serve the exits", () => {
  const layout = (on: readonly (keyof GangwayLayout["sides"])[], spine = false): GangwayLayout => ({
    sides: { xMin: on.includes("xMin"), xMax: on.includes("xMax"), zMin: on.includes("zMin"), zMax: on.includes("zMax") },
    spine,
  });
  const exits = [{ side: "zMax" as const, label: "door" }, { side: "xMin" as const, label: "fire exit" }];

  it("needs a gangway on each door's wall", () => {
    expect(gangwaysServeExits(layout(["zMax"]), exits, "x")).toBe(false);
    expect(gangwaysServeExits(layout(["zMax", "xMin"]), exits, "x")).toBe(true);
  });

  it("needs the gangways to join into one route", () => {
    const opposite = [{ side: "zMin" as const, label: "a" }, { side: "zMax" as const, label: "b" }];
    expect(gangwaysServeExits(layout(["zMin", "zMax"]), opposite, "x")).toBe(false);
    expect(gangwaysServeExits(layout(["zMin", "zMax", "xMin"]), opposite, "x")).toBe(true);
    const ends = [{ side: "xMin" as const, label: "a" }, { side: "xMax" as const, label: "b" }];
    expect(gangwaysServeExits(layout(["xMin", "xMax"], true), ends, "x")).toBe(true);
  });
});

describe("seat reach", () => {
  it("takes a table one table from a gangway and refuses one two tables away", () => {
    const gangway: LayoutRect = { cx: 0, cz: 5, width: 20, depth: 1 };
    const r = 1.5;
    const step = 2 * r + 0.6;
    const border = { xM: 0, zM: 4.5 - r, rotationY: 0 };
    const one = { xM: 0, zM: border.zM - step, rotationY: 0 };
    const two = { xM: 0, zM: one.zM - step, rotationY: 0 };
    expect(seatReach([border, one], r, 0.6, [gangway])).toBe(true);
    expect(seatReach([border, one, two], r, 0.6, [gangway])).toBe(false);
  });
});

describe("merge, never replace", () => {
  function room(): readonly PlacedItem[] {
    const tableOne = stamp("round", -6, 0).map((piece, i) => (i === 0 ? { ...piece, label: "Table 1" } : piece));
    const tableTwo = stamp("round", 6, 0).map((piece, i) => (i === 0 ? { ...piece, label: "Table 2", tableSetting: "dinner" as const } : piece));
    return [...tableTwo, ...tableOne, ...stamp("top-table", 0, -3), ...stamp("dance-floor", 0, 2.5)];
  }

  it("sets anew only the rounds of the fill's kind; every other piece stays", () => {
    const placed = room();
    const refill = fillRefillIds(placed, ROUND);
    expect(refill.size).toBe(22);
    const kept = placed.filter((piece) => !refill.has(piece.id));
    expect(kept.every((piece) => getCatalogueItem(piece.catalogueItemId)?.slug !== "round-table-6ft-white")).toBe(true);
    expect(fillKeepOuts(placed, refill, 0.6)).toHaveLength(kept.length);
  });

  it("gives the old tables' ids, names, cloths and chairs to the new rounds, Table 1 first", () => {
    const placed = room();
    const refill = fillRefillIds(placed, ROUND);
    const plan = fill({ keepOuts: fillKeepOuts(placed, refill, 0.6) });
    const pieces = refillPieces(placed, refill, plan, ids);
    expect(pieces).toHaveLength(plan.tableCount * 13);
    const oldOne = placed.find((piece) => piece.label === "Table 1");
    const oldTwo = placed.find((piece) => piece.label === "Table 2");
    const tables = pieces.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
    expect(tables[0]).toMatchObject({ id: oldOne?.id, label: "Table 1", groupId: oldOne?.groupId });
    expect(tables[1]).toMatchObject({ id: oldTwo?.id, label: "Table 2", tableSetting: "dinner" });
    const oldChairs = new Set(placed.filter((piece) => piece.groupId === oldOne?.groupId && piece.id !== oldOne.id).map((piece) => piece.id));
    const newChairs = pieces.filter((piece) => piece.groupId === oldOne?.groupId && piece.id !== oldOne.id);
    expect(newChairs).toHaveLength(12);
    expect(newChairs.filter((piece) => oldChairs.has(piece.id))).toHaveLength(10);
    const keptIds = new Set(placed.filter((piece) => !refill.has(piece.id)).map((piece) => piece.id));
    expect(pieces.some((piece) => keptIds.has(piece.id))).toBe(false);
  });
});
