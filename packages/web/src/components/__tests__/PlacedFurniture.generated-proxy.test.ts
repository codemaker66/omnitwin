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
  it("keeps an inspected generated hierarchy out of the instanced batch", () => {
    const generated = generatedPlacedItems();
    const inspected = generated[2];
    if (inspected === undefined) throw new Error("missing generated inspection fixture");
    const partition = plannerFurnitureRenderPartition(generated, inspected.id);
    const expectedIds = generated
      .filter((item) => item.id !== inspected.id)
      .map((item) => item.id);

    expect(partition.instancedItems.map((item) => item.id)).toEqual(expectedIds);
    expect([...partition.instancedIds]).toEqual(expectedIds);
  });

  it("keeps all non-inspected procedural furniture eligible for instancing", () => {
    const generated = generatedPlacedItems();
    const partition = plannerFurnitureRenderPartition(generated, null);

    expect([...partition.instancedIds]).toEqual(generated.map((item) => item.id));
  });

  it("batches every repeated imported chair while retaining one inspected hierarchy", () => {
    const chairs = Array.from({ length: 144 }, (_, index) => (
      createPlacedItem(catalogueId("burgess-turini-18-3"), index % 12, Math.floor(index / 12))
    ));
    expect(plannerFurnitureRenderPartition(chairs, null).instancedItems).toHaveLength(144);
    const inspected = chairs[0];
    if (inspected === undefined) throw new Error("missing imported chair fixture");
    const partition = plannerFurnitureRenderPartition(chairs, inspected.id);
    expect(partition.instancedItems).toHaveLength(143);
    expect(partition.instancedIds.has(inspected.id)).toBe(false);
  });

  it("retains leaked dressing rows in state but excludes them from every model batch", () => {
    const table = createPlacedItem(catalogueId("round-table-6ft"), 0, 0);
    const leakedApplicators = [
      createPlacedItem(catalogueId("black-table-cloth"), 2, 0),
      createPlacedItem(catalogueId("white-table-cloth"), 4, 0),
      createPlacedItem(catalogueId("dinner-place-setting"), 6, 0),
    ];
    const input = [table, ...leakedApplicators];
    const partition = plannerFurnitureRenderPartition(input, null);

    expect(input).toHaveLength(4);
    expect(partition.instancedItems).toEqual([table]);
    expect([...partition.instancedIds]).toEqual([table.id]);
  });
});

describe("shouldRenderIndividualFurnitureModel", () => {
  it("renders a visible per-item fallback when instancing fails", () => {
    expect(shouldRenderIndividualFurnitureModel({
      inspected: false,
      instanced: true,
      instancingFailed: true,
    })).toBe(true);
  });

  it("always keeps the inspected hierarchy detailed, including during camera motion", () => {
    expect(shouldRenderIndividualFurnitureModel({
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
