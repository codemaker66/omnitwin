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

// Every real catalogue slug and the mesh it must render as. Asserted against
// CATALOGUE_ITEMS (not fixtures) because the dispatch bug this pins was
// invisible to fixture-based tests: it only appeared once `id` held a real
// UUID v5 rather than a slug-shaped string.
const EXPECTED_MESH_BY_SLUG: Readonly<Record<string, FurnitureMeshKind>> = {
  "round-table-6ft": "generated",
  "trestle-6ft": "generated",
  "banquet-chair": "generated",
  "platform": "generated",
  "bar-counter": "generated",
  "dancefloor-panel": "generated",
  "trestle-4ft": "generated",
  "poseur-table": "generated",
  "poseur-table-black": "generated",
  "poseur-table-white": "generated",
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
};

describe("furniture mesh dispatch", () => {
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

  it("routes every poseur variant through its exact generated proxy", () => {
    // The regression: `id.startsWith("poseur-table")` is always false because
    // id is a UUID v5, so all three poseurs fell through to the round-table
    // branch via tableShape === "round".
    const expectations: ReadonlyArray<readonly [string, FurnitureMeshKind]> = [
      ["poseur-table", "generated"],
      ["poseur-table-black", "generated"],
      ["poseur-table-white", "generated"],
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
    const platform = getCatalogueItemBySlug("platform");
    expect(cloth).toBeDefined();
    expect(platform).toBeDefined();
    if (cloth === undefined || platform === undefined) return;

    expect(standaloneFurnitureMeshUrl({ ...cloth, meshUrl: "/unexpected-cloth.glb" }))
      .toBeNull();
    expect(standaloneFurnitureMeshUrl({ ...platform, meshUrl: "/platform.glb" }))
      .toBe("/platform.glb");
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
