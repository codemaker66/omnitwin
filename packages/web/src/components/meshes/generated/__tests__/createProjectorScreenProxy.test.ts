import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createProjectorScreenProxy } from "../createProjectorScreenProxy.js";

const EXPECTED_DIMENSIONS = [2.5, 1.8, 0.6] as const;

function meshes(root: Object3D): Mesh[] {
  const result: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) result.push(object);
  });
  return result;
}

function materials(root: Object3D): Set<Material> {
  const result = new Set<Material>();
  for (const mesh of meshes(root)) {
    const owned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of owned) result.add(material);
  }
  return result;
}

function materialMaps(root: Object3D): Set<Texture> {
  const result = new Set<Texture>();
  for (const material of materials(root)) {
    if (material instanceof MeshStandardMaterial && material.map !== null) {
      result.add(material.map);
    }
  }
  return result;
}

describe("createProjectorScreenProxy", () => {
  it("builds the exact catalogue envelope from a unit root at floor level", () => {
    const root = createProjectorScreenProxy();
    const bounds = new Box3().setFromObject(root);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 5);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 5);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 5);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("publishes honest generated provenance without measured or physics authority", () => {
    const root = createProjectorScreenProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector-screen",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/projector-screen-imagegen-v1.png",
    });
    expect(root.userData.colliderAuthority).toBe("metadata-only");
  });

  it("exposes every visible mesh as a unique named node with collider metadata", () => {
    const root = createProjectorScreenProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);
    const nodeIds = Object.keys(runtime.nodes).filter((id) => id !== "root").sort();
    const meshIds = Object.keys(runtime.meshes).sort();

    expect(runtime.nodes.root).toBe(root);
    expect(nodeIds).toEqual(meshIds);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);

    for (const id of [
      "screen-surface",
      "top-frame-rail",
      "bottom-frame-rail",
      "left-lower-post",
      "right-lower-post",
      "left-base-rail",
      "right-base-rail",
      "left-front-brace",
      "left-rear-brace",
      "right-front-brace",
      "right-rear-brace",
      "upper-left-corner-cap",
      "upper-right-corner-cap",
      "left-mid-joint-plate",
      "left-base-collar",
      "left-front-foot",
    ]) {
      expect(runtime.nodes[id]).toBeDefined();
      expect(runtime.meshes[id]).toBeDefined();
      expect(runtime.colliders[id]).toBeDefined();
    }
  });

  it("provides support, projection, floor, and screen sockets plus semantic groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createProjectorScreenProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "floor-contact",
      "left-support",
      "projection-front",
      "right-support",
      "screen-centre",
      "top-centre",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "frame",
      "hardware",
      "left-support",
      "right-support",
      "screen",
      "supports",
    ]);
    expect(runtime.destructionGroups.screen).toContain(runtime.nodes["screen-surface"]);
    expect(runtime.destructionGroups["left-support"]).toContain(
      runtime.nodes["left-front-brace"],
    );
  });

  it("keeps subordinate hardware attached during explode and honours shadow options", () => {
    const root = createProjectorScreenProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.3 });
    const detailIds = Object.keys(runtime.nodes).filter(
      (id) => id !== "root" && runtime.nodes[id]?.userData.surfaceDetail === true,
    );

    expect(detailIds.length).toBeGreaterThanOrEqual(14);
    for (const id of detailIds) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);

    const bolt = runtime.meshes["upper-left-corner-fastener"];
    const resolved = bolt === undefined ? null : presentation.resolveInspectionPart(bolt);
    expect(resolved?.id).toBe("top-frame-rail");
  });

  it("creates fresh geometry, materials, and procedural fabric texture per root", () => {
    const first = createProjectorScreenProxy();
    const second = createProjectorScreenProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = materialMaps(second);

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(materialMaps(first).size).toBeGreaterThan(0);
    expect([...materialMaps(first)].every((map) => !secondMaps.has(map))).toBe(true);
  });

  it("keeps every mesh physically connected to the assembly", () => {
    const root = createProjectorScreenProxy();
    root.updateMatrixWorld(true);
    const boxed = meshes(root).map((mesh) => ({ mesh, box: new Box3().setFromObject(mesh) }));
    const epsilon = 0.001;
    const related = (first: Object3D, second: Object3D): boolean => {
      for (let node: Object3D | null = first; node !== null; node = node.parent) {
        if (node === second) return true;
      }
      for (let node: Object3D | null = second; node !== null; node = node.parent) {
        if (node === first) return true;
      }
      return false;
    };
    const floating = boxed
      .filter(({ mesh, box }) => {
        const expanded = box.clone().expandByScalar(epsilon);
        return !boxed.some(({ mesh: other, box: otherBox }) => (
          other !== mesh && !related(mesh, other) && expanded.intersectsBox(otherBox)
        ));
      })
      .map(({ mesh }) => mesh.name);

    expect(floating).toEqual([]);
  });
});
