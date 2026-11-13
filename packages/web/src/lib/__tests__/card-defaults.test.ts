import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { CARD_TABS, CATALOGUE_CARDS, railName, railSlots, searchCatalogue, type RailStyle } from "../card-defaults.js";
import { PLANNER_CHAIR_BY_EVENT, UNASKED_PLANNER_CHAIR_SLUG, isPlannerChair } from "../furniture-defaults.js";
import { pieceCardId, pieceCardSlug } from "../setup-cards.js";

// ---------------------------------------------------------------------------
// The cards the rail and the catalogue show (card-dock spec §5): eight named
// cards by the event's style, set once and never reshuffled; the catalogue's
// five tabs with variants collapsed onto one card; search by name and alias.
// ---------------------------------------------------------------------------

const STYLES: readonly RailStyle[] = ["dinner", "theatre", "reception"];
const EVENT_CHAIRS = [UNASKED_PLANNER_CHAIR_SLUG, ...Object.values(PLANNER_CHAIR_BY_EVENT)];

describe("the eight cards", () => {
  it("follow the event's style, eight each, in the spec's order", () => {
    const names = (style: RailStyle): string[] => railSlots(style).map((id) => railName(id, style));
    expect(names("dinner")).toEqual(["Round of 10", "Top table", "Long table", "Dance floor", "Stage", "Bar", "Poseur", "Cake table"]);
    expect(names("theatre")).toEqual(["Theatre rows", "Stage", "Lectern", "Screen", "Top table", "Chairs", "Poseur", "Bar"]);
    expect(names("reception")).toEqual(["Poseur", "Bar", "Stage", "Lectern", "Screen", "Cake table", "Dance floor", "Chairs"]);
  });

  it("name only pieces the catalogue holds, in short names, each once", () => {
    for (const chair of EVENT_CHAIRS) {
      for (const style of STYLES) {
        const slots = railSlots(style, chair);
        expect(new Set(slots).size, `${style} ${chair}`).toBe(8);
        for (const id of slots) {
          const slug = pieceCardSlug(id);
          if (slug !== null) expect(getCatalogueItemBySlug(slug), slug).toBeDefined();
          expect(railName(id, style).length, railName(id, style)).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  // #357 V12: the Chairs slot was the generic banquet chair, which the hall does not own.
  it("make Chairs the chair the event is set with, one the hall owns", () => {
    expect(railSlots("reception", "chiavari-chair")[7]).toBe(pieceCardId("chiavari-chair"));
    expect(railSlots("reception", UNASKED_PLANNER_CHAIR_SLUG)[7]).toBe(pieceCardId(UNASKED_PLANNER_CHAIR_SLUG));
    expect(railSlots("theatre", "chiavari-chair")[5]).toBe(pieceCardId("chiavari-chair"));
    for (const chair of EVENT_CHAIRS) {
      for (const style of ["theatre", "reception"] as const) {
        const slots = railSlots(style, chair);
        const chairs = slots[style === "theatre" ? 5 : 7];
        const slug = chairs === undefined ? null : pieceCardSlug(chairs);
        expect(slug !== null && isPlannerChair(slug), `${style} ${chair}`).toBe(true);
        expect(slots).not.toContain(pieceCardId("banquet-chair"));
      }
    }
  });
});

describe("the catalogue", () => {
  it("collapses the pieces onto cards under five tabs, each piece on one card", () => {
    expect(CARD_TABS).toEqual(["Tables", "Chairs", "Staging", "AV", "Other"]);
    const slugs = CATALOGUE_CARDS.flatMap((card) => card.variants.map((variant) => variant.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(getCatalogueItemBySlug(slug), slug).toBeDefined();
    expect(CATALOGUE_CARDS.length).toBeGreaterThanOrEqual(24);
    expect(CATALOGUE_CARDS.find((card) => card.name === "Round 6 ft")?.variants.map((variant) => variant.colour)).toEqual(["white", "black", "bare"]);
    // Dressing is not a card: cloths and place settings stay with the caption.
    expect(slugs).not.toContain("white-table-cloth");
    expect(slugs).not.toContain("dinner-place-setting");
  });

  it("finds cards by name, plain name and alias", () => {
    expect(searchCatalogue("dance")[0]?.name).toBe("Dance floor");
    expect(searchCatalogue("top")[0]?.name).toBe("Top table");
    expect(searchCatalogue("platform")[0]?.name).toBe("Stage deck");
    expect(searchCatalogue("projector screen")[0]?.name).toBe("Screen");
    expect(searchCatalogue("chiav")[0]?.name).toBe("Chiavari");
    expect(searchCatalogue("")).toEqual([]);
    expect(searchCatalogue("zzzz")).toEqual([]);
  });

  // #357 V12: "chairs" and Enter set down generic banquet chairs, which the hall does not have.
  it("finds the hall's own chairs for chair and chairs, the banquet chair after them", () => {
    const names = (word: string): string[] => searchCatalogue(word).map((card) => card.name);
    const hall = ["Burgess Turini", "Checked banquet", "Chiavari", "Gallery red and gold", "Pink chair"];
    expect(names("chairs")).toEqual(hall);
    expect(names("chair").slice(0, hall.length)).toEqual(hall);
  });
});
