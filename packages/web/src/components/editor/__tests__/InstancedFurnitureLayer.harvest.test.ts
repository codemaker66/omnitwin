import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { mergePartsByMaterial } from "../../../lib/furniture-instancing.js";
import { createGltfFurnitureInstance } from "../../../lib/gltf-furniture-instance.js";
import { createMicrophoneProxy } from "../../meshes/generated/createMicrophoneProxy.js";
import { disposeGeneratedFurnitureObject } from "../../meshes/generated/generatedFurnitureRegistry.js";
import {
  collectMeshInstancesForHarvest,
  disposeVariant,
  harvestVariant,
  type HarvestMeshInstance,
} from "../InstancedFurnitureLayer.js";

interface HarvestedPartSummary {
  readonly count: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly positionCount: number;
  readonly maximumNormalLengthError: number;
}

type ExpectedPartSummary = Omit<HarvestedPartSummary, "maximumNormalLengthError">;

function expectPartSummary(
  actual: HarvestedPartSummary,
  expected: ExpectedPartSummary,
): void {
  expect(actual.count).toBe(expected.count);
  expect(actual.positionCount).toBe(expected.positionCount);
  for (let axis = 0; axis < 3; axis += 1) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis] ?? 0, 8);
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis] ?? 0, 8);
  }
  expect(actual.maximumNormalLengthError).toBeLessThan(1e-6);
}

function summarizePart(
  instances: readonly HarvestMeshInstance[],
  meshName: string,
): HarvestedPartSummary {
  const selected = instances.filter(({ mesh }) => mesh.name === meshName);
  const groups = mergePartsByMaterial(selected.map(({ mesh, matrix }) => ({
    geometry: mesh.geometry,
    materialKey: "target",
    matrix,
  })));

  try {
    const group = groups[0];
    if (group === undefined || groups.length !== 1) {
      throw new Error(`Expected one merged geometry for ${meshName}`);
    }
    group.geometry.computeBoundingBox();
    const bounds = group.geometry.boundingBox;
    if (bounds === null) throw new Error(`Expected bounds for ${meshName}`);
    const normals = group.geometry.getAttribute("normal");
    let maximumNormalLengthError = 0;
    for (let index = 0; index < normals.count; index += 1) {
      const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
      maximumNormalLengthError = Math.max(maximumNormalLengthError, Math.abs(1 - length));
    }
    return {
      count: selected.length,
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      positionCount: group.geometry.getAttribute("position").count,
      maximumNormalLengthError,
    };
  } finally {
    for (const group of groups) group.geometry.dispose();
  }
}

describe("collectMeshInstancesForHarvest", () => {
  it("expands every microphone rib, foot, and grille cell with canonical aggregate bounds", () => {
    const microphone = createMicrophoneProxy();
    const templateRoot = new Group();
    templateRoot.position.set(4, -3, 9);
    templateRoot.rotation.set(0.2, -0.4, 0.1);
    templateRoot.scale.set(1.4, 0.8, 1.2);
    templateRoot.add(microphone);

    try {
      const instances = collectMeshInstancesForHarvest(templateRoot);
      expect(instances).toHaveLength(93);
      expectPartSummary(summarizePart(instances, "rubber-foot-system__mesh"), {
        count: 4,
        min: [-0.04349999874830246, 0, -0.04149999842047691],
        max: [0.04349999874830246, 0.004000000189989805, 0.04149999842047691],
        positionCount: 3600,
      });
      expectPartSummary(summarizePart(instances, "gooseneck-rib-system__mesh"), {
        count: 40,
        min: [-0.003650000086054206, 0.05227842554450035, -0.010797539725899696],
        max: [0.003650000086054206, 0.23459695279598236, 0.024776652455329895],
        positionCount: 4760,
      });
      expectPartSummary(summarizePart(instances, "grille-perforation-system__mesh"), {
        count: 37,
        min: [-0.008020000532269478, 0.23287999629974365, -0.04922499880194664],
        max: [0.008020000532269478, 0.2471199929714203, -0.048774998635053635],
        positionCount: 1924,
      });
    } finally {
      disposeGeneratedFurnitureObject(microphone);
    }
  });

  it("preserves the existing relative transform for a non-instanced mesh", () => {
    const root = new Group();
    root.position.set(12, 5, -8);
    root.rotation.y = 0.7;
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.position.set(2, 3, 4);
    root.add(mesh);

    try {
      const instances = collectMeshInstancesForHarvest(root);
      expect(instances).toHaveLength(1);
      const position = new Vector3().setFromMatrixPosition(
        instances[0]?.matrix ?? new Matrix4(),
      );
      expect(position.x).toBeCloseTo(2, 12);
      expect(position.y).toBeCloseTo(3, 12);
      expect(position.z).toBeCloseTo(4, 12);
      expect(instances[0]?.mesh).toBe(mesh);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });

  it("keeps repeated source geometry factory-owned while merged clones are disposed", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const mesh = new InstancedMesh(geometry, material, 3);
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0));
    mesh.setMatrixAt(1, new Matrix4());
    mesh.setMatrixAt(2, new Matrix4().makeTranslation(2, 0, 0));
    const root = new Group();
    root.add(mesh);
    const sourceDispose = vi.spyOn(geometry, "dispose");
    const instances = collectMeshInstancesForHarvest(root);
    const groups = mergePartsByMaterial(instances.map(({ mesh: source, matrix }) => ({
      geometry: source.geometry,
      materialKey: "shared",
      matrix,
    })));

    expect(instances).toHaveLength(3);
    expect(instances.every(({ mesh: source }) => source.geometry === geometry)).toBe(true);
    expect(groups).toHaveLength(1);
    groups[0]?.geometry.computeBoundingBox();
    expect(groups[0]?.geometry.boundingBox?.min.x).toBeCloseTo(-2.5, 10);
    expect(groups[0]?.geometry.boundingBox?.max.x).toBeCloseTo(2.5, 10);
    for (const group of groups) group.geometry.dispose();
    expect(sourceDispose).not.toHaveBeenCalled();

    sourceDispose.mockRestore();
    geometry.dispose();
    material.dispose();
  });

  it("falls back without disposing source resources when inner instances carry colours", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const mesh = new InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(0, new Matrix4());
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(2, 0, 0));
    mesh.setColorAt(0, new Color("red"));
    const root = new Group();
    root.add(mesh);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    expect(() => collectMeshInstancesForHarvest(root)).toThrow(/per-instance colours/i);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();

    geometryDispose.mockRestore();
    materialDispose.mockRestore();
    geometry.dispose();
    material.dispose();
  });
});

