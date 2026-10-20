import { describe, it, expect } from "vitest";
import { TRADES_HALL_ROOM_CAPACITIES } from "@omnitwin/types";
import { buildEvidencePack, type EvidenceCheck } from "../cockpit-evidence-model.js";
import { PUBLISHED_CAPACITY_LABEL, type PublishedCapacityAnswer } from "../planner-truth.js";
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

const GRAND_HALL: PublishedCapacityAnswer = {
  kind: "published",
  capacity: TRADES_HALL_ROOM_CAPACITIES["grand-hall"],
  source: PUBLISHED_CAPACITY_LABEL,
};
const ROOM = { roomWidthM: 21, roomLengthM: 10.5, published: GRAND_HALL } as const;
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];
const byId = (checks: readonly EvidenceCheck[], id: string): EvidenceCheck => {
  const c = checks.find((check) => check.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};

describe("buildEvidencePack — no pass, only what is recorded", () => {
  it("never returns a pass status, whatever the layout", () => {
    for (const guests of [null, 40, 80, 180, 400]) {
      const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: guests });
      for (const check of pack.checks) {
        expect(["review", "noted", "not-recorded", "reading"]).toContain(check.status);
      }
      expect(Object.keys(pack)).not.toContain("passCount");
    }
  });

  it("notes seating when every guest has a seat, and reviews a shortfall", () => {
    expect(byId(buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 80 }).checks, "seating").status).toBe("noted");
    const short = byId(buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 120 }).checks, "seating");
    expect(short.status).toBe("review");
    expect(short.detail).toMatch(/Short 40 seats/);
  });

  it("reads the guest count against the published dinner figure, with its source", () => {
    const capacity = byId(buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 80 }).checks, "capacity");
    expect(capacity.status).toBe("noted");
    expect(capacity.detail).toBe("Published 180 for dinner.");
    expect(capacity.source).toBe("Published guide · Trades Hall · 9 Jul 2026");
  });

  it("reviews a count above the published figure and asks about it", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(200), guestCount: 200 });
    const capacity = byId(pack.checks, "capacity");
    expect(capacity.status).toBe("review");
    expect(capacity.detail).toBe("200 guests is more than the published 180 for dinner.");
    expect(capacity.ask).toEqual({ kind: "headcount", guests: 200, figure: 180, formatLabel: "dinner" });
    expect(pack.reviewCount).toBe(1);
  });

  it("says the capacity is not recorded for a room with no published figure", () => {
    const capacity = byId(
      buildEvidencePack({ ...ROOM, published: { kind: "not-published" }, placedItems: withChairs(80), guestCount: 80 }).checks,
      "capacity",
    );
    expect(capacity.status).toBe("not-recorded");
    expect(capacity.ask).toBe("room-capacity");
  });

  it("waits honestly while the venue's figures are being read", () => {
    const capacity = byId(
      buildEvidencePack({ ...ROOM, published: { kind: "reading" }, placedItems: withChairs(80), guestCount: 80 }).checks,
      "capacity",
    );
    expect(capacity.status).toBe("reading");
  });

  it("shows escape routes as not recorded, asks about them, and cites no other country's code", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: withChairs(80), guestCount: 80 });
    const escape = byId(pack.checks, "escape-routes");
    expect(escape.status).toBe("not-recorded");
    expect(escape.ask).toBe("escape-routes");
    expect(escape.detail).toContain("fire risk assessment");
    for (const check of pack.checks) {
      expect(check.detail).not.toMatch(/ADB|Approved Document|NFPA|BS 9999|≥ \d+ escape route|mm total clear/);
    }
    expect(pack.notRecordedCount).toBe(1);
  });

  it("asks for seating rather than reading an empty floor against a format", () => {
    const pack = buildEvidencePack({ ...ROOM, placedItems: [], guestCount: null });
    expect(byId(pack.checks, "seating").status).toBe("noted");
    expect(byId(pack.checks, "capacity").detail).toBe("Add seating to read the layout against the published figures.");
    expect(pack.reviewCount).toBe(0);
    expect(pack.hasGuestCount).toBe(false);
  });
});
