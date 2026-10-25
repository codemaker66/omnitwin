import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { CARD_TABS, CATALOGUE_CARDS, RAIL_SLOTS, railName, searchCatalogue } from "../card-defaults.js";
import { pieceCardSlug } from "../setup-cards.js";

// ---------------------------------------------------------------------------
// The cards the rail and the catalogue show (card-dock spec §5): eight named
// cards by the event's style, set once and never reshuffled; the catalogue's
// five tabs with variants collapsed onto one card; search by name and alias.
// ---------------------------------------------------------------------------

describe("the eight cards", () => {
  it("follow the event's style, eight each, in the spec's order", () => {
    expect(RAIL_SLOTS.dinner.map(railName)).toEqual(["Round of 10", "Top table", "Long table", "Dance floor", "Stage", "Bar", "Poseur", "Cake table"]);
    expect(RAIL_SLOTS.theatre.map(railName)).toEqual(["Theatre rows", "Stage", "Lectern", "Screen", "Top table", "Chairs", "Poseur", "Bar"]);
    expect(RAIL_SLOTS.reception.map(railName)).toEqual(["Poseur", "Bar", "Stage", "Lectern", "Screen", "Cake table", "Dance floor", "Chairs"]);
  });

  it("name only pieces the catalogue holds, in short names", () => {
    for (const slots of Object.values(RAIL_SLOTS)) {
      for (const id of slots) {
        const slug = pieceCardSlug(id);
        if (slug !== null) expect(getCatalogueItemBySlug(slug), slug).toBeDefined();
        expect(railName(id).length, railName(id)).toBeLessThanOrEqual(12);
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
    expect(CATALOGUE_CARDS.find((card) => card.name === "Round 1.83 m")?.variants.map((variant) => variant.colour)).toEqual(["white", "black", "bare"]);
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
});
