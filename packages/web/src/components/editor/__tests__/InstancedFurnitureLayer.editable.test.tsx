import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import {
  Frustum,
  type InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../../lib/placement.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { normalizedFurniturePresentationScale } from "../../FurnitureProxy.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { disposeVariant, harvestVariant, InstancedFurnitureLayer } from "../InstancedFurnitureLayer.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

const CHAIR = catalogueId("banquet-chair");
const TABLE = catalogueId("round-table-6ft");

function chair(x: number, z: number, rotationY = 0, scale?: number): PlacedItem {
  const placed = createPlacedItem(CHAIR, x, z, rotationY);
  return scale === undefined ? placed : { ...placed, scale };
}

function StoreLayer({ opacity }: { readonly opacity?: number }): React.ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  return <InstancedFurnitureLayer items={items} opacity={opacity} />;
}

let mounted: StubRoot | null = null;

/** Render one frame, as the planner's demand loop does after each change. */
function frame(): void {
  act(() => { advance(performance.now(), true); });
}

function mountLayer(items: readonly PlacedItem[], opacity?: number): StubRoot {
  usePlacementStore.setState({ placedItems: [...items] });
  mounted = mountInStubRoot(<StoreLayer opacity={opacity} />);
  frame();
  return mounted;
}

function setItems(items: readonly PlacedItem[]): void {
  act(() => { usePlacementStore.setState({ placedItems: [...items] }); });
  frame();
}

function isInstancedMesh(object: Object3D): object is InstancedMesh {
  return (object as Partial<Pick<InstancedMesh, "isInstancedMesh">>).isInstancedMesh === true;
}

/** The batch meshes in scene order: variants in item order, then material groups. */
function batches(scene: Object3D): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  scene.getObjectByName("instanced-furniture")?.traverse((object) => {
    if (isInstancedMesh(object)) meshes.push(object);
  });
  return meshes;
}

function expectSameMeshes(actual: readonly InstancedMesh[], expected: readonly InstancedMesh[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((mesh, index) => { expect(mesh).toBe(expected[index]); });
}

/** Float32 values as uploaded; `+ 0` folds the sign of zero, which draws identically. */
function uploaded(values: ArrayLike<number>): number[] {
  return Array.from(new Float32Array(Array.from(values)), (value) => value + 0);
}

function expectedMatrix(item: PlacedItem): number[] {
  const transform = new Object3D();
  transform.position.set(item.x, item.y, item.z);
  transform.rotation.set(0, item.rotationY, 0);
  transform.scale.setScalar(normalizedFurniturePresentationScale(item.scale));
  transform.updateMatrix();
  return uploaded(transform.matrix.elements);
}

function expectDraws(mesh: InstancedMesh, items: readonly PlacedItem[]): void {
  expect(mesh.count).toBe(items.length);
  expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
  const drawn = Array.from({ length: mesh.count }, (_unused, index) => (
    uploaded(mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16))
  ));
  expect(drawn).toEqual(items.map(expectedMatrix));
}

