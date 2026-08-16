import {
  Box3,
  ExtrudeGeometry,
  LatheGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createPoseurTableProxy } from "../createPoseurTableProxy.js";

const EXPECTED_DIMENSIONS = [0.6, 1.05, 0.6] as const;

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
      material.aoMap,
      material.bumpMap,
      material.normalMap,
      material.roughnessMap,
    ]) {
      if (map !== null) result.add(map);
    }
  }
  return result;
}

describe("createPoseurTableProxy", () => {
  it("builds the exact catalogue envelope from a unit root at floor level", () => {
    const root = createPoseurTableProxy();
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
    const root = createPoseurTableProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/poseur-table-imagegen-v1.png",
      colliderAuthority: "metadata-only",
    });
  });

  it("exposes every visible mesh through named nodes and complete collider metadata", () => {
    const root = createPoseurTableProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);

    expect(runtime.nodes.root).toBe(root);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);

    for (const id of [
      "tabletop-assembly",
      "top-surface",
      "rolled-rim",
      "underside-band",
      "underplate",
      "pedestal-assembly",
      "upper-collar",
      "pedestal-column",
      "lower-collar",
      "base-assembly",
      "central-hub",
      "star-arm-system",
      "foot-stem-system",
      "foot-pad-system",
    ]) {
      expect(runtime.nodes[id]).toBeDefined();
      expect(runtime.colliders[id]).toBeDefined();
    }
    expect(runtime.meshes["top-surface"]).toBeDefined();
    expect(runtime.meshes["pedestal-column"]).toBeDefined();
    expect(runtime.meshes["central-hub"]).toBeDefined();
  });

  it("preserves the four-star silhouette, stepped feet, and non-box identity geometry", () => {
    const runtime = readImg2ThreeSculptRuntime(createPoseurTableProxy());
    const ids = Object.keys(runtime.meshes);

    expect(ids.filter((id) => /^arm-(north|east|south|west)$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /^foot-stem-(north|east|south|west)$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /^foot-pad-(north|east|south|west)$/.test(id))).toHaveLength(4);
    expect(runtime.meshes["rolled-rim"]?.geometry).toBeInstanceOf(TorusGeometry);
    expect(runtime.meshes["arm-north"]?.geometry).toBeInstanceOf(ExtrudeGeometry);
    expect(runtime.meshes["foot-pad-north"]?.geometry).toBeInstanceOf(LatheGeometry);
    expect(ids.some((id) => id.includes("cloth") || id.includes("chair"))).toBe(false);
  });

  it("publishes planning sockets and semantic destruction groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createPoseurTableProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "floor-contact",
      "foot-east",
      "foot-north",
      "foot-south",
      "foot-west",
      "pedestal-to-base",
      "tabletop-centre",
      "top-to-pedestal",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "levelling-feet",
      "pedestal",
      "star-base",
      "tabletop",
    ]);
    expect(runtime.destructionGroups.tabletop).toContain(runtime.nodes["rolled-rim"]);
    expect(runtime.destructionGroups["star-base"]).toContain(runtime.nodes["arm-north"]);
    expect(runtime.destructionGroups["levelling-feet"]).toContain(runtime.nodes["foot-pad-west"]);
  });

  it("supports part inspection and keeps semantic containers from double-exploding", () => {
    const root = createPoseurTableProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.18,
      origin: [0, 0.5, 0],
    });

    for (const id of [
      "tabletop-assembly",
      "pedestal-assembly",
      "base-assembly",
      "star-arm-system",
      "foot-stem-system",
      "foot-pad-system",
    ]) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);
    expect(presentation.resolveInspectionPart(runtime.meshes["arm-north"] as Mesh)?.id)
      .toBe("arm-north");
    expect(presentation.resolveInspectionPart(runtime.meshes["top-surface"] as Mesh)?.id)
      .toBe("top-surface");
  });

  it("creates fresh geometry, materials, and independently named PBR maps", () => {
    const first = createPoseurTableProxy();
    const second = createPoseurTableProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);
    const firstMaps = [...textureMaps(first)];

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(firstMaps).toHaveLength(15);
    expect(firstMaps.every((map) => !secondMaps.has(map))).toBe(true);
    expect(new Set(firstMaps.map((map) => map.name)).size).toBe(firstMaps.length);
    expect(firstMaps.every((map) => map.name.startsWith("poseur-table-"))).toBe(true);
    expect(firstMaps.filter((map) => map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === SRGBColorSpace)).toBe(true);
    expect(firstMaps.filter((map) => !map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === NoColorSpace)).toBe(true);
  });
});
