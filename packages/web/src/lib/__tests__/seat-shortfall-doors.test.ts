import { describe, expect, it } from "vitest";
import { applySeatShortfallFix, seatShortfallDetail, seatShortfallOffer, type SeatShortfallInput } from "../seat-shortfall.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { computeRotatedFootprint, type PlacedItem } from "../placement.js";
import { createTableGroup } from "../table-group.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES, doorKeepOuts, footprintInSpace } from "../door-clear-spaces.js";

// One round of ten at (0, −0.75) in the Grand Hall (21 × 10.5 m) and 20
// guests: the floor is short 10 seats and the round is full, so the fix adds
// a round. It looks for free floor nearest the middle, on a 0.25 m lattice,
// 0.6 m from every chair and wall. Worked by hand: the nearest such spot is
// (0, 3.0), 3.75 m from the round (two group radii of 1.559 m and 0.6 m
// between them need 3.718 m), and a round there reaches z 4.56, into the
// main door's clear space (z from 3.795, x −1.02 to 1.03).

const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "";

function input(placedItems: readonly PlacedItem[], doors: boolean): SeatShortfallInput {
  return {
    placedItems,
    guests: 20,
    roomWidthM: 21,
    roomLengthM: 10.5,
    ...(doors ? { doorSpaces: doorKeepOuts(GRAND_HALL_DOOR_CLEAR_SPACES) } : {}),
  };
}

function added(placedItems: readonly PlacedItem[], doors: boolean): readonly PlacedItem[] {
  const fix = applySeatShortfallFix(input(placedItems, doors));
  if (fix === null) throw new Error("no fix");
  const ids = new Set(fix.addedIds);
  return fix.placedItems.filter((item) => ids.has(item.id));
}

function inDoorSpace(piece: PlacedItem): boolean {
  const item = getCatalogueItem(piece.catalogueItemId);
  if (item === undefined) throw new Error(`no catalogue item ${piece.catalogueItemId}`);
  const { halfW, halfD } = computeRotatedFootprint(item, piece.rotationY, piece.scale);
  return GRAND_HALL_DOOR_CLEAR_SPACES.some((space) => footprintInSpace({ x: piece.x, z: piece.z, halfW, halfD }, space));
}

describe("seat shortfall keeps the doors clear", () => {
  const layout = [...createTableGroup(ROUND, 0, -0.75, 0, 10)];

  it("would add the round in front of the main door without the rule", () => {
    const table = added(layout, false).find((piece) => piece.catalogueItemId === ROUND);
    expect([table?.x, table?.z]).toEqual([0, 3]);
    expect(added(layout, false).some(inDoorSpace)).toBe(true);
  });

  it("adds the round where no table or chair stands in front of a door", () => {
    const pieces = added(layout, true);
    expect(pieces.filter((piece) => piece.catalogueItemId === ROUND)).toHaveLength(1);
    expect(pieces.some(inDoorSpace)).toBe(false);
  });

  it("offers what it will add with the doors kept clear", () => {
    expect(seatShortfallOffer(input(layout, true))).toMatchObject({ kind: "tables", tables: 1, chairs: 10 });
  });

  it("says when keeping the doors clear is what leaves no room for another table", () => {
    // A door space over the whole floor stands in for a room whose only free floor is in front of its doors.
    const everywhere = { cx: 0, cz: 0, width: 21, depth: 10.5 };
    const offer = seatShortfallOffer({ ...input(layout, false), doorSpaces: [everywhere] });
    expect(offer).toEqual({ kind: "no-room", short: 10, guests: 20, doorsKeptClear: true });
    if (offer === null) return;
    expect(seatShortfallDetail(offer)).toBe("The tables are full, and there is no room for another at this spacing with the doors kept clear.");
  });
});

describe("adding chairs at a table beside a door", () => {
  // A round of six whose fireplace-side chairs stand 5 cm clear of the fire
  // exit's space (to x −9.0675): rung for ten, two of them would reach into it
  // (the correctness review of 28 Oct 2026).
  const round6 = createTableGroup(ROUND, -7.575, -3.235, 0, 6);
  const fix = (doors: boolean): readonly PlacedItem[] => {
    const applied = applySeatShortfallFix({ ...input(round6, doors), guests: 10 });
    if (applied === null) throw new Error("no fix");
    return applied.placedItems;
  };

  it("would ring chairs into the fire exit's space without the rule", () => {
    expect(round6.some(inDoorSpace)).toBe(false);
    expect(fix(false).some(inDoorSpace)).toBe(true);
  });

  it("adds no chair in front of a door, and seats the guests another way", () => {
    const after = fix(true);
    expect(after.some(inDoorSpace)).toBe(false);
    expect(after.filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair").length).toBeGreaterThanOrEqual(10);
  });
});
