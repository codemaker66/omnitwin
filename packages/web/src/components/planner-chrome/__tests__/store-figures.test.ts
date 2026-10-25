import { describe, expect, it } from "vitest";
import { cardNeeds, type UsableStock } from "../../../lib/card-stock.js";
import { cardParamsFor, type CardParams } from "../../../lib/setup-cards.js";
import { NONE_LEFT_IN_STORE, seesStoreFigures, storeFace } from "../store-figures.js";

// ---------------------------------------------------------------------------
// The store on the cards (T-671; card-dock spec §4.1, §4.2, §17.1; Blake's
// B2, hard): staff see "×22 in store"; an empty store reads "None left in
// store" and refuses; a piece with no stock record shows nothing; clients
// and guests never see a figure.
// ---------------------------------------------------------------------------

function roundOf10(): CardParams {
  const params = cardParamsFor("round", { seats: 10 });
  if (params === null) throw new Error("no round card");
  return params;
}

/** Stock that allows exactly `whole` more Rounds of 10. */
function stockFor(params: CardParams, whole: number): UsableStock {
  return new Map([...cardNeeds(params)].map(([id, need]) => [id, need * whole]));
}

describe("a card's store face", () => {
  it("says how many more the store allows, in the spec's words", () => {
    const params = roundOf10();
    expect(storeFace(params, stockFor(params, 22), new Map())).toEqual({ line: "×22 in store", spoken: "22 in store", refused: false });
  });

  it("counts what this layout already holds against the store", () => {
    const params = roundOf10();
    const placed = new Map([...cardNeeds(params)]);
    expect(storeFace(params, stockFor(params, 3), placed)?.line).toBe("×2 in store");
  });

  it("refuses at none left (B2 hard), and says so", () => {
    const params = roundOf10();
    expect(storeFace(params, stockFor(params, 0), new Map())).toEqual({ line: NONE_LEFT_IN_STORE, spoken: "none left in store", refused: true });
    expect(NONE_LEFT_IN_STORE).toBe("None left in store");
  });

  it("shows nothing without stock, or for a piece with no stock record", () => {
    const params = roundOf10();
    expect(storeFace(params, null, new Map())).toBeNull();
    expect(storeFace(params, new Map(), new Map())).toBeNull();
    expect(storeFace(null, stockFor(params, 4), new Map())).toBeNull();
  });
});

describe("who sees the store", () => {
  const venue = "00000000-0000-4000-8000-000000000001";
  it("is the venue's own staff, the roles the inventory route admits", () => {
    for (const role of ["admin", "manager", "staff", "hallkeeper", "planner"]) {
      expect(seesStoreFigures({ role, venueId: venue }, venue), role).toBe(true);
    }
  });

  it("is never a client, a guest, another venue's staff, or no one", () => {
    expect(seesStoreFigures({ role: "client", venueId: venue }, venue)).toBe(false);
    expect(seesStoreFigures({ role: "guest", venueId: null }, venue)).toBe(false);
    expect(seesStoreFigures({ role: "staff", venueId: "00000000-0000-4000-8000-000000000002" }, venue)).toBe(false);
    expect(seesStoreFigures({ role: "staff", venueId: venue }, null)).toBe(false);
    expect(seesStoreFigures(null, venue)).toBe(false);
  });
});
