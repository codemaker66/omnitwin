import { describe, expect, it } from "vitest";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS } from "@omnitwin/types";
import {
  applySeatShortfallFix,
  seatShortfallActionLabel,
  seatShortfallDetail,
  seatShortfallDoneLine,
  seatShortfallOffer,
  type SeatShortfallInput,
} from "../seat-shortfall.js";
import { planAutoFill } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { computeRotatedFootprint, createPlacedItem, type PlacedItem } from "../placement.js";
import { createTableGroup, tableGroupPlanningRadius } from "../table-group.js";
import { seatingCountsFromPlacedItems } from "../seating-counts.js";

const HALL_W = TRADES_HALL_GRAND_HALL_DIMENSIONS.width;
const HALL_L = TRADES_HALL_GRAND_HALL_DIMENSIONS.length;

function slug(name: string): string {
  const item = getCatalogueItemBySlug(name);
  if (item === undefined) throw new Error(`no ${name}`);
  return item.id;
}
const ROUND = slug("round-table-6ft-white");
const CHAIR = slug("burgess-turini-18-3");

function groups(positions: readonly (readonly [number, number])[], chairs: number): PlacedItem[] {
  return positions.flatMap(([x, z]) => [...createTableGroup(ROUND, x, z, 0, chairs)]);
}

function input(placedItems: readonly PlacedItem[], guests: number | null): SeatShortfallInput {
  return { placedItems, guests, roomWidthM: HALL_W, roomLengthM: HALL_L };
}

function chairsAt(items: readonly PlacedItem[], table: PlacedItem): number {
  return items.filter((item) => item.groupId === table.groupId && item.catalogueItemId === CHAIR).length;
}

// What the old auto-fill placed in the Grand Hall: 4 × 2 rounds of eight.
const OLD_FILL: readonly (readonly [number, number])[] = [-6.435, -2.145, 2.145, 6.435]
  .flatMap((x) => [[x, -2.145], [x, 2.145]] as const);

describe("seat shortfall: chairs at the tables while they have room", () => {
  it("offers the 16 chairs 80 guests need at eight rounds of eight", () => {
    const layout = groups(OLD_FILL, 8);
    const offer = seatShortfallOffer(input(layout, 80));
    expect(offer).toEqual({ kind: "chairs", short: 16, guests: 80, chairs: 16, tables: 8, seatsPerTable: 10 });
    if (offer === null) return;
    expect(seatShortfallActionLabel(offer)).toBe("Add 16 chairs at the tables");
    expect(seatShortfallDetail(offer)).toBe("Spread over 8 tables, up to 10 at each.");
  });

  it("adds them evenly, keeps every table where it was and every chair it had", () => {
    const layout = groups(OLD_FILL, 8);
    const fix = applySeatShortfallFix(input(layout, 80));
    if (fix === null) throw new Error("no fix");
    expect(seatingCountsFromPlacedItems(fix.placedItems).chairs).toBe(80);
    const tables = fix.placedItems.filter((item) => item.catalogueItemId === ROUND);
    expect(tables).toHaveLength(8);
    for (const table of tables) {
      expect(chairsAt(fix.placedItems, table)).toBe(10);
      const before = layout.find((item) => item.id === table.id);
      expect(before?.x).toBe(table.x);
      expect(before?.z).toBe(table.z);
    }
    const ids = new Set(fix.placedItems.map((item) => item.id));
    for (const item of layout) expect(ids.has(item.id)).toBe(true);
    expect(fix.addedIds).toHaveLength(16);
    expect(seatShortfallDoneLine(fix.offer)).toBe("Added 16 chairs at 8 tables.");
  });

  it("adds them at tables grouped by hand without losing one of them or its chairs", () => {
    // Group (Ctrl G) puts every table and chair under one groupId.
    const layout = groups(OLD_FILL, 8).map((item) => ({ ...item, groupId: "grouped-by-hand" }));
    const fix = applySeatShortfallFix(input(layout, 80));
    if (fix === null) throw new Error("no fix");
    expect(seatingCountsFromPlacedItems(fix.placedItems).chairs).toBe(80);
    expect(fix.placedItems.filter((item) => item.catalogueItemId === ROUND)).toHaveLength(8);
    const ids = new Set(fix.placedItems.map((item) => item.id));
    for (const item of layout) expect(ids.has(item.id)).toBe(true);
    expect(fix.addedIds).toHaveLength(16);
  });

  it("gives a table placed on its own a group, so its new chairs move with it", () => {
    const table = createPlacedItem(ROUND, 0, 0, 0, null, 0);
    const fix = applySeatShortfallFix(input([table], 6));
    if (fix === null) throw new Error("no fix");
    const grouped = fix.placedItems.find((item) => item.id === table.id);
    expect(grouped?.groupId).not.toBeNull();
    expect(fix.placedItems.filter((item) => item.groupId === grouped?.groupId && item.catalogueItemId === CHAIR)).toHaveLength(6);
  });

  it("offers the chairs that fit when the tables can take some but the floor has no room for another", () => {
    const fill = planAutoFill("dinner-rounds", 0, HALL_W, HALL_L);
    if (fill === null || fill.style !== "dinner-rounds") throw new Error("no fill");
    const layout = groups(fill.tables.map((t) => [t.xM, t.zM] as const), 8);
    const offer = seatShortfallOffer(input(layout, 160));
    expect(offer?.kind).toBe("chairs");
    expect(offer?.kind === "chairs" ? offer.chairs : 0).toBe(28);
  });
});

