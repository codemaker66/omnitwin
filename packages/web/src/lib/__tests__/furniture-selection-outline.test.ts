import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Euler, Group, LineBasicMaterial, LineLoop, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from "three";
import { furnitureSelectionOutlines, ignoreSelectionOutlineRaycast } from "../furniture-selection-outline.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";

function placed(slug: string, x = 0, z = 0, groupId: string | null = null): PlacedItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`missing ${slug}`);
  return createPlacedItem(item.id, x, z, 0, groupId);
}
function tableGroup(groupId: string, x = 0): readonly PlacedItem[] {
  return [placed("round-table-6ft", x, 0, groupId), ...Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    return { ...placed("banquet-chair", x + 1.4 * Math.cos(angle), 1.4 * Math.sin(angle), groupId), rotationY: -angle };
  })];
}
const ids = (items: readonly PlacedItem[]) => new Set(items.map(({ id }) => id));
const points = (key: string) => {
  const values = key.split(",").map(Number);
  return Array.from({ length: values.length / 3 }, (_, index) => new Vector3().fromArray(values, index * 3));
};

describe("selection footprint meaning", () => {
  it("merges only a fully selected table group, never partial or unrelated selections", () => {
    const first = tableGroup("first"), second = tableGroup("second", 8);
    const items = [...first, ...second];
    expect(furnitureSelectionOutlines(items, ids(first))).toHaveLength(1);
    expect(furnitureSelectionOutlines(items, ids(first.slice(0, 8)))).toHaveLength(8);
    expect(furnitureSelectionOutlines(items, ids(items))).toHaveLength(2);
    const chair = first[1];
    if (chair === undefined) throw new Error("missing chair");
    const detached = items.map((item) => item.id === chair.id ? { ...item, groupId: null } : item);
    expect(furnitureSelectionOutlines(detached, ids(items))).toHaveLength(3);
    expect(furnitureSelectionOutlines(items, new Set([chair.id]))[0]?.itemIds).toEqual([chair.id]);
    expect(furnitureSelectionOutlines(items, new Set())).toHaveLength(0);
    const chairs = [placed("banquet-chair", 0, 0, "chairs"), placed("banquet-chair", 1, 0, "chairs")];
    expect(furnitureSelectionOutlines(chairs, ids(chairs))).toHaveLength(2);
  });

  it("uses actual Three rotation, scale and placement for every rectangular corner", () => {
    const item = { ...placed("banquet-chair", 3, -7), rotationY: .73, scale: 1.8, y: 1.2 };
    const catalogue = getCatalogueItemBySlug("banquet-chair");
    if (catalogue === undefined) throw new Error("missing chair");
    const outline = furnitureSelectionOutlines([item], ids([item]))[0];
    if (outline === undefined) throw new Error("missing outline");
    const actual = points(outline.coordinateKey).map((p) => p.add(new Vector3(...outline.position)));
    const matrix = new Matrix4().compose(new Vector3(item.x, item.y + .02, item.z),
      new Quaternion().setFromEuler(new Euler(0, item.rotationY, 0)), new Vector3(item.scale, 1, item.scale));
    const width = catalogue.width / 2, depth = catalogue.depth / 2;
    const expected = [[-width, -depth], [width, -depth], [width, depth], [-width, depth]];
    expected.forEach(([x, z], index) => {
      const point = new Vector3(x, 0, z).applyMatrix4(matrix);
      expect(actual[index]?.distanceTo(point)).toBeLessThan(.000001);
    });
  });

  it("derives the round table radius from the catalogue without a clearance allowance", () => {
    const table = { ...placed("round-table-6ft", 4, 6), scale: 1.4 };
    const catalogue = getCatalogueItemBySlug("round-table-6ft");
    if (catalogue === undefined) throw new Error("missing table");
    const outline = furnitureSelectionOutlines([table], ids([table]))[0];
    if (outline === undefined) throw new Error("missing outline");
    expect(points(outline.coordinateKey)).toHaveLength(64);
    for (const point of points(outline.coordinateKey)) expect(point.length()).toBeCloseTo(catalogue.width * table.scale / 2, 6);
  });

  it("encloses every transformed chair footprint and retains shape identity under uniform drag", () => {
    const group = tableGroup("chairs").map((item, index) => ({ ...item, scale: index === 3 ? 2 : 1 }));
    const outline = furnitureSelectionOutlines(group, ids(group))[0];
    if (outline === undefined) throw new Error("missing outline");
    const hull = points(outline.coordinateKey);
    for (const item of group) {
      const single = furnitureSelectionOutlines([item], ids([item]))[0];
      if (single === undefined) throw new Error("missing footprint");
      const offset = new Vector3(...single.position).sub(new Vector3(...outline.position));
      for (const point of points(single.coordinateKey).map((p) => p.add(offset))) {
        hull.forEach((a, index) => {
          const b = hull[(index + 1) % hull.length];
          if (b === undefined) throw new Error("empty hull");
          const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
          expect(cross).toBeGreaterThanOrEqual(-.000002);
        });
      }
    }
    const moved = group.map((item) => ({ ...item, x: item.x + 7, z: item.z - 9 }));
    const movedOutline = furnitureSelectionOutlines(moved, ids(moved))[0];
    expect(movedOutline?.coordinateKey).toBe(outline.coordinateKey);
    expect(movedOutline?.position).toEqual([outline.position[0] + 7, outline.position[1], outline.position[2] - 9]);
  });

  it("keeps decoration out of actual raycasts and invisible item proxies pickable", () => {
    const geometry = new BufferGeometry().setFromPoints([new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(1, 0, 1), new Vector3(-1, 0, 1)]);
    const material = new LineBasicMaterial();
    const outline = new LineLoop(geometry, material);
    const ray = new Raycaster(new Vector3(1, 10, 0), new Vector3(0, -1, 0));
    ray.params.Line.threshold = .1;
    const proxyGeometry = new BoxGeometry(2, 1, 2), proxyMaterial = new MeshBasicMaterial();
    const proxy = new Mesh(proxyGeometry, proxyMaterial);
    proxy.visible = false;
    proxy.name = "item-pick-proxy";
    const root = new Group();
    root.name = "furniture-selected-item";
    root.add(proxy);
    root.updateMatrixWorld(true);
    try {
      expect(ray.intersectObject(outline)).not.toHaveLength(0);
      outline.raycast = ignoreSelectionOutlineRaycast;
      expect(ray.intersectObject(outline)).toHaveLength(0);
      const hits = ray.intersectObject(root, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.object.parent?.name).toBe("furniture-selected-item");
    } finally { geometry.dispose(); material.dispose(); proxyGeometry.dispose(); proxyMaterial.dispose(); }
  });
});
