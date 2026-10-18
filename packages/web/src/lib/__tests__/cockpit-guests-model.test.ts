import { describe, it, expect } from "vitest";
import {
  buildGuestsCapacityModel,
  seatSufficiencyLabel,
} from "../cockpit-guests-model.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, groupId: null,
  }));
}

// 21 × 10 m = 210 m² floor. Round tables force the dinner-rounds style
// (generic 1.5 m²/guest → an estimate of 140, staff-only and never a verdict).
const ROOM = { roomWidthM: 21, roomLengthM: 10 } as const;
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];

describe("buildGuestsCapacityModel — seat sufficiency", () => {
  it("is unset until a guest count is given, assessing the room against placed seats", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: null });
    expect(model.guestCount).toBeNull();
    expect(model.seatsProvided).toBe(80);
    expect(model.seatBalance).toBeNull();
    expect(model.seatStatus).toBe("unset");
    expect(model.layoutStyle).toBe("dinner-rounds");
    expect(model.styleLabel).toMatch(/round/i);
  });

  it("reports exact seating when seats equal guests", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    expect(model.seatBalance).toBe(0);
    expect(model.seatStatus).toBe("exact");
    expect(seatSufficiencyLabel(model)).toBe("Exactly 80 seats for 80 guests — every guest seated.");
  });

  it("reports spare seats when there are more seats than guests", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(90), guestCount: 80 });
    expect(model.seatBalance).toBe(10);
    expect(model.seatStatus).toBe("spare");
    expect(seatSufficiencyLabel(model)).toMatch(/10 spare seats/);
  });

  it("reports a seat shortfall when guests exceed seats", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: 120 });
    expect(model.seatBalance).toBe(-40);
    expect(model.seatStatus).toBe("short");
    expect(seatSufficiencyLabel(model)).toMatch(/Short 40 seats for 120 guests/);
  });
});

describe("buildGuestsCapacityModel — the published format, and no verdict", () => {
  it("reads round tables against the venue's published dinner figure", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    expect(model.layoutStyle).toBe("dinner-rounds");
    expect(model.publishedFormat).toBe("dinner");
  });

  it("reads chairs alone against the published theatre figure", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: place(chair(), 40), guestCount: null });
    expect(model.publishedFormat).toBe("theatre");
  });

  it("has no published format for an empty floor", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: [], guestCount: 50 });
    expect(model.layoutStyle).toBe("custom");
    expect(model.publishedFormat).toBeNull();
  });

  it("carries the generic-spacing arithmetic for staff, with no band, fit or comfort verdict", () => {
    const model = buildGuestsCapacityModel({ roomWidthM: 21, roomLengthM: 10.5, placedItems: withChairs(80), guestCount: 400 });
    const byStyle = new Map(model.estimates.map((row) => [row.style, row.estimate]));
    // The Grand Hall's 220.5 m² at 0.65, 1.5 and 0.8 m² a guest.
    expect(byStyle.get("cocktail")).toBe(339);
    expect(byStyle.get("dinner-rounds")).toBe(147);
    expect(byStyle.get("theatre")).toBe(275);
    const keys = Object.keys(model);
    for (const banned of ["band", "bandLabel", "comfortableCapacity", "tightCapacity", "utilizationPercent", "styleSummary"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("treats a missing room as zero floor area without throwing", () => {
    const model = buildGuestsCapacityModel({ roomWidthM: 0, roomLengthM: 0, placedItems: [], guestCount: 50 });
    expect(model.floorAreaM2).toBe(0);
    expect(model.estimates.every((row) => row.estimate === 0)).toBe(true);
    expect(model.seatsProvided).toBe(0);
    expect(model.seatStatus).toBe("short");
  });
});
