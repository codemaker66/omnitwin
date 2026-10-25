import { afterEach, describe, expect, it } from "vitest";
import type { VenueInventoryData } from "../../api/venue-inventory.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  cardNeeds,
  cardStoreFigure,
  placedCounts,
  stockIdentity,
  storeRefuses,
  storeShortfall,
  storeShortfallWords,
  usableStock,
  type UsableStock,
} from "../card-stock.js";
import type { PlacedItem } from "../placement.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParams, type CardParamsRequest } from "../setup-cards.js";

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

function id(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`${slug} missing`);
  return item.id;
}

function params(card: CardId, asked: CardParamsRequest = {}): CardParams {
  const found = cardParamsFor(card, asked);
  if (found === null) throw new Error(`no ${card}`);
  return found;
}

let serial = 0;
/** One card's pieces with fresh ids. */
function stamp(card: CardParams, x = 0): readonly PlacedItem[] {
  return stampSetup(card, { x, z: 0 }, 0, () => {
    serial += 1;
    return `p${String(serial)}`;
  });
}

/** `count` of a piece on its own (its seats stripped), as a layout holds them. */
function only(slug: string, count: number): readonly PlacedItem[] {
  return Array.from({ length: count }, (_, i) => stamp(params(`piece:${slug}`), i * 3).filter((piece) => piece.catalogueItemId === id(slug))).flat();
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

// As the stock import writes it (api/src/scripts/import-venue-stock.ts): records on the bare tables.
const STOCK: UsableStock = usableStock(inventory([
  record("round-table-6ft", 30),
  record("burgess-turini-18-3", 230, 6, 4),
  record("trestle-6ft", 30),
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

  it("counts a clothed table as the bare table the store holds, and pools nothing else", () => {
    expect(stockIdentity(id("round-table-6ft-white"))).toBe(id("round-table-6ft"));
    expect(stockIdentity(id("round-table-6ft-black"))).toBe(id("round-table-6ft"));
    expect(stockIdentity(id("trestle-6ft-white"))).toBe(id("trestle-6ft"));
    expect(stockIdentity(id("trestle-6ft-wooden"))).toBe(id("trestle-6ft-wooden"));
    expect(stockIdentity(id("burgess-turini-18-3"))).toBe(id("burgess-turini-18-3"));
  });

  it("takes a bare table's own record, else the largest clothed record, never their sum", () => {
    const both = usableStock(inventory([record("round-table-6ft", 30), record("round-table-6ft-white", 30)]));
    expect(both.get(id("round-table-6ft"))).toBe(30);
    expect(both.has(id("round-table-6ft-white"))).toBe(false);
    const clothedOnly = usableStock(inventory([record("round-table-6ft-white", 12), record("round-table-6ft-black", 20)]));
    expect(clothedOnly.get(id("round-table-6ft"))).toBe(20);
  });
});

describe("a card's store figure", () => {
  it("is the fewest whole cards any piece allows, beyond what the layout holds", () => {
    expect(cardNeeds(params("round"))).toEqual(new Map([[id("round-table-6ft"), 1], [id("burgess-turini-18-3"), 10]]));
    expect(cardStoreFigure(params("round"), STOCK, new Map())).toBe(22);
    expect(cardStoreFigure(params("round"), STOCK, placedCounts([...stamp(params("round")), ...stamp(params("round"))]))).toBe(20);
  });

  it("draws every cloth from the same tables", () => {
    const tables = [...only("round-table-6ft-white", 15), ...only("round-table-6ft-black", 15)];
    expect(cardStoreFigure(params("round"), STOCK, placedCounts(tables))).toBe(0);
    expect(cardStoreFigure(params("piece:round-table-6ft"), STOCK, placedCounts(tables))).toBe(0);
    expect(storeRefuses(params("round", { colourway: "black" }), STOCK, placedCounts(tables))).toBe(true);
  });

  it("shows whole sets, Top table and Long table sharing the trestles", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    expect(cardStoreFigure(params("top-table"), STOCK, new Map())).toBe(7);
    expect(cardStoreFigure(params("long-table"), STOCK, new Map())).toBe(7);
    expect(cardStoreFigure(params("long-table"), STOCK, placedCounts(stamp(params("top-table"))))).toBe(6);
  });

  it("counts a dance floor in panels", () => {
    expect(cardStoreFigure(params("dance-floor"), STOCK, new Map())).toBe(1);
  });

  it("gives no figure when a piece it needs has no record, the wooden trestle included", () => {
    expect(cardStoreFigure(params("piece:lectern"), STOCK, new Map())).toBeNull();
    expect(cardStoreFigure(params("long-table", { colourway: "wood" }), STOCK, new Map())).toBeNull();
  });
});

describe("the hard limit (B2)", () => {
  it("refuses only when the store has none left, never on unknown stock", () => {
    const full = placedCounts(stamp({ card: "dance-floor", cols: 6, rows: 6 }));
    expect(storeRefuses(params("dance-floor"), STOCK, full)).toBe(true);
    expect(storeRefuses(params("dance-floor"), STOCK, new Map())).toBe(false);
    expect(storeRefuses(params("piece:lectern"), STOCK, new Map())).toBe(false);
    expect(storeRefuses(params("dance-floor"), null, full)).toBe(false);
  });

  it("holds the pieces with a record even when another piece of the card has none", () => {
    const chairsOnly = usableStock(inventory([record("burgess-turini-18-3", 220)]));
    const chairs = placedCounts(only("burgess-turini-18-3", 220));
    expect(cardStoreFigure(params("round"), chairsOnly, chairs)).toBeNull();
    expect(storeRefuses(params("round"), chairsOnly, chairs)).toBe(true);
    expect(storeRefuses(params("round"), chairsOnly, placedCounts(only("burgess-turini-18-3", 210)))).toBe(false);
  });

  it("refuses any change that takes a piece past its stock: 4 rounds of 10 into 2 long tables needs 48 chairs", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    const forty = usableStock(inventory([record("round-table-6ft", 30), record("burgess-turini-18-3", 40), record("trestle-6ft", 30)]));
    const rounds = [0, 4, 8, 12].flatMap((x) => stamp(params("round"), x));
    const longTables = [...stamp(params("long-table"), 0), ...stamp(params("long-table"), 10)];
    const change = { removeIds: new Set(rounds.map((piece) => piece.id)), add: longTables };
    const shortfall = storeShortfall(forty, rounds, change);
    expect(shortfall).toEqual({ catalogueItemId: id("burgess-turini-18-3"), usable: 40, needed: 48 });
    expect(shortfall === null ? "" : storeShortfallWords(shortfall)).toBe("Velvet Banquet Chair: 40 in store, this needs 48");
    // Two rounds of 12 in place of four rounds of 10 fit, as does a re-cloth that keeps every id.
    const twelves = [...stamp(params("round", { seats: 12 }), 0), ...stamp(params("round", { seats: 12 }), 4)];
    expect(storeShortfall(forty, rounds, { removeIds: change.removeIds, add: twelves })).toBeNull();
    const reclothed = rounds.map((piece) => (piece.catalogueItemId === id("round-table-6ft-white") ? { ...piece, catalogueItemId: id("round-table-6ft-black") } : piece));
    expect(storeShortfall(forty, rounds, { add: reclothed })).toBeNull();
  });

  it("lets a layout already over its stock change anything it does not add more of", () => {
    const thirty = usableStock(inventory([record("burgess-turini-18-3", 30), record("dancefloor-panel", 36)]));
    const rounds = [0, 4, 8, 12].flatMap((x) => stamp(params("round"), x));
    expect(storeShortfall(thirty, rounds, { add: stamp(params("dance-floor"), 20) })).toBeNull();
    expect(storeShortfall(thirty, rounds, { add: only("burgess-turini-18-3", 1) })).toEqual({ catalogueItemId: id("burgess-turini-18-3"), usable: 30, needed: 41 });
    expect(storeShortfall(null, rounds, { add: only("burgess-turini-18-3", 1) })).toBeNull();
  });
});