describe("seat shortfall: tables for the rest when the tables are full", () => {
  it("adds tables like those on the floor, in free floor at the banquet spacing", () => {
    const layout = groups([[-4, 0], [0, 0]], 10);
    const offer = seatShortfallOffer(input(layout, 36));
    expect(offer).toMatchObject({ kind: "tables", short: 16, chairs: 16, tables: 2, tableItemId: ROUND, round: true });
    if (offer === null) return;
    expect(seatShortfallActionLabel(offer)).toBe("Add tables for 16");
    expect(seatShortfallDetail(offer)).toBe("2 round tables with 16 chairs, 0.6 m clear behind every chair.");

    const fix = applySeatShortfallFix(input(layout, 36));
    if (fix === null) throw new Error("no fix");
    expect(seatingCountsFromPlacedItems(fix.placedItems).chairs).toBe(36);
    const added = fix.placedItems.filter((item) => fix.addedIds.includes(item.id));
    const newTables = added.filter((item) => item.catalogueItemId === ROUND);
    expect(newTables).toHaveLength(2);
    // Chairs are shared evenly: 8 and 8.
    for (const table of newTables) expect(chairsAt(fix.placedItems, table)).toBe(8);

    // Each new group keeps 0.6 m to every piece already on the floor and to the walls.
    const tableItem = getCatalogueItem(ROUND);
    if (tableItem === undefined) throw new Error("no table");
    const radius = tableGroupPlanningRadius(tableItem, 10);
    for (const table of newTables) {
      expect(HALL_W / 2 - Math.abs(table.x) - radius).toBeGreaterThanOrEqual(0.6 - 1e-9);
      expect(HALL_L / 2 - Math.abs(table.z) - radius).toBeGreaterThanOrEqual(0.6 - 1e-9);
      for (const existing of layout) {
        const item = getCatalogueItem(existing.catalogueItemId);
        if (item === undefined) continue;
        const extent = computeRotatedFootprint(item, existing.rotationY);
        const gap = Math.hypot(
          Math.max(0, Math.abs(table.x - existing.x) - extent.halfW),
          Math.max(0, Math.abs(table.z - existing.z) - extent.halfD),
        ) - radius;
        expect(gap).toBeGreaterThanOrEqual(0.6 - 1e-9);
      }
    }
    expect(seatShortfallDoneLine(fix.offer)).toBe("Added 2 tables and 16 chairs.");
  });

  it("says there is no room when the hall is full at this spacing", () => {
    const fill = planAutoFill("dinner-rounds", 220, HALL_W, HALL_L);
    if (fill === null || fill.style !== "dinner-rounds") throw new Error("no fill");
    const layout = groups(fill.tables.map((t) => [t.xM, t.zM] as const), 10);
    const offer = seatShortfallOffer(input(layout, 220));
    expect(offer).toEqual({ kind: "no-room", short: 80, guests: 220 });
    if (offer === null) return;
    expect(seatShortfallActionLabel(offer)).toBeNull();
    expect(seatShortfallDetail(offer)).toBe("The tables are full, and there is no room for another at this spacing.");
    expect(applySeatShortfallFix(input(layout, 220))).toBeNull();
  });
});

describe("seat shortfall: nothing to offer", () => {
  it("offers nothing when every guest has a seat or no count is set", () => {
    const layout = groups(OLD_FILL, 8);
    expect(seatShortfallOffer(input(layout, 64))).toBeNull();
    expect(seatShortfallOffer(input(layout, 20))).toBeNull();
    expect(seatShortfallOffer(input(layout, null))).toBeNull();
    expect(seatShortfallOffer(input(layout, Number.NaN))).toBeNull();
  });

  it("offers no table fix for rows of chairs or an empty floor", () => {
    const rows = Array.from({ length: 10 }, (_unused, i) => createPlacedItem(CHAIR, i * 0.6, 0, 0, null, 0));
    expect(seatShortfallOffer(input(rows, 40))).toBeNull();
    expect(seatShortfallOffer(input([], 40))).toBeNull();
    expect(applySeatShortfallFix(input([], 40))).toBeNull();
  });
});