describe("imported furniture harvest", () => {
  it("keeps separate PBR material identities and every multi-material primitive", () => {
    const geometry = new BoxGeometry(42, 88, 58);
    const metalnessMap = new Texture();
    const map = new Texture();
    const first = new MeshStandardMaterial({ map, metalnessMap });
    const second = new MeshStandardMaterial({ map, metalnessMap: new Texture() });
    // Same colour/roughness and unnamed textures must not accidentally merge.
    const source = new Group();
    source.add(new Mesh(geometry, [first, second, first, second, first, second]));
    const instance = createGltfFurnitureInstance(source, { width: 0.42, height: 0.88, depth: 0.58 });
    const root = new Group();
    root.add(instance.object);
    const variant = harvestVariant(root);
    expect(variant.groups).toHaveLength(2);
    const materials = [...variant.materialByKey.values()];
    expect(materials.every((material) => material instanceof MeshStandardMaterial)).toBe(true);
    expect(materials.map((material) => (material as MeshStandardMaterial).map)).toEqual([map, map]);
    expect(materials.map((material) => (material as MeshStandardMaterial).metalnessMap))
      .toEqual([metalnessMap, second.metalnessMap]);
    expect(variant.groups.reduce((sum, group) => sum + (group.geometry.index?.count ?? 0), 0)).toBe(36);
    expect([...variant.shadowsByKey.values()]).toEqual([
      { castShadow: true, receiveShadow: true }, { castShadow: true, receiveShadow: true },
    ]);
    const cachedGeometryDispose = vi.spyOn(geometry, "dispose");
    const cachedMaterialDispose = vi.spyOn(first, "dispose");
    const cachedMapDispose = vi.spyOn(map, "dispose");
    const ownedGeometryDispose = vi.spyOn(variant.groups[0]!.geometry, "dispose");
    const ownedMaterialDispose = vi.spyOn(materials[0]!, "dispose");
    disposeVariant(variant);
    instance.dispose();
    expect(ownedGeometryDispose).toHaveBeenCalledOnce();
    expect(ownedMaterialDispose).toHaveBeenCalledOnce();
    expect(cachedGeometryDispose).not.toHaveBeenCalled();
    expect(cachedMaterialDispose).not.toHaveBeenCalled();
    expect(cachedMapDispose).not.toHaveBeenCalled();
    geometry.dispose(); first.dispose(); second.dispose();
    map.dispose(); metalnessMap.dispose(); second.metalnessMap?.dispose();
  });

  it("respects the source draw range when batching a grouped primitive", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.setDrawRange(3, 9);
    const material = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(geometry, [material, material, material, material, material, material]));
    const variant = harvestVariant(root);
    expect(variant.groups).toHaveLength(1);
    expect(variant.groups[0]?.geometry.index?.count).toBe(9);
    disposeVariant(variant); geometry.dispose(); material.dispose();
  });
});
