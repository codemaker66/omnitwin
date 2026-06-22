import { describe, it, expect } from "vitest";
import { buildEvidencePack, type EvidenceCheck } from "../cockpit-evidence-model.js";
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

const ROOM = { roomWidthM: 21, roomLengthM: 10 } as const; // 210 m², comfortable 140 (rounds)
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];
const byId = (checks: readonly EvidenceCheck[], id: string): EvidenceCheck => {
  const c = checks.find((check) => check.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};

describe("buildEvidencePack", () => {
  it("passes seating and comfort when the room fits the headcount", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    expect(byId(pack.checks, "seating").status).toBe("pass");
    expect(byId(pack.checks, "comfort").status).toBe("pass");
    expect(byId(pack.checks, "egress").status).toBe("review");
    expect(pack.passCount).toBe(2);
    expect(pack.reviewCount).toBe(1);
    expect(pack.hasGuestCount).toBe(true);
    expect(pack.assessedHeadcount).toBe(80);
  });

  it("flags a seating shortfall as review", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 120 });
    expect(byId(pack.checks, "seating").status).toBe("review");
    expect(byId(pack.checks, "seating").detail).toMatch(/Short 40 seats/);
  });

  it("flags an over-capacity room as review", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 220 });
    expect(byId(pack.checks, "comfort").status).toBe("review");
    expect(byId(pack.checks, "comfort").detail).toMatch(/over comfortable/i);
  });

  it("states the ADB egress reference for the headcount", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    const egress = byId(pack.checks, "egress");
    expect(egress.detail).toMatch(/≥ 2 escape routes/);
    expect(egress.detail).toMatch(/850 mm/);
    expect(egress.detail).toMatch(/Confirm against this room's actual exits/);
  });

  it("uses singular routes wording for small rooms", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(50), guestCount: 50 });
    expect(byId(pack.checks, "egress").detail).toMatch(/≥ 1 escape route\b/);
  });

  it("is all-informational for an empty layout with no guest count", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: [], guestCount: null });
    expect(byId(pack.checks, "seating").status).toBe("info");
    expect(byId(pack.checks, "comfort").status).toBe("info");
    expect(byId(pack.checks, "egress").status).toBe("info");
    expect(pack.passCount).toBe(0);
    expect(pack.reviewCount).toBe(0);
    expect(pack.hasGuestCount).toBe(false);
  });
});
