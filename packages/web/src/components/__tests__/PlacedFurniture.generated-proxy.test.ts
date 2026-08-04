import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CATALOGUE_ITEMS } from "../../lib/catalogue.js";
import { createPlacedItem } from "../../lib/placement.js";
import {
  plannerFurnitureRenderPartition,
  shouldRenderIndividualFurnitureModel,
} from "../PlacedFurniture.js";
import { GENERATED_FURNITURE_SLUGS } from "../meshes/generated/generatedFurnitureRegistry.js";

function catalogueId(slug: string): string {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item.id;
}

function generatedPlacedItems(): ReturnType<typeof createPlacedItem>[] {
  return GENERATED_FURNITURE_SLUGS.map((slug, index) => (
    createPlacedItem(catalogueId(slug), index * 2, 0)
  ));
}

describe("plannerFurnitureRenderPartition", () => {
  it("keeps an inspected generated hierarchy out of instanced and lean batches", () => {
    const generated = generatedPlacedItems();
    const inspected = generated[2];
    if (inspected === undefined) throw new Error("missing generated inspection fixture");
    const partition = plannerFurnitureRenderPartition(generated, inspected.id);
    const expectedIds = generated
      .filter((item) => item.id !== inspected.id)
      .map((item) => item.id);

    expect(partition.instancedItems.map((item) => item.id)).toEqual(expectedIds);
    expect([...partition.instancedIds]).toEqual(expectedIds);
    expect(partition.leanItems.map((item) => item.id)).toEqual(expectedIds);
  });

  it("keeps all non-inspected procedural furniture eligible for instancing", () => {
    const generated = generatedPlacedItems();
    const partition = plannerFurnitureRenderPartition(generated, null);

    expect([...partition.instancedIds]).toEqual(generated.map((item) => item.id));
    expect(partition.leanItems).toHaveLength(GENERATED_FURNITURE_SLUGS.length);
  });
});

describe("shouldRenderIndividualFurnitureModel", () => {
  it("renders a visible per-item fallback when instancing fails", () => {
    expect(shouldRenderIndividualFurnitureModel({
      leanRendering: false,
      inspected: false,
      instanced: true,
      instancingFailed: true,
    })).toBe(true);
  });

  it("always keeps the inspected hierarchy detailed, including during camera motion", () => {
    expect(shouldRenderIndividualFurnitureModel({
      leanRendering: true,
      inspected: true,
      instanced: false,
      instancingFailed: false,
    })).toBe(true);
  });
});

describe("generated instancing parity", () => {
  it("keeps normalized item scale and harvested shadows on both instance paths", async () => {
    const source = await readFile(
      "src/components/editor/InstancedFurnitureLayer.tsx",
      "utf8",
    );

    expect(source.match(/normalizedFurniturePresentationScale\(item\.scale\)/g)?.length)
      .toBe(2);
    expect(source).toContain("castShadow={shadows.castShadow}");
    expect(source).toContain("receiveShadow={shadows.receiveShadow}");
  });
});
