import { describe, expect, it } from "vitest";
import {
  GENERATED_FURNITURE_EXPLODE_WORLD_DISTANCE,
  type FurnitureMeshKind,
  generatedFurnitureLocalExplodeDistance,
  normalizedFurniturePresentationScale,
  resolveFurnitureMeshKind,
  standaloneFurnitureMeshUrl,
} from "../FurnitureProxy.js";
import { CATALOGUE_ITEMS, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { CRAFTED_FURNITURE_SLUGS } from "../../lib/crafted-furniture.js";

// Every real catalogue slug and the mesh it must render as. Asserted against
// CATALOGUE_ITEMS (not fixtures) because the dispatch bug this pins was
// invisible to fixture-based tests: it only appeared once `id` held a real
// UUID v5 rather than a slug-shaped string.
const EXPECTED_MESH_BY_SLUG: Readonly<Record<string, FurnitureMeshKind>> = {
  "round-table-6ft": "generated",
  "trestle-6ft": "crafted",
  "banquet-chair": "generated",
  "burgess-turini-18-3": "crafted",
  "platform": "crafted",
  "bar-counter": "crafted",
  "dancefloor-panel": "generated",
  "trestle-4ft": "generated",
  "poseur-table": "generated",
  "poseur-table-black": "crafted",
  "poseur-table-white": "crafted",
  "platform-narrow": "generated",
  "projector-screen": "generated",
  "projector": "generated",
  "laptop": "generated",
  "microphone": "generated",
  "mic-stand": "generated",
  "lectern": "generated",
  "black-table-cloth": "applicator",
  "white-table-cloth": "applicator",
  "dinner-place-setting": "applicator",
  "trestle-6ft-black": "crafted",
  "trestle-6ft-white": "crafted",
  "trestle-4ft-black": "crafted",
  "trestle-4ft-white": "crafted",
  "trestle-6ft-wooden": "crafted",
  "round-table-6ft-black": "crafted",
  "round-table-6ft-white": "crafted",
  "cake-cutting-table": "crafted",
  "ceremony-table": "crafted",
  "checked-banquet-chair": "crafted",
  "room-divider": "crafted",
  "round-cafe-table-white": "crafted",
  "square-cafe-table-white": "crafted",
  "servery-unit": "crafted",
  // Trades Hall equipment intake: no supplied models yet, so each falls to the
  // procedural mesh for its kind. The two microphones and the television are
  // dispatched by slug — without that the television would render as a
  // projector body, which is the `av` default.
  "chiavari-chair": "chair",
  "gallery-chair-red-gold": "chair",
  "pink-chair": "chair",
  "highchair-white": "chair",
  "highchair-green": "chair",
  "highchair-blue": "chair",
  "highchair-wooden": "chair",
  "staging-deck-6x4": "platform",
  "staging-deck-6x3": "platform",
  "hisense-television": "projector-screen",
  "handheld-microphone": "microphone",
  "lapel-microphone": "microphone",
};

describe("furniture mesh dispatch", () => {
  it("draws every supplied design as its crafted model, downloading no GLB", () => {
    const supplied = CATALOGUE_ITEMS.filter((item) => item.meshUrl !== null);
    expect(supplied).toHaveLength(20);
    expect(supplied.map((item) => item.slug).sort()).toEqual([...CRAFTED_FURNITURE_SLUGS].sort());
    for (const item of supplied) {
      expect(resolveFurnitureMeshKind(item), item.slug).toBe("crafted");
      expect(standaloneFurnitureMeshUrl(item), item.slug).toBeNull();
      // The picker shows the crafted render, not the supplied model's.
      expect(item.thumbnailUrl, item.slug).toBe(`/models/furniture/${item.slug}/crafted-v2/preview.webp`);
    }
  });
  it("routes every canonical catalogue item to its intended mesh", () => {
    for (const item of CATALOGUE_ITEMS) {
      const expected = EXPECTED_MESH_BY_SLUG[item.slug];
      expect(expected, `no expectation recorded for slug "${item.slug}"`)
        .toBeDefined();
      expect(resolveFurnitureMeshKind(item), `slug "${item.slug}"`)
        .toBe(expected);
    }
  });

  it("covers the whole catalogue, so a new asset cannot land unrouted", () => {
    expect([...CATALOGUE_ITEMS].map((item) => item.slug).sort())
      .toEqual(Object.keys(EXPECTED_MESH_BY_SLUG).sort());
  });

  it("routes every poseur variant by its slug, never as a round table", () => {
    // The regression: `id.startsWith("poseur-table")` is always false because
    // id is a UUID v5, so all three poseurs fell through to the round-table
    // branch via tableShape === "round".
    const expectations: ReadonlyArray<readonly [string, FurnitureMeshKind]> = [
      ["poseur-table", "generated"],
      ["poseur-table-black", "crafted"],
      ["poseur-table-white", "crafted"],
    ];
    for (const [slug, expected] of expectations) {
      const item = getCatalogueItemBySlug(slug);
      expect(item, `catalogue is missing "${slug}"`).toBeDefined();
      if (item === undefined) continue;
      expect(item.id).not.toBe(slug);
      expect(item.tableShape).toBe("round");
      expect(resolveFurnitureMeshKind(item)).toBe(expected);
    }
  });

  it("never dispatches on the UUID id — AV items are not all projectors", () => {
    const avExpectations: ReadonlyArray<readonly [string, FurnitureMeshKind]> = [
      ["projector-screen", "generated"],
      ["laptop", "generated"],
      ["microphone", "generated"],
      ["mic-stand", "generated"],
      ["projector", "generated"],
    ];
    for (const [slug, expected] of avExpectations) {
      const item = getCatalogueItemBySlug(slug);
      expect(item, `catalogue is missing "${slug}"`).toBeDefined();
      if (item === undefined) continue;
      expect(item.id).not.toBe(slug);
      expect(resolveFurnitureMeshKind(item)).toBe(expected);
    }
  });

  it("routes contextual dressing tools to a non-rendering kind, never a platform", () => {
    for (const slug of [
      "black-table-cloth",
      "white-table-cloth",
      "dinner-place-setting",
    ] as const) {
      const item = getCatalogueItemBySlug(slug);
      expect(item, `catalogue is missing "${slug}"`).toBeDefined();
      if (item === undefined) continue;
      expect(item.id).not.toBe(slug);
      expect(resolveFurnitureMeshKind(item)).toBe("applicator");
      expect(resolveFurnitureMeshKind(item)).not.toBe("platform");
    }
  });

  it("blocks an applicator GLB escape even when malformed metadata supplies a mesh URL", () => {
    const cloth = getCatalogueItemBySlug("black-table-cloth");
    const lectern = getCatalogueItemBySlug("lectern");
    const platform = getCatalogueItemBySlug("platform");
    expect(cloth).toBeDefined();
    expect(lectern).toBeDefined();
    expect(platform).toBeDefined();
    if (cloth === undefined || lectern === undefined || platform === undefined) return;

    expect(standaloneFurnitureMeshUrl({ ...cloth, meshUrl: "/unexpected-cloth.glb" }))
      .toBeNull();
    expect(standaloneFurnitureMeshUrl({ ...lectern, meshUrl: "/lectern.glb" }))
      .toBe("/lectern.glb");
    // A crafted piece draws in code whatever its catalogue row supplies.
    expect(standaloneFurnitureMeshUrl({ ...platform, meshUrl: "/platform.glb" }))
      .toBeNull();
  });
});

describe("generated furniture item scale", () => {
  it("preserves valid persisted scale and safely defaults invalid values", () => {
    expect(normalizedFurniturePresentationScale(1.25)).toBe(1.25);
    expect(normalizedFurniturePresentationScale(undefined)).toBe(1);
    expect(normalizedFurniturePresentationScale(0)).toBe(1);
    expect(normalizedFurniturePresentationScale(Number.NaN)).toBe(1);
  });

  it("keeps the final explode displacement constant after outer item scaling", () => {
    const itemScale = 1.4;
    const localDistance = generatedFurnitureLocalExplodeDistance(itemScale);
    expect(localDistance * itemScale).toBeCloseTo(
      GENERATED_FURNITURE_EXPLODE_WORLD_DISTANCE,
    );
  });
});
