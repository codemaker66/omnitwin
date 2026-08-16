import {
  Box3,
  DataTexture,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Raycaster,
  SRGBColorSpace,
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
import { createLecternProxy } from "../createLecternProxy.js";

const EXPECTED_DIMENSIONS = [0.6, 1.15, 0.5] as const;

function modelMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

function modelMaterials(root: Object3D): Set<Material> {
  const materials = new Set<Material>();
  for (const mesh of modelMeshes(root)) {
    const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of entries) materials.add(material);
  }
  return materials;
}

function materialTextures(material: Material): Texture[] {
  if (!(material instanceof MeshStandardMaterial)) return [];
  return [material.map, material.bumpMap, material.roughnessMap]
    .filter((texture): texture is Texture => texture !== null);
}

describe("createLecternProxy", () => {
  it("builds the exact catalogue envelope from a unit root at ground level", () => {
    const root = createLecternProxy();
    const bounds = new Box3().setFromObject(root);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 5);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 5);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 5);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y).toBeCloseTo(1.15, 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("publishes honest ImageGen provenance without measured or physics claims", () => {
    const root = createLecternProxy();

    expect(root.userData).toMatchObject({
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#lectern",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/lectern-imagegen-v1.png",
      sourceKind: "ai-generated-image",
      generator: "OpenAI ImageGen",
      geometryKind: "procedural-generated-stand-in",
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
    });
    expect(root.userData.limitations).toContain("not measured venue evidence");
    expect(root.userData.limitations.join(" ")).toContain("metadata only");
  });

  it("publishes a complete named action runtime", () => {
    const root = createLecternProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const meshes = modelMeshes(root);

    expect(runtime.nodes.root).toBe(root);
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(meshes));
    expect(new Set(meshes.map((mesh) => mesh.name)).size).toBe(meshes.length);
    expect(meshes.every((mesh) => mesh.name.trim().length > 0)).toBe(true);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "av-mount",
      "cable-pass-through",
      "floor-contact",
      "plan-anchor",
      "reading-surface-centre",
      "speaker-front",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "cabinet-shell",
      "cable-grommet",
      "deck-rails",
      "plinth-assembly",
      "public-panel-assembly",
      "reading-deck",
      "shelf-recess",
    ]);

    for (const id of [
      "plinth-assembly",
      "lower-plinth",
      "cabinet-assembly",
      "cabinet-shell",
      "front-panel-field",
      "front-panel-frame",
      "shelf-recess",
      "deck-assembly",
      "reading-deck",
      "deck-left-rail",
      "deck-right-rail",
      "deck-retaining-rail",
      "cable-grommet",
    ]) {
      expect(runtime.nodes[id], `missing lectern node ${id}`).toBeDefined();
      expect(runtime.colliders[id], `missing lectern collider ${id}`).toMatchObject({
        approximate: true,
        authority: "presentation-only",
      });
    }

    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.25 });
    const inspectionIds = new Set(presentation.inspectionParts.map((part) => part.id));
    for (const id of ["lower-plinth", "front-panel-field", "reading-deck", "cable-grommet"]) {
      expect(inspectionIds.has(id), `missing inspectable lectern part ${id}`).toBe(true);
    }
  });

  it("keeps moulding and fixture details attached to their semantic parent", () => {
    const root = createLecternProxy({ castShadow: false, receiveShadow: true });
    const meshes = modelMeshes(root);
    const details = meshes.filter((mesh) => mesh.userData.surfaceDetail === true);

    expect(details.length).toBeGreaterThanOrEqual(12);
    expect(details.every((mesh) => mesh.userData.explodeWithParent === true)).toBe(true);
    expect(details.every((mesh) => mesh.parent?.userData.explodeWithParent === true)).toBe(true);
    expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);
  });

  it("models the shelf recess as open geometry and retains the moulded public panel", () => {
    const root = createLecternProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    root.updateMatrixWorld(true);

    const shelfRay = new Raycaster(
      new Vector3(0, 0.91, -1),
      new Vector3(0, 0, 1),
      0,
      2,
    );
    const [shelfHit] = shelfRay.intersectObjects(modelMeshes(root), false);
    expect(shelfHit?.object.userData.componentId).toBe("shelf-recess");

    const panelRay = new Raycaster(
      new Vector3(0, 0.5, -1),
      new Vector3(0, 0, 1),
      0,
      2,
    );
    const [panelHit] = panelRay.intersectObjects(modelMeshes(root), false);
    expect(panelHit?.object.userData.componentId).toBe("front-panel-field");
    for (const id of [
      "front-panel-frame",
      "front-panel-frame-left-detail",
      "front-panel-moulding",
      "front-panel-moulding-right-detail",
    ]) {
      expect(runtime.meshes[id], `missing panel moulding ${id}`).toBeDefined();
    }
  });

  it("uses independent fresh geometry, material, and procedural texture resources", () => {
    const first = createLecternProxy();
    const second = createLecternProxy();
    const secondGeometries = new Set(modelMeshes(second).map((mesh) => mesh.geometry));
    const firstMaterials = modelMaterials(first);
    const secondMaterials = modelMaterials(second);
    const firstTextures = new Set([...firstMaterials].flatMap(materialTextures));
    const secondTextures = new Set([...secondMaterials].flatMap(materialTextures));

    expect(modelMeshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...firstMaterials].every((material) => !secondMaterials.has(material))).toBe(true);
    expect([...firstTextures].every((texture) => !secondTextures.has(texture))).toBe(true);
    expect([...firstTextures].every((texture) => texture instanceof DataTexture)).toBe(true);
  });

  it("uses directional sRGB albedo with independent bump and roughness fields", () => {
    const runtime = readImg2ThreeSculptRuntime(createLecternProxy());
    const expected = [
      ["reading-deck", "lectern-horizontal-walnut-albedo"],
      ["front-panel-field", "lectern-vertical-walnut-albedo"],
      ["front-panel-moulding", "lectern-moulding-walnut-albedo"],
    ] as const;

    for (const [id, mapName] of expected) {
      const mesh = runtime.meshes[id];
      if (mesh === undefined) throw new Error(`lectern material fixture ${id} is missing`);
      expect(mesh.material).toBeInstanceOf(MeshPhysicalMaterial);
      if (!(mesh.material instanceof MeshPhysicalMaterial)) {
        throw new Error(`lectern material fixture ${id} is not physical wood`);
      }
      expect(mesh.material.map?.name).toBe(mapName);
      expect(mesh.material.map?.colorSpace).toBe(SRGBColorSpace);
      expect(mesh.material.map?.image.width).toBe(1024);
      expect(mesh.material.map?.image.height).toBe(1024);
      expect(mesh.material.bumpMap?.name).toBe(mapName.replace("albedo", "bump"));
      expect(mesh.material.roughnessMap?.name).toBe(mapName.replace("albedo", "roughness"));
      expect(mesh.material.map).not.toBe(mesh.material.bumpMap);
      expect(mesh.material.map).not.toBe(mesh.material.roughnessMap);
      expect(mesh.material.metalness).toBe(0);
      expect(mesh.material.clearcoat).toBeCloseTo(0.1, 5);
      expect(mesh.material.clearcoatRoughness).toBeCloseTo(0.5, 5);
      expect(mesh.material.specularIntensity).toBeCloseTo(0.35, 5);
    }
  });

  it("keeps every visible mesh physically connected to the assembled lectern", () => {
    const root = createLecternProxy();
    root.updateMatrixWorld(true);
    const boxes = modelMeshes(root).map((mesh) => ({ mesh, box: new Box3().setFromObject(mesh) }));
    const isRelated = (a: Object3D, b: Object3D): boolean => {
      for (let node: Object3D | null = a; node !== null; node = node.parent) {
        if (node === b) return true;
      }
      for (let node: Object3D | null = b; node !== null; node = node.parent) {
        if (node === a) return true;
      }
      return false;
    };
    const orphans = boxes
      .filter(({ mesh, box }) => {
        const grown = box.clone().expandByScalar(0.001);
        return !boxes.some(({ mesh: other, box: otherBox }) => (
          mesh !== other && !isRelated(mesh, other) && grown.intersectsBox(otherBox)
        ));
      })
      .map(({ mesh }) => mesh.name);

    expect(orphans).toEqual([]);
  });
});
