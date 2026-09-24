import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Intersection, type Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { PlacedFurniture } from "../PlacedFurniture.js";
import { findFurnitureItemId } from "../SelectionSystem.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function isWithin(object: Object3D, ancestor: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/** SelectionSystem's pick: the whole scene, every hit in distance order. */
function pickDown(scene: Object3D, x: number, z: number): Intersection[] {
  scene.updateMatrixWorld(true);
  return new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0)).intersectObjects(scene.children, true);
}

describe("furniture picking", () => {
  it("never picks the hidden instancing template on empty floor at the origin", () => {
    const tableId = catalogueId("round-table-6ft");
    const placed = createPlacedItem(tableId, 6, 6);
    usePlacementStore.setState({ placedItems: [placed] });
    mounted = mountInStubRoot(<PlacedFurniture />);
    const { scene } = mounted;
    const template = scene.getObjectByName(`furniture-template-${tableId}`);
    if (template === undefined) throw new Error("Expected the table's hidden template");

    const empty = pickDown(scene, 0, 0);
    expect(empty.filter((hit) => isWithin(hit.object, template))).toEqual([]);
    expect(empty.map((hit) => findFurnitureItemId(hit.object)).filter((id) => id !== null)).toEqual([]);

    const onTable = pickDown(scene, 6, 6).map((hit) => findFurnitureItemId(hit.object));
    expect(onTable.find((id) => id !== null)).toBe(placed.id);
  });

  it("resolves only a placed item's root under the placed-furniture group", () => {
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const mesh = (parent: Object3D): Mesh => {
      const child = new Mesh(geometry, material);
      parent.add(child);
      return child;
    };
    const group = (name: string, parent?: Object3D): Group => {
      const child = new Group();
      child.name = name;
      parent?.add(child);
      return child;
    };
    const placedFurniture = group("placed-furniture");
    const item = group("furniture-chair-1", placedFurniture);
    const modelPart = mesh(group("furniture-part-backrest", group("furniture-chair-1-mesh", item)));
    const template = mesh(group("furniture-template-chair", group("", group("instanced-furniture", placedFurniture))));
    const removed = mesh(group("furniture-chair-2", placedFurniture));
    const lighting = mesh(group("furniture-lighting-panorama-experiment"));
    // Ids matching the other names' suffixes still resolve only through a real root.
    const chairId = catalogueId("banquet-chair");
    usePlacementStore.setState({
      placedItems: ["chair-1", "template-chair", "lighting-panorama-experiment"].map((id) => (
        { ...createPlacedItem(chairId, 0, 0), id }
      )),
    });

    try {
      expect(findFurnitureItemId(modelPart)).toBe("chair-1");
      expect(findFurnitureItemId(item)).toBe("chair-1");
      expect(findFurnitureItemId(template)).toBeNull();
      expect(findFurnitureItemId(removed)).toBeNull();
      expect(findFurnitureItemId(lighting)).toBeNull();
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
});
