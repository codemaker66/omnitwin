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
import { createTrestle4ftProxy } from "../createTrestle4ftProxy.js";

const EXPECTED_DIMENSIONS = [1.22, 0.74, 0.76] as const;
const EXPECTED_SUPPORT_CENTRES = [-0.4, 0.4] as const;

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

function worldPosition(object: Object3D): readonly [number, number, number] {
  const position = object.getWorldPosition(new Vector3());
  return [position.x, position.y, position.z];
}

describe("createTrestle4ftProxy", () => {
  it("builds the exact compact catalogue envelope from a unit root at floor level", () => {
    const root = createTrestle4ftProxy();
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

  it("publishes exact generated provenance without measured, operational, or physics authority", () => {
    const root = createTrestle4ftProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      colliderAuthority: "metadata-only",
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#trestle-4ft",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/trestle-4ft-imagegen-v1.png",
      supportStationCentresXMetres: EXPECTED_SUPPORT_CENTRES,
    });
    expect(root.userData.supportEndOverhangMetres).toBeCloseTo(0.21, 12);
    expect(root.userData.referenceLimitations).toContain(
      "rear and underside construction are symmetric approximations",
    );
  });

  it("authors compact support spacing and stretcher length instead of scaling the six-foot frame", () => {
    const root = createTrestle4ftProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const leftRail = runtime.nodes["left-underside-rail"];
    const rightRail = runtime.nodes["right-underside-rail"];
    const stretcher = runtime.nodes.stretcher;

    expect(leftRail).toBeDefined();
    expect(rightRail).toBeDefined();
    expect(stretcher).toBeDefined();
    expect(worldPosition(leftRail!)[0]).toBeCloseTo(-0.4, 6);
    expect(worldPosition(rightRail!)[0]).toBeCloseTo(0.4, 6);

    const stretcherSize = new Box3().setFromObject(stretcher!).getSize(new Vector3());
    expect(stretcherSize.x).toBeCloseTo(0.84, 6);
    expect(stretcherSize.y).toBeCloseTo(0.055, 6);
    expect(stretcherSize.z).toBeCloseTo(0.05, 6);
  });

  it("exposes every visible mesh through complete unique runtime maps", () => {
    const root = createTrestle4ftProxy();
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
    expect(runtime.colliders.root).toEqual({ shape: "box", size: EXPECTED_DIMENSIONS });
  });

  it("preserves the visible upright, brace, hinge, bolt, and terminal counts", () => {
    const runtime = readImg2ThreeSculptRuntime(createTrestle4ftProxy());
    const ids = Object.keys(runtime.nodes);

    expect(ids.filter((id) => /-(front|rear)-upright$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /-(front|rear)-diagonal-brace$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /-(front|rear)-hinge-plate-detail$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /-hinge-bolt-(lower|upper)-detail$/.test(id))).toHaveLength(8);
    expect(ids.filter((id) => /-stretcher-bolt-detail$/.test(id))).toHaveLength(4);
    expect(ids.filter((id) => /-(front|rear)-foot-cap$/.test(id))).toHaveLength(4);
  });

  it("publishes planning sockets and non-empty semantic inspection groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createTrestle4ftProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "floor-contact",
      "left-support-centre",
      "right-support-centre",
      "stretcher-centre",
      "tabletop-centre",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "brace-system",
      "fastener-system",
      "foot-system",
      "frame",
      "left-support",
      "right-support",
      "stretcher",
      "support-stations",
      "tabletop",
    ]);
    expect(runtime.destructionGroups["left-support"]).toContain(
      runtime.nodes["left-front-upright"],
    );
    expect(runtime.destructionGroups["brace-system"]).toContain(
      runtime.nodes["right-rear-diagonal-brace"],
    );
    expect(Object.values(runtime.destructionGroups).every((group) => group.length > 0)).toBe(true);
  });

  it("keeps integral surface details with their semantic parent during explode", () => {
    const root = createTrestle4ftProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.18 });
    const detailIds = Object.keys(runtime.nodes).filter(
      (id) => id !== "root" && runtime.nodes[id]?.userData.surfaceDetail === true,
    );

    expect(detailIds.length).toBeGreaterThanOrEqual(17);
    for (const id of detailIds) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);

    const bolt = runtime.meshes["left-front-hinge-bolt-lower-detail"];
    const resolved = bolt === undefined ? null : presentation.resolveInspectionPart(bolt);
    expect(resolved?.id).toBe("left-front-hinge-plate-detail");
  });

  it("creates fresh geometry, materials, and stable named procedural maps for every root", () => {
    const first = createTrestle4ftProxy();
    const second = createTrestle4ftProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);
    const firstMapNames = [...textureMaps(first)].map((map) => map.name).sort();

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(textureMaps(first).size).toBeGreaterThanOrEqual(4);
    expect([...textureMaps(first)].every((map) => !secondMaps.has(map))).toBe(true);
    expect(firstMapNames).toEqual([
      "trestle-4ft-oak-albedo",
      "trestle-4ft-oak-bump",
      "trestle-4ft-oak-roughness",
      "trestle-4ft-powder-coat-roughness",
    ]);
    expect(rootMapNames(first)).toEqual(firstMapNames);
  });
});

function rootMapNames(root: Object3D): readonly string[] {
  const names: unknown = root.userData.proceduralMapNames;
  if (!Array.isArray(names) || !names.every((name): name is string => typeof name === "string")) {
    return [];
  }
  return [...names].sort();
}