function colourOf(material: Material | Material[]): number | null {
  if (material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial) {
    return material.color.getHex();
  }
  return null;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

describe("InstancedFurnitureLayer editable batches", () => {
  it("draws exact transforms with one mesh per material group and no scene object per item", () => {
    const chairs = Array.from({ length: 30 }, (_unused, index) => (
      chair(index * 0.7 - 10, (index % 5) * 0.9, index * 0.37, index % 3 === 0 ? 1.3 : undefined)
    ));
    const tableA = createPlacedItem(TABLE, -4, 6, 0.4);
    const tableB = { ...createPlacedItem(TABLE, 0, 6, -1.1), scale: 0.8 };
    const tableC = createPlacedItem(TABLE, 4, 6, 2.2);
    const tables = [tableA, tableB, tableC];
    const { scene } = mountLayer([tableA, ...chairs.slice(0, 10), tableB, ...chairs.slice(10), tableC]);

    const meshes = batches(scene);
    const chairMeshes = meshes.filter((mesh) => mesh.count === chairs.length);
    const tableMeshes = meshes.filter((mesh) => mesh.count === tables.length);
    expect(chairMeshes.length).toBeGreaterThan(0);
    expect(tableMeshes.length).toBeGreaterThan(0);
    expect(chairMeshes.length + tableMeshes.length).toBe(meshes.length);
    for (const mesh of chairMeshes) expectDraws(mesh, chairs);
    for (const mesh of tableMeshes) expectDraws(mesh, tables);

    // Only the hidden templates and the batch meshes: no object per item.
    const layer = scene.getObjectByName("instanced-furniture");
    const templates = layer?.children[0];
    let batchObjects = 0;
    for (const child of layer?.children ?? []) {
      if (child !== templates) child.traverse(() => { batchObjects += 1; });
    }
    expect(batchObjects).toBe(meshes.length);

    for (const mesh of meshes) {
      // drei's Instances always carried white instance colours; keeping them keeps the shader.
      expect(mesh.instanceColor?.array.every((value) => value === 1)).toBe(true);
      const ray = new Raycaster(new Vector3(-10, 5, 0), new Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh)).toEqual([]);
    }
  });

  it("keeps each harvested group's geometry, material, shadows and presentation opacity", () => {
    const { scene } = mountLayer([chair(0, 0), createPlacedItem(TABLE, 3, 0)], 0.5);
    const meshes = batches(scene);
    let offset = 0;
    for (const id of [CHAIR, TABLE]) {
      const template = scene.getObjectByName(`furniture-template-${id}`);
      if (template === undefined) throw new Error(`Missing template ${id}`);
      const reference = harvestVariant(template);
      try {
        reference.groups.forEach((group, index) => {
          const mesh = meshes[offset + index];
          const shadows = reference.shadowsByKey.get(group.materialKey);
          const base = reference.materialByKey.get(group.materialKey);
          if (mesh === undefined || shadows === undefined || base === undefined) throw new Error("Missing group");
          expect(mesh.geometry.getAttribute("position").count).toBe(group.geometry.getAttribute("position").count);
          expect(mesh.castShadow).toBe(shadows.castShadow);
          expect(mesh.receiveShadow).toBe(shadows.receiveShadow);
          if (Array.isArray(mesh.material)) throw new Error("Expected one material per group");
          expect(mesh.material.type).toBe(base.type);
          expect(colourOf(mesh.material)).toBe(colourOf(base));
          expect(mesh.material.opacity).toBeCloseTo(base.opacity * 0.5, 10);
          expect(mesh.material.transparent).toBe(true);
          expect(mesh.material.depthWrite).toBe(false);
        });
        offset += reference.groups.length;
      } finally {
        disposeVariant(reference);
      }
    }
    expect(offset).toBe(meshes.length);
  });

  it("keeps its meshes while furniture is added, moved and removed, and grows without overdrawing", () => {
    const chairs = Array.from({ length: 40 }, (_unused, index) => chair(index * 0.6, 0, index * 0.1));
    const { scene } = mountLayer(chairs.slice(0, 3));
    const first = batches(scene);
    expect(first.length).toBeGreaterThan(0);
    for (const mesh of first) expectDraws(mesh, chairs.slice(0, 3));

    setItems(chairs.slice(0, 23));
    expectSameMeshes(batches(scene), first);
    for (const mesh of first) expectDraws(mesh, chairs.slice(0, 23));

    // A drag recomposes and re-uploads only the item that moved.
    for (const mesh of first) mesh.instanceMatrix.clearUpdateRanges();
    const moved = chairs.slice(0, 23).map((item, index) => (index === 7 ? { ...item, x: item.x + 0.25 } : item));
    setItems(moved);
    expectSameMeshes(batches(scene), first);
    for (const mesh of first) {
      expectDraws(mesh, moved);
      expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 7 * 16, count: 16 }]);
    }

    setItems(moved.slice(0, 13));
    expectSameMeshes(batches(scene), first);
    for (const mesh of first) expectDraws(mesh, moved.slice(0, 13));

    setItems(chairs);
    const grown = batches(scene);
    expect(grown).toHaveLength(first.length);
    for (const mesh of grown) {
      expect(first).not.toContain(mesh);
      expect(mesh.instanceMatrix.count).toBe(64);
      expectDraws(mesh, chairs);
    }

    setItems(chairs.slice(0, 5));
    expectSameMeshes(batches(scene), grown);
    for (const mesh of grown) expectDraws(mesh, chairs.slice(0, 5));
  });

  it("does no instance work on frames where nothing changed", () => {
    const { scene } = mountLayer(Array.from({ length: 12 }, (_unused, index) => chair(index, 0)));
    const meshes = batches(scene);
    const versions = meshes.map((mesh) => mesh.instanceMatrix.version);
    for (let index = 0; index < 3; index += 1) frame();
    expectSameMeshes(batches(scene), meshes);
    expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(versions);
  });

  it("still draws furniture added far from the pieces a batch started with", () => {
    const west = [chair(-9, 0), chair(-9.6, 0.5), chair(-8.4, -0.5), chair(-9, 1)];
    const { scene } = mountLayer(west);
    const frustum = new Frustum();
    const drawnFrom = (target: Vector3): boolean[] => {
      const camera = new PerspectiveCamera(50, 1, 0.1, 30);
      camera.position.set(target.x, 3, target.z + 6);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      scene.updateMatrixWorld(true);
      // The renderer's own test. A culled mesh's sphere is computed on first
      // use and then kept, so it must never be left describing old instances.
      return batches(scene).map((mesh) => !mesh.frustumCulled || frustum.intersectsObject(mesh));
    };
    expect(drawnFrom(new Vector3(-9, 0, 0)).every(Boolean)).toBe(true);

    const east = [chair(9, 0), chair(9.6, 0.5), chair(8.4, -0.5), chair(9, 1)];
    setItems([...west, ...east]);
    const meshes = batches(scene);
    for (const mesh of meshes) expectDraws(mesh, [...west, ...east]);
    expect(drawnFrom(new Vector3(9, 0, 0))).toEqual(meshes.map(() => true));
  });
});
