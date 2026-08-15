import {
  Box3,
  DataTexture,
  InstancedMesh,
  LatheGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createMicrophoneProxy } from "../createMicrophoneProxy.js";

const EXPECTED_DIMENSIONS = [0.10, 0.25, 0.10] as const;

function modelMeshes(root: Object3D): Mesh[] {
  const result: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) result.push(object);
  });
  return result;
}

function modelMaterials(root: Object3D): Set<Material> {
  const result = new Set<Material>();
  for (const mesh of modelMeshes(root)) {
    const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of entries) result.add(material);
  }
  return result;
}

function modelTextures(root: Object3D): Set<Texture> {
  const result = new Set<Texture>();
  for (const material of modelMaterials(root)) {
    if (!(material instanceof MeshStandardMaterial)) continue;
    for (const texture of [
      material.map,
      material.aoMap,
      material.bumpMap,
      material.normalMap,
      material.roughnessMap,
    ]) {
      if (texture !== null) result.add(texture);
    }
  }
  return result;
}

function worldBounds(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true);
  return new Box3().setFromObject(object);
}

describe("createMicrophoneProxy", () => {
  it("builds the exact catalogue envelope from a unit root at tabletop level", () => {
    const root = createMicrophoneProxy();
    const bounds = worldBounds(root);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 6);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 6);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 6);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y).toBeCloseTo(0.25, 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("publishes honest generated provenance without measured, operational, or physics authority", () => {
    const root = createMicrophoneProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      sourceKind: "ai-generated-image",
      generator: "OpenAI ImageGen",
      geometryKind: "procedural-generated-stand-in",
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#microphone",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/microphone-imagegen-v1.png",
      colliderAuthority: "metadata-only",
    });
    expect(root.userData.limitations.join(" ")).toContain("not measured venue evidence");
    expect(root.userData.limitations.join(" ")).toContain("cable routing");
    expect(root.userData.limitations.join(" ")).toContain("metadata only");
  });

  it("exposes every visible mesh through a complete named action runtime", () => {
    const root = createMicrophoneProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const meshes = modelMeshes(root);

    expect(runtime.nodes.root).toBe(root);
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(meshes));
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(meshes.map((mesh) => mesh.name)).size).toBe(meshes.length);
    expect(meshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);
    expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);

    for (const id of [
      "base-assembly",
      "upper-base-shell",
      "lower-base-plinth",
      "perimeter-seam",
      "rubber-foot-system",
      "mute-switch",
      "status-indicator",
      "neck-gland",
      "gooseneck-assembly",
      "gooseneck-core",
      "gooseneck-rib-system",
      "capsule-assembly",
      "capsule-rear-collar",
      "capsule-transition-collar",
      "capsule-barrel",
      "grille-ring",
      "grille-face",
      "grille-perforation-system",
    ]) {
      expect(runtime.nodes[id], `missing runtime node ${id}`).toBeDefined();
      expect(runtime.colliders[id], `missing collider ${id}`).toMatchObject({
        approximate: true,
        authority: "presentation-only",
      });
    }
  });

  it("uses volumetric geometry for the weighted base, gland, curved neck, rib sheath, capsule, and grille", () => {
    const runtime = readImg2ThreeSculptRuntime(createMicrophoneProxy());

    expect(runtime.meshes["upper-base-shell"]?.geometry).toBeInstanceOf(RoundedBoxGeometry);
    expect(runtime.meshes["neck-gland"]?.geometry).toBeInstanceOf(LatheGeometry);
    expect(runtime.meshes["gooseneck-core"]?.geometry).toBeInstanceOf(TubeGeometry);
    expect(runtime.meshes["gooseneck-rib-system"]).toBeInstanceOf(InstancedMesh);
    expect(runtime.meshes["gooseneck-rib-system"]?.geometry).toBeInstanceOf(TorusGeometry);
    expect((runtime.meshes["gooseneck-rib-system"] as InstancedMesh).count).toBe(40);
    expect(runtime.meshes["grille-ring"]?.geometry).toBeInstanceOf(TorusGeometry);
    expect(runtime.meshes["grille-perforation-system"]).toBeInstanceOf(InstancedMesh);
    expect((runtime.meshes["grille-perforation-system"] as InstancedMesh).count).toBe(37);

    const ids = Object.keys(runtime.nodes).join(" ");
    for (const forbidden of ["cable", "connector", "logo", "speaker", "tripod"]) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it("folds minor relief into parents while exposing the 40-rib system as one semantic part", () => {
    const root = createMicrophoneProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.05,
      origin: [0, 0.125, 0],
    });

    expect(runtime.nodes["perimeter-seam"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["status-indicator"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["grille-perforation-system"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["perimeter-seam"]?.userData.surfaceDetail).toBe(true);
    expect(runtime.nodes["status-indicator"]?.userData.surfaceDetail).toBe(true);
    expect(runtime.nodes["grille-perforation-system"]?.userData.surfaceDetail).toBe(true);
    expect(runtime.nodes["gooseneck-rib-system"]?.userData).toMatchObject({
      explodeWithParent: false,
      surfaceDetail: false,
    });
    expect(presentation.resolveInspectionPart(runtime.meshes["perimeter-seam"] as Mesh)?.id)
      .toBe("base-assembly");
    expect(presentation.resolveInspectionPart(runtime.meshes["status-indicator"] as Mesh)?.id)
      .toBe("mute-switch");
    expect(presentation.resolveInspectionPart(runtime.meshes["gooseneck-rib-system"] as Mesh)?.id)
      .toBe("gooseneck-rib-system");
    expect(presentation.resolveInspectionPart(runtime.meshes["grille-perforation-system"] as Mesh)?.id)
      .toBe("grille-face");

    const ribPivot = runtime.nodes["gooseneck-rib-system"];
    if (ribPivot === undefined) throw new Error("missing gooseneck rib-system pivot");
    const restingRibPosition = ribPivot.position.toArray();
    presentation.setExplodeProgress(1);
    expect(ribPivot.position.toArray()).not.toEqual(restingRibPosition);
    presentation.restore();
    expect(ribPivot.position.toArray()).toEqual(restingRibPosition);
  });

  it("publishes planning sockets, semantic destruction groups, and connected contact joints", () => {
    const root = createMicrophoneProxy();
    const runtime = readImg2ThreeSculptRuntime(root);

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "capsule-axis",
      "control-centre",
      "floor-contact",
      "neck-mount",
      "plan-anchor",
      "speaker-target",
      "tabletop-contact",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "capsule",
      "controls",
      "gooseneck",
      "weighted-base",
    ]);
    expect(runtime.destructionGroups.gooseneck).toContain(runtime.nodes["gooseneck-core"]);
    expect(runtime.destructionGroups.capsule).toContain(runtime.nodes["grille-face"]);

    for (const [first, second] of [
      ["rubber-foot-system", "lower-base-plinth"],
      ["lower-base-plinth", "upper-base-shell"],
      ["upper-base-shell", "neck-gland"],
      ["neck-gland", "gooseneck-core"],
      ["gooseneck-core", "capsule-rear-collar"],
      ["capsule-rear-collar", "capsule-transition-collar"],
      ["capsule-transition-collar", "capsule-barrel"],
      ["capsule-barrel", "grille-ring"],
      ["grille-ring", "grille-face"],
    ] as const) {
      const firstNode = runtime.nodes[first];
      const secondNode = runtime.nodes[second];
      if (firstNode === undefined || secondNode === undefined) {
        throw new Error(`missing contact fixture ${first}/${second}`);
      }
      expect(worldBounds(firstNode).clone().expandByScalar(0.0005)
        .intersectsBox(worldBounds(secondNode))).toBe(true);
    }
  });

  it("creates fresh geometry, materials, and independently named PBR maps", () => {
    const first = createMicrophoneProxy();
    const second = createMicrophoneProxy();
    const secondGeometries = new Set(modelMeshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = modelMaterials(second);
    const secondTextures = modelTextures(second);
    const firstTextures = [...modelTextures(first)];

    expect(modelMeshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...modelMaterials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(firstTextures).toHaveLength(30);
    expect(firstTextures.every((texture) => texture instanceof DataTexture)).toBe(true);
    expect(firstTextures.every((texture) => !secondTextures.has(texture))).toBe(true);
    expect(new Set(firstTextures.map((texture) => texture.name)).size).toBe(firstTextures.length);
    expect(firstTextures.every((texture) => texture.name.startsWith("microphone-"))).toBe(true);
    expect(firstTextures.filter((texture) => texture.name.endsWith("-albedo"))
      .every((texture) => texture.colorSpace === SRGBColorSpace)).toBe(true);
    expect(firstTextures.filter((texture) => !texture.name.endsWith("-albedo"))
      .every((texture) => texture.colorSpace === NoColorSpace)).toBe(true);
  });
});
