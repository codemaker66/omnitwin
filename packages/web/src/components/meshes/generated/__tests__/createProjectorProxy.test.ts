import {
  Box3,
  Material,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createProjectorProxy } from "../createProjectorProxy.js";

const EXPECTED_DIMENSIONS = [0.55, 0.1, 0.35] as const;

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

function textureMaps(root: Object3D): Set<Texture> {
  const result = new Set<Texture>();
  for (const material of materials(root)) {
    if (!(material instanceof MeshStandardMaterial)) continue;
    for (const map of [
      material.map,
      material.bumpMap,
      material.normalMap,
      material.roughnessMap,
    ]) {
      if (map !== null) result.add(map);
    }
  }
  return result;
}

describe("createProjectorProxy", () => {
  it("builds the exact catalogue envelope from a unit root at floor level", () => {
    const root = createProjectorProxy();
    const bounds = new Box3().setFromObject(root);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 6);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 6);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 6);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("publishes honest ImageGen provenance without measured, operational, or physics authority", () => {
    const root = createProjectorProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/projector-imagegen-v1.png",
      colliderAuthority: "metadata-only",
    });
  });

  it("exposes every visible mesh through complete unique runtime maps", () => {
    const root = createProjectorProxy();
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
      "chassis-shell",
      "top-shell",
      "front-fascia",
      "top-inset-panel",
      "shell-shadow-band",
      "optical-assembly",
      "lens-bezel-stack",
      "lens-inner-bezel",
      "lens-glass",
      "front-vent-system",
      "front-right-vent",
      "side-vent-system",
      "rear-connector-recess",
      "foot-system",
      "front-right-foot",
      "rear-left-foot",
      "rear-right-foot",
    ]) {
      expect(runtime.nodes[id]).toBeDefined();
      expect(runtime.meshes[id]).toBeDefined();
      expect(runtime.colliders[id]).toBeDefined();
    }
  });

  it("preserves the evidenced louvre and support counts", () => {
    const runtime = readImg2ThreeSculptRuntime(createProjectorProxy());
    const ids = Object.keys(runtime.nodes);

    expect(ids.filter((id) => /^front-left-louvre-\d+$/.test(id))).toHaveLength(7);
    expect(ids.filter((id) => /^front-right-louvre-\d+$/.test(id))).toHaveLength(7);
    expect(ids.filter((id) => /^right-side-louvre-\d+$/.test(id))).toHaveLength(11);
    expect([
      "foot-system",
      "front-right-foot",
      "rear-left-foot",
      "rear-right-foot",
    ].every((id) => ids.includes(id))).toBe(true);
  });

  it("publishes venue-planning sockets and semantic presentation groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createProjectorProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "floor-contact",
      "lens-origin",
      "mount-centre",
      "power-rear",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "feet",
      "optics",
      "rear-detail",
      "shell",
      "ventilation",
    ]);
    expect(runtime.destructionGroups.optics).toContain(runtime.nodes["optical-assembly"]);
    expect(runtime.destructionGroups.ventilation).toContain(runtime.nodes["side-vent-system"]);
  });

  it("keeps surface details with their semantic parents during explode", () => {
    const root = createProjectorProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.18 });
    const detailIds = Object.keys(runtime.nodes).filter(
      (id) => id !== "root" && runtime.nodes[id]?.userData.surfaceDetail === true,
    );

    expect(detailIds.length).toBeGreaterThanOrEqual(34);
    for (const id of detailIds) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);

    const slat = runtime.meshes["front-left-louvre-1"];
    const resolved = slat === undefined ? null : presentation.resolveInspectionPart(slat);
    expect(resolved?.id).toBe("front-vent-system");
  });

  it("creates fresh geometry, materials, and procedural maps for every root", () => {
    const first = createProjectorProxy();
    const second = createProjectorProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(textureMaps(first).size).toBeGreaterThanOrEqual(3);
    expect([...textureMaps(first)].every((map) => !secondMaps.has(map))).toBe(true);
    expect([...textureMaps(first)].every((map) => map.name.startsWith("projector-"))).toBe(true);
  });
});
