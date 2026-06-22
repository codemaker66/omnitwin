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
// (comfortable 1.5 m²/guest → comfortable capacity 140).
const ROOM = { roomWidthM: 21, roomLengthM: 10 } as const;
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];

describe("buildGuestsCapacityModel — seat sufficiency", () => {
  it("is unset until a guest count is given, assessing the room against placed seats", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: null });
    expect(model.guestCount).toBeNull();
    expect(model.seatsProvided).toBe(80);
    expect(model.seatBalance).toBeNull();
    expect(model.seatStatus).toBe("unset");
    expect(model.assessedHeadcount).toBe(80);
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

describe("buildGuestsCapacityModel — room comfort", () => {
  it("computes comfortable capacity and a spacious band for a light room", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    expect(model.comfortableCapacity).toBe(140); // 210 / 1.5
    expect(model.band).toBe("spacious"); // 210 / 80 = 2.625 ≥ 2.1
    expect(model.utilizationPercent).toBe(57); // round(80 / 140 * 100)
    expect(model.bandLabel).toMatch(/spacious/i);
  });

  it("flags over comfortable capacity for a packed headcount", () => {
    const model = buildGuestsCapacityModel({ ...ROOM, placedItems: withChairs(80), guestCount: 220 });
    expect(model.band).toBe("over-capacity"); // 210 / 220 = 0.95 < 1.1
    expect(model.bandLabel).toMatch(/over comfortable/i);
    expect(model.seatStatus).toBe("short");
  });

  it("treats a missing room as zero floor area without throwing", () => {
    const model = buildGuestsCapacityModel({ roomWidthM: 0, roomLengthM: 0, placedItems: [], guestCount: 50 });
    expect(model.floorAreaM2).toBe(0);
    expect(model.comfortableCapacity).toBe(0);
    expect(model.seatsProvided).toBe(0);
    expect(model.seatStatus).toBe("short");
  });
});
