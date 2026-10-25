import { afterEach, describe, expect, it } from "vitest";
import type { VenueInventoryData } from "../../api/venue-inventory.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { cardNeeds, cardStoreFigure, placedCounts, storeRefuses, usableStock, type UsableStock } from "../card-stock.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParams } from "../setup-cards.js";

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`${slug} missing`);
  return item.id;
}

function params(card: CardId): CardParams {
  const found = cardParamsFor(card);
  if (found === null) throw new Error(`no ${card}`);
  return found;
}

const VENUE = "00000000-0000-4000-8000-000000000001";

function record(slug: string, owned: number, damaged = 0, unavailable = 0, status: "active" | "retired" = "active"): VenueInventoryData["items"][number] {
  return {
    catalogue: { id: id(slug), name: slug, category: "table" },
    stock: {
      venueId: VENUE, assetDefinitionId: id(slug), revision: 1,
      ownedQuantity: owned, damagedQuantity: damaged, unavailableQuantity: unavailable,
      hires: [], storageLocation: null, status, effectiveAt: "2026-10-25T00:00:00.000Z",
    },
  };
}

function inventory(items: VenueInventoryData["items"]): VenueInventoryData {
  return { items, availability: { status: "requires_assessment", reason: "TIME_WINDOW_REQUIRED" } };
}

const STOCK: UsableStock = usableStock(inventory([
  record("round-table-6ft-white", 30),
  record("burgess-turini-18-3", 230, 6, 4),
  record("trestle-6ft-white", 30),
  record("dancefloor-panel", 36),
]));

describe("usable stock", () => {
  it("counts owned less damaged and unavailable, nothing when retired, and skips pieces with no record", () => {
    const stock = usableStock(inventory([
      record("lectern", 4, 1, 1),
      record("bar-counter", 2, 0, 0, "retired"),
      { catalogue: { id: id("platform"), name: "Platform", category: "stage" }, stock: null },
    ]));
    expect(stock.get(id("lectern"))).toBe(2);
    expect(stock.get(id("bar-counter"))).toBe(0);
    expect(stock.has(id("platform"))).toBe(false);
  });
});

describe("a card's store figure", () => {
  it("is the fewest whole cards any piece allows, beyond what the layout holds", () => {
    expect(cardNeeds(params("round"))).toEqual(new Map([[id("round-table-6ft-white"), 1], [id("burgess-turini-18-3"), 10]]));
    expect(cardStoreFigure(params("round"), STOCK, new Map())).toBe(22);
    const room = stampSetup(params("round"), { x: 0, z: 0 }, 0);
    expect(cardStoreFigure(params("round"), STOCK, placedCounts([...room, ...room.map((piece) => ({ ...piece, id: `${piece.id}-b` }))]))).toBe(20);
  });

  it("shows whole sets, Top table and Long table sharing the trestles", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    expect(cardStoreFigure(params("top-table"), STOCK, new Map())).toBe(7);
    expect(cardStoreFigure(params("long-table"), STOCK, new Map())).toBe(7);
    const top = stampSetup(params("top-table"), { x: 0, z: 0 }, 0);
    expect(cardStoreFigure(params("long-table"), STOCK, placedCounts(top))).toBe(6);
  });

  it("counts a dance floor in panels", () => {
    expect(cardStoreFigure(params("dance-floor"), STOCK, new Map())).toBe(1);
  });

  it("gives no figure when a piece it needs has no record", () => {
    expect(cardStoreFigure(params("piece:lectern"), STOCK, new Map())).toBeNull();
  });
});

describe("the hard limit (B2)", () => {
  it("refuses only when the store has none left, never on unknown stock", () => {
    const full = placedCounts(stampSetup({ card: "dance-floor", cols: 6, rows: 6 }, { x: 0, z: 0 }, 0));
    expect(storeRefuses(params("dance-floor"), STOCK, full)).toBe(true);
    expect(storeRefuses(params("dance-floor"), STOCK, new Map())).toBe(false);
    expect(storeRefuses(params("piece:lectern"), STOCK, new Map())).toBe(false);
    expect(storeRefuses(params("dance-floor"), null, full)).toBe(false);
  });
});
