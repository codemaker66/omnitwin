import { beforeEach, describe, expect, it } from "vitest";
import {
  computeSurfaceHeight,
  createPlacedItem,
  findSupportingItem,
  resetPlacedIdCounter,
  type PlacedItem,
} from "../placement.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { seededRandom } from "../planner-sound-render.js";
import { toRenderSpace } from "../../constants/scale.js";

function catalogueFixture(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture: ${slug}`);
  return item;
}

const deckItem = catalogueFixture("staging-deck-6x4");
const chairItem = catalogueFixture("chiavari-chair");
const laptopItem = catalogueFixture("laptop");
const micStandItem = catalogueFixture("mic-stand");
const clothItem = catalogueFixture("white-table-cloth");

const DECK_HALF_WIDTH = toRenderSpace(deckItem.width) / 2;
const DECK_HALF_DEPTH = toRenderSpace(deckItem.depth) / 2;
const NONE: ReadonlySet<string> = new Set();

describe("findSupportingItem", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("finds the deck under a chair at the deck's centre", () => {
    const deck = createPlacedItem("staging-deck-6x4", 0, 0);
    expect(findSupportingItem(0, 0, chairItem, [deck], NONE)).toBe(deck);
  });

  it("skips an excluded deck and reports the floor", () => {
    const deck = createPlacedItem("staging-deck-6x4", 0, 0);
    expect(findSupportingItem(0, 0, chairItem, [deck], new Set([deck.id]))).toBeNull();
  });

  it("lets a laptop rest on a round but not a chair", () => {
    const round = createPlacedItem("round-table-6ft", 0, 0);
    expect(findSupportingItem(0, 0, laptopItem, [round], NONE)).toBe(round);
    expect(findSupportingItem(0, 0, chairItem, [round], NONE)).toBeNull();
  });

  it("finds the upper deck of a stack", () => {
    const lower = createPlacedItem("staging-deck-6x4", 0, 0, 0, null, 0);
    const upper = createPlacedItem("staging-deck-6x4", 0, 0, 0, null, deckItem.height);
    expect(findSupportingItem(0, 0, chairItem, [lower, upper], NONE)).toBe(upper);
    expect(findSupportingItem(0, 0, chairItem, [upper, lower], NONE)).toBe(upper);
  });

  it("keeps the first of two equal-height decks that overlap", () => {
    const first = createPlacedItem("staging-deck-6x4", 0, 0);
    const second = createPlacedItem("staging-deck-6x4", 0.2, 0.1);
    expect(findSupportingItem(0.1, 0, chairItem, [first, second], NONE)).toBe(first);
    expect(findSupportingItem(0.1, 0, chairItem, [second, first], NONE)).toBe(second);
  });

  it("uses a turned deck's footprint", () => {
    const z = (DECK_HALF_DEPTH + DECK_HALF_WIDTH) / 2;
    const unturned = createPlacedItem("staging-deck-6x4", 0, 0);
    const turned = createPlacedItem("staging-deck-6x4", 0, 0, Math.PI / 2);
    expect(findSupportingItem(0, z, chairItem, [unturned], NONE)).toBeNull();
    expect(findSupportingItem(0, z, chairItem, [turned], NONE)).toBe(turned);
  });

  it("uses a scaled deck's footprint", () => {
    const x = (DECK_HALF_WIDTH + DECK_HALF_WIDTH * 1.5) / 2;
    const unscaled = createPlacedItem("staging-deck-6x4", 0, 0);
    const scaled: PlacedItem = { ...createPlacedItem("staging-deck-6x4", 0, 0), scale: 1.5 };
    expect(findSupportingItem(x, 0, chairItem, [unscaled], NONE)).toBeNull();
    expect(findSupportingItem(x, 0, chairItem, [scaled], NONE)).toBe(scaled);
  });

  it("finds the deck just inside its edge and the floor just outside", () => {
    const deck = createPlacedItem("staging-deck-6x4", 0, 0);
    expect(findSupportingItem(DECK_HALF_WIDTH + 0.01, 0, chairItem, [deck], NONE)).toBeNull();
    expect(findSupportingItem(DECK_HALF_WIDTH - 0.01, 0, chairItem, [deck], NONE)).toBe(deck);
  });

  it("never finds a support for a cloth applicator", () => {
    const deck = createPlacedItem("staging-deck-6x4", 0, 0);
    expect(findSupportingItem(0, 0, clothItem, [deck], NONE)).toBeNull();
  });

  it("skips a placement whose catalogue id is unknown", () => {
    const unknown = createPlacedItem("no-such-asset", 0, 0, 0, null, 3);
    const deck = createPlacedItem("staging-deck-6x4", 0, 0);
    expect(findSupportingItem(0, 0, chairItem, [unknown], NONE)).toBeNull();
    expect(findSupportingItem(0, 0, chairItem, [unknown, deck], NONE)).toBe(deck);
  });
});

describe("computeSurfaceHeight agrees with findSupportingItem", () => {
  beforeEach(() => { resetPlacedIdCounter(); });

  it("returns the found item's top, or 0 for the floor, at 200 seeded points", () => {
    const layout: readonly PlacedItem[] = [
      createPlacedItem("staging-deck-6x4", 0, 0),
      createPlacedItem("staging-deck-6x4", 1.2, 0.5, Math.PI / 2),
      createPlacedItem("staging-deck-6x4", 0.3, 0.2, 0, null, deckItem.height),
      createPlacedItem("round-table-6ft", 4, 0),
      createPlacedItem("dancefloor-panel", -2.5, 0),
      createPlacedItem("chiavari-chair", -2.5, 1.5),
      createPlacedItem("chiavari-chair", 4, 1.3),
      createPlacedItem("chiavari-chair", 0.5, -0.3, 0, null, 2 * deckItem.height),
    ];
    // The points cover the layout's bounds, so the small panel is hit too.
    const random = seededRandom(1);
    const points = Array.from({ length: 200 }, () => ({
      x: -3.2 + random() * 8.4,
      z: -1.5 + random() * 3,
    }));
    const foundSlugs = new Set<string>();
    let floorCount = 0;

    for (const candidate of [chairItem, laptopItem, micStandItem]) {
      for (const { x, z } of points) {
        const found = findSupportingItem(x, z, candidate, layout, NONE);
        const height = computeSurfaceHeight(x, z, candidate, layout, NONE);
        if (found === null) {
          floorCount += 1;
          expect(height).toBe(0);
        } else {
          foundSlugs.add(found.catalogueItemId);
          const top = found.y + catalogueFixture(found.catalogueItemId).height * (found.scale ?? 1);
          expect(height).toBe(top);
        }
      }
    }

    // Every kind of support and the floor are exercised, so the agreement is not vacuous.
    expect(floorCount).toBeGreaterThan(0);
    expect([...foundSlugs].sort()).toEqual(["dancefloor-panel", "round-table-6ft", "staging-deck-6x4"]);
  });
});
