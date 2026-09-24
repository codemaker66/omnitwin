import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import type { InstancedMesh, Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { activeFurnitureSettleCount, beginFurnitureSettle } from "../../../lib/furniture-motion.js";
import { createPlacedItem, type PlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { PlacedFurniture } from "../../PlacedFurniture.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FurnitureMotion } from "../FurnitureMotion.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function isInstancedMesh(object: Object3D): object is InstancedMesh {
  return (object as Partial<Pick<InstancedMesh, "isInstancedMesh">>).isInstancedMesh === true;
}

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

describe("grid settle of instanced furniture", () => {
  it("draws each instanced model where its item group (linen, covers, labels) is drawn", () => {
    const table: PlacedItem = {
      ...createPlacedItem(catalogueId("round-table-6ft"), 2, 1, 0.3, "ring"),
      clothed: true,
      clothStyle: "white",
    };
    const chairs = [0, 1, 2].map((index) => createPlacedItem(
      catalogueId("banquet-chair"), 2 + Math.cos(index * 2) * 1.25, 1 + Math.sin(index * 2) * 1.25, -index * 2, "ring",
    ));
    const bystander = createPlacedItem(catalogueId("banquet-chair"), -6, -4);
    const items = [table, ...chairs, bystander];
    usePlacementStore.setState({ placedItems: items });
    mounted = mountInStubRoot(<><FurnitureMotion /><PlacedFurniture /></>);
    const { scene } = mounted;

    let seconds = 100;
    const frame = (): void => { act(() => { advance(seconds, true); }); seconds += 1 / 60; };
    frame();

    const batches: InstancedMesh[] = [];
    scene.getObjectByName("instanced-furniture")?.traverse((object) => {
      if (isInstancedMesh(object)) batches.push(object);
    });
    const tableBatch = batches.find((mesh) => mesh.count === 1);
    const chairBatch = batches.find((mesh) => mesh.count === 4);
    if (tableBatch === undefined || chairBatch === undefined) throw new Error("Missing furniture batches");
    const drawnAt = (item: PlacedItem): readonly [number, number] => {
      const batch = item === table ? tableBatch : chairBatch;
      const slot = item === table ? 0 : [...chairs, bystander].indexOf(item);
      const matrix = batch.instanceMatrix.array;
      return [matrix[slot * 16 + 12] ?? Number.NaN, matrix[slot * 16 + 14] ?? Number.NaN];
    };
    const groupOffset = (item: PlacedItem): readonly [number, number] => {
      const group = scene.getObjectByName(`furniture-${item.id}`);
      if (group === undefined) throw new Error(`Missing item group ${item.id}`);
      return [group.position.x, group.position.z];
    };
    const expectDrawnWithGroup = (item: PlacedItem): void => {
      const [offsetX, offsetZ] = groupOffset(item);
      const [x, z] = drawnAt(item);
      expect(x).toBeCloseTo(item.x + offsetX, 5);
      expect(z).toBeCloseTo(item.z + offsetZ, 5);
    };

    // What SelectionSystem does on release: the store holds the snapped
    // position and the moved ring starts visually where the hand left it.
    for (const item of [table, ...chairs]) beginFurnitureSettle(item.id, -0.12, 0.07);
    let settling = 0;
    while (activeFurnitureSettleCount() > 0 && settling < 600) {
      frame();
      settling += 1;
      if (activeFurnitureSettleCount() === 0) break;
      expect(groupOffset(table)[0]).not.toBe(0);
      for (const item of items) expectDrawnWithGroup(item);
    }
    expect(settling).toBeGreaterThan(1);
    expect(settling).toBeLessThan(600);

    for (const item of items) {
      expect(groupOffset(item)).toEqual([0, 0]);
      expect(drawnAt(item)[0]).toBeCloseTo(item.x, 5);
      expect(drawnAt(item)[1]).toBeCloseTo(item.z, 5);
    }
  });
});
