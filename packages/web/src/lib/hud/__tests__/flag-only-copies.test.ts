import { describe, expect, it } from "vitest";
import { getCatalogueByCategory } from "../../catalogue.js";
import { setupCardPreviewUrl } from "../../crafted-furniture.js";
import { CARD_COLOURWAYS, cardParamsFor, setupCardLooks, trestleRange, type CardParams } from "../../setup-cards.js";
import { SPRING_PRESETS } from "../../springs.js";
import { handCardPictureUrl } from "../card-pictures.js";
import { handCardIds } from "../hand-cards.js";
import { SEAT_LINE_SPRING } from "../hud-motion.js";

// ---------------------------------------------------------------------------
// The screen's own copies, held to their originals
//
// The planner's new screen is behind a flag, and flag-only code may not grow
// what every planner downloads. Three things it needs live in shared modules
// that nothing else in production reads yet, so the bundler leaves them out of
// those modules; importing them from the screen put them back, into files that
// many other pages' chunks fetch. So the screen keeps a copy of each, and a
// test holds every copy to its original: change one and not the other, and it
// fails. Two are held here. The stage's spring is held beside the stage
// (grand-hall/__tests__/hall-stage.test.ts) and the light's order through its
// own key (planner-hud/__tests__/view-station.test.tsx).
// ---------------------------------------------------------------------------

/** The two chairs the setup cards were drawn with. */
const CHIAVARI = "chiavari-chair";
const TURINI = "burgess-turini-18-3";

/**
 * Every card there is to ask about: each look a setup card can show; each
 * colourway on each table card, offered there or not; one trestle, two, and
 * the longest run; a dance floor of another size; and the cards both hands
 * deal, which bring the piece cards.
 */
function everyCard(): readonly CardParams[] {
  const colourways = [...new Set(Object.values(CARD_COLOURWAYS).flat())];
  const rounds = colourways.map((colourway): CardParams => ({ card: "round", seats: 8, colourway }));
  const runs = (["top-table", "long-table"] as const).flatMap((card) => colourways.flatMap((colourway) =>
    [1, 2, trestleRange(card).max].map((trestles): CardParams => ({ card, trestles, colourway }))));
  const floor: CardParams = { card: "dance-floor", cols: 2, rows: 12 };
  const dealt = [...handCardIds("wedding"), ...handCardIds("corporate")].flatMap((id) => {
    const params = cardParamsFor(id);
    return params === null ? [] : [params];
  });
  return [...setupCardLooks(), ...rounds, ...runs, floor, ...dealt];
}

describe("the hand's card pictures", () => {
  it("are the shared rule's, for every card, with every chair the hall has and one it has not", () => {
    const chairs = [...getCatalogueByCategory("chair").map((chair) => chair.slug), "no-such-chair"];
    expect(chairs).toContain(CHIAVARI);
    expect(chairs).toContain(TURINI);
    // At least one chair no card was drawn with, beside the one that is no chair at all.
    expect(chairs.length).toBeGreaterThan(3);

    const cards = everyCard();
    expect(cards.some((params) => params.card === "piece")).toBe(true);
    let pictures = 0;
    let none = 0;
    for (const params of cards) {
      for (const chair of chairs) {
        const shared = setupCardPreviewUrl(params, chair);
        expect(handCardPictureUrl(params, chair), `${JSON.stringify(params)} with ${chair}`).toBe(shared);
        if (shared === null) none += 1;
        else pictures += 1;
      }
    }
    // Both answers were compared many times over: a picture, and the lack of one.
    expect(pictures).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(100);
  });

  it("are named as the pictures are stored", () => {
    expect(handCardPictureUrl({ card: "round", seats: 10, colourway: "white" }, CHIAVARI)).toBe("/models/furniture/setup-round/setup-v2/white-chiavari.webp");
    expect(handCardPictureUrl({ card: "top-table", trestles: 4, colourway: "wood" }, TURINI)).toBe("/models/furniture/setup-top-table/setup-v2/wood-set-turini.webp");
    expect(handCardPictureUrl({ card: "long-table", trestles: 1, colourway: "bare" }, CHIAVARI)).toBe("/models/furniture/setup-long-table/setup-v2/bare-one-chiavari.webp");
    // The floor seats nobody, so it has its picture whatever the chair.
    expect(handCardPictureUrl({ card: "dance-floor", cols: 5, rows: 5 }, "no-such-chair")).toBe("/models/furniture/setup-dance-floor/setup-v2/floor.webp");
    // A seated look on a chair it was never drawn with has none, and a piece's picture is its own.
    expect(handCardPictureUrl({ card: "round", seats: 10, colourway: "white" }, "no-such-chair")).toBeNull();
    expect(handCardPictureUrl({ card: "piece", slug: "lectern", seats: null }, CHIAVARI)).toBeNull();
  });
});

describe("the shelf's spring", () => {
  it("fills the seat line on the shared table's dial glide", () => {
    expect(SEAT_LINE_SPRING).toEqual(SPRING_PRESETS.dialGlide);
  });
});
