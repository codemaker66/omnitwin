import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupCardPreviewUrl } from "../crafted-furniture.js";
import { setPlannerFeaturesForTesting } from "../planner-features.js";
import {
  SETUP_CARD_IDS,
  cardIdOf,
  cardMainItem,
  cardMainSlug,
  cardParamsFor,
  cardParamsRequest,
  describeCard,
  isSetupCardId,
  pieceCardId,
  pieceCardSlug,
  seatsInHand,
  stepCardParams,
  type CardParams,
} from "../setup-cards.js";

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

function paramsFor(...args: Parameters<typeof cardParamsFor>): CardParams {
  const params = cardParamsFor(...args);
  if (params === null) throw new Error(`no params for ${args[0]}`);
  return params;
}

describe("card ids", () => {
  it("names a piece card by its slug and reads it back", () => {
    expect(pieceCardId("bar-counter")).toBe("piece:bar-counter");
    expect(pieceCardSlug("piece:bar-counter")).toBe("bar-counter");
    expect(pieceCardSlug("round")).toBeNull();
  });

  it("knows the setup cards", () => {
    for (const id of SETUP_CARD_IDS) expect(isSetupCardId(id)).toBe(true);
    expect(isSetupCardId("piece:platform")).toBe(false);
  });

  it("gives back the id a card's parameters came from", () => {
    for (const id of [...SETUP_CARD_IDS, pieceCardId("lectern")]) expect(cardIdOf(paramsFor(id))).toBe(id);
  });
});

describe("Round of N", () => {
  it("is a white-clothed 6 ft round of ten by default", () => {
    const params = paramsFor("round");
    expect(params).toEqual({ card: "round", seats: 10, colourway: "white" });
    expect(cardMainSlug(params)).toBe("round-table-6ft-white");
    expect(describeCard(params)).toEqual({ name: "Round of 10", size: "1.83 m round", seats: 10 });
  });

  it("keeps its seats between eight and twelve", () => {
    expect(paramsFor("round", { seats: 20 })).toMatchObject({ seats: 12 });
    expect(paramsFor("round", { seats: 2 })).toMatchObject({ seats: 8 });
    const twelve = paramsFor("round", { seats: 12 });
    expect(stepCardParams(twelve, 1)).toBe(twelve);
    expect(stepCardParams(twelve, -1)).toMatchObject({ seats: 11 });
  });

  it("starts from the seats last chosen this session", () => {
    expect(paramsFor("round", {}, { "round-table-6ft": 12 })).toMatchObject({ seats: 12 });
  });

  it("offers white, black and bare, and nothing else", () => {
    expect(cardMainSlug(paramsFor("round", { colourway: "black" }))).toBe("round-table-6ft-black");
    expect(cardMainSlug(paramsFor("round", { colourway: "bare" }))).toBe("round-table-6ft");
    expect(paramsFor("round", { colourway: "wood" })).toMatchObject({ colourway: "white" });
  });
});

describe("Dance floor", () => {
  it("is 5 × 5 panels, 4.6 m square, seating nobody", () => {
    const params = paramsFor("dance-floor");
    expect(params).toEqual({ card: "dance-floor", cols: 5, rows: 5 });
    expect(cardMainSlug(params)).toBe("dancefloor-panel");
    expect(describeCard(params)).toEqual({ name: "Dance floor", size: "4.6 m square", seats: 0 });
  });

  it("states width by depth when it is not square", () => {
    expect(describeCard(paramsFor("dance-floor", { cols: 6, rows: 5 })).size).toBe("5.5 × 4.6 m");
  });

  it("grows and shrinks a panel each way, within 2 to 12 a side", () => {
    expect(stepCardParams(paramsFor("dance-floor"), 1)).toMatchObject({ cols: 6, rows: 6 });
    expect(paramsFor("dance-floor", { cols: 40, rows: 1 })).toMatchObject({ cols: 12, rows: 2 });
  });
});

describe("Top table and Long table", () => {
  it("set down one trestle until they are built as sets", () => {
    expect(describeCard(paramsFor("top-table"))).toEqual({ name: "Top table", size: "1.8 m", seats: 3 });
    expect(describeCard(paramsFor("long-table"))).toEqual({ name: "Long table", size: "1.8 m", seats: 6 });
    const one = paramsFor("long-table");
    expect(stepCardParams(one, 1)).toBe(one);
  });

  it("run four trestles, 7.3 m, once tableSets is on", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    expect(describeCard(paramsFor("top-table"))).toEqual({ name: "Top table", size: "7.3 m", seats: 12 });
    expect(describeCard(paramsFor("long-table"))).toEqual({ name: "Long table", size: "7.3 m", seats: 24 });
  });

  it("take two to six trestles at the top table", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    expect(paramsFor("top-table", { trestles: 9 })).toMatchObject({ trestles: 6 });
    expect(stepCardParams(paramsFor("top-table", { trestles: 2 }), -1)).toMatchObject({ trestles: 2 });
  });

  it("offer the wooden trestle", () => {
    expect(cardMainSlug(paramsFor("long-table", { colourway: "wood" }))).toBe("trestle-6ft-wooden");
  });
});

describe("piece cards", () => {
  it("carry a dining table's seats", () => {
    const params = paramsFor(pieceCardId("trestle-6ft-black"));
    expect(params).toEqual({ card: "piece", slug: "trestle-6ft-black", seats: 6 });
    expect(seatsInHand(params)).toBe(6);
    expect(stepCardParams(params, 1)).toMatchObject({ seats: 7 });
  });

  it("share remembered seats with their base table", () => {
    expect(paramsFor(pieceCardId("round-table-6ft-black"), {}, { "round-table-6ft": 9 })).toMatchObject({ seats: 9 });
  });

  it("seat nobody at a piece that is not seated dining", () => {
    const params = paramsFor(pieceCardId("platform"));
    expect(params).toEqual({ card: "piece", slug: "platform", seats: null });
    expect(stepCardParams(params, 1)).toBe(params);
    expect(describeCard(params)).toEqual({ name: "Platform", size: "2.4 × 1.2 m", seats: 0 });
  });

  it("size a round piece by its diameter", () => {
    expect(describeCard(paramsFor(pieceCardId("cake-cutting-table"))).size).toBe("1.1 m round");
  });

  it("refuse a slug the catalogue does not hold", () => {
    expect(cardParamsFor(pieceCardId("no-such-piece"))).toBeNull();
  });
});

describe("every card", () => {
  it("is built round a piece the catalogue holds", () => {
    setPlannerFeaturesForTesting({ tableSets: true });
    for (const id of SETUP_CARD_IDS) expect(cardMainItem(paramsFor(id))).toBeDefined();
  });

  it("round-trips its parameters through a request", () => {
    for (const id of [...SETUP_CARD_IDS, pieceCardId("trestle-4ft"), pieceCardId("lectern")]) {
      const params = paramsFor(id);
      expect(paramsFor(id, cardParamsRequest(params))).toEqual(params);
    }
  });

  it.each(SETUP_CARD_IDS)("ships a rendered picture for the %s card", (card) => {
    const url = setupCardPreviewUrl(card);
    expect(url).toBe(`/models/furniture/setup/${card}/setup-v1/preview.webp`);
    const file = resolve(import.meta.dirname, "../../../public", `.${url}`);
    expect(existsSync(file), file).toBe(true);
  });
});
