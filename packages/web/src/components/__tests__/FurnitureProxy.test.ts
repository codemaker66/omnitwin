import { describe, expect, it } from "vitest";
import {
  GENERATED_FURNITURE_EXPLODE_WORLD_DISTANCE,
  type FurnitureMeshKind,
  generatedFurnitureLocalExplodeDistance,
  normalizedFurniturePresentationScale,
  resolveFurnitureMeshKind,
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
  "trestle-4ft": "trestle-table",
  "poseur-table": "poseur-table",
  "poseur-table-black": "poseur-table",
  "poseur-table-white": "poseur-table",
  "platform-narrow": "platform",
  "projector-screen": "projector-screen",
  "projector": "projector",
  "laptop": "laptop",
  "microphone": "microphone",
  "mic-stand": "mic-stand",
  "lectern": "lectern",
  "black-table-cloth": "platform",
  "white-table-cloth": "platform",
  "dinner-place-setting": "platform",
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

  it("never dispatches on the UUID id — poseur tables are not round tables", () => {
    // The regression: `id.startsWith("poseur-table")` is always false because
    // id is a UUID v5, so all three poseurs fell through to the round-table
    // branch via tableShape === "round".
    for (const slug of ["poseur-table", "poseur-table-black", "poseur-table-white"]) {
      const item = getCatalogueItemBySlug(slug);
      expect(item, `catalogue is missing "${slug}"`).toBeDefined();
      if (item === undefined) continue;
      expect(item.id).not.toBe(slug);
      expect(item.tableShape).toBe("round");
      expect(resolveFurnitureMeshKind(item)).toBe("poseur-table");
    }
  });

  it("never dispatches on the UUID id — AV items are not all projectors", () => {
    const avExpectations: ReadonlyArray<readonly [string, FurnitureMeshKind]> = [
      ["projector-screen", "projector-screen"],
      ["laptop", "laptop"],
      ["microphone", "microphone"],
      ["mic-stand", "mic-stand"],
      ["projector", "projector"],
    ];
    for (const [slug, expected] of avExpectations) {
      const item = getCatalogueItemBySlug(slug);
      expect(item, `catalogue is missing "${slug}"`).toBeDefined();
      if (item === undefined) continue;
      expect(item.id).not.toBe(slug);
      expect(resolveFurnitureMeshKind(item)).toBe(expected);
    }
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
