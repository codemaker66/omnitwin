import {
  Box3,
  BufferGeometry,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import {
  createPoseurTableBlackProxy,
  createPoseurTableWhiteProxy,
} from "../createPoseurTableClothProxy.js";
import { createGeneratedFurniturePartManifest } from "../generatedFurniturePartManifest.js";

const EXPECTED_DIMENSIONS = [0.6, 1.05, 0.6] as const;
const DETAIL_IDS = ["upper-hem", "lower-hem", "vertical-seam"] as const;
const PAD_IDS = [
  "anchor-pad-front-left",
  "anchor-pad-front-right",
  "anchor-pad-rear-right",
  "anchor-pad-rear-left",
] as const;

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

function positionValues(geometry: BufferGeometry): readonly number[] {
  return Array.from(geometry.getAttribute("position").array);
}

describe("poseur table fitted-cloth proxies", () => {
  it.each([
    ["black", createPoseurTableBlackProxy],
    ["white", createPoseurTableWhiteProxy],
  ] as const)("builds the exact %s catalogue envelope from a unit root", (_variant, factory) => {
    const root = factory();
    const bounds = new Box3().setFromObject(root);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 6);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 6);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 6);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("uses one shared continuous hourglass form with four stretched lower anchors", () => {
    const blackRoot = createPoseurTableBlackProxy();
    const black = readImg2ThreeSculptRuntime(blackRoot);
    const white = readImg2ThreeSculptRuntime(createPoseurTableWhiteProxy());
    const blackGeometry = black.meshes["cover-assembly"]?.geometry;
    const whiteGeometry = white.meshes["cover-assembly"]?.geometry;

    expect(blackGeometry).toBeInstanceOf(BufferGeometry);
    expect(whiteGeometry).toBeInstanceOf(BufferGeometry);
    expect(blackGeometry).not.toBe(whiteGeometry);
    expect(positionValues(blackGeometry as BufferGeometry))
      .toEqual(positionValues(whiteGeometry as BufferGeometry));
    expect(Array.from((blackGeometry as BufferGeometry).getIndex()?.array ?? []))
      .toEqual(Array.from((whiteGeometry as BufferGeometry).getIndex()?.array ?? []));

    const lowerRing = positionValues(blackGeometry as BufferGeometry).slice(0, 97 * 3);
    const radiusAt = (segment: number): number => {
      const x = lowerRing[segment * 3] ?? 0;
      const z = lowerRing[segment * 3 + 2] ?? 0;
      return Math.hypot(x, z);
    };
    const anchorRadii = [12, 36, 60, 84].map(radiusAt);
    const spanRadii = [0, 24, 48, 72].map(radiusAt);

    expect(Math.min(...anchorRadii)).toBeGreaterThan(0.28);
    expect(Math.max(...spanRadii)).toBeLessThan(0.22);
    expect(Math.min(...anchorRadii) - Math.max(...spanRadii)).toBeGreaterThan(0.06);
    expect(meshes(blackRoot).every((mesh) => mesh.geometry.type !== "CylinderGeometry"))
      .toBe(true);
    expect(Object.keys(black.meshes).filter((id) => /cloth|overlay|pedestal|stem|metal/u.test(id)))
      .toEqual([]);
  });

  it("publishes exact variant evidence and the honest white material-only admission", () => {
    const black = createPoseurTableBlackProxy();
    const white = createPoseurTableWhiteProxy();

    expect(black.userData).toMatchObject({
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-black",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
      referenceImageSha256:
        "405d52d8507522342ce5497db377d8d82bbd33bc9bea7cd24589d7000fbb0b3c",
      geometryEvidenceImage:
        "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
      referenceAdmission: "admitted",
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      colliderAuthority: "metadata-only",
      rootScalePolicy: "unit-root",
      intrinsicClothVariant: true,
    });
    expect(white.userData).toMatchObject({
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-white",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/poseur-table-white-imagegen-v1.png",
      referenceImageSha256:
        "4a97f1c4dc382a2348b04ffac4b190643b1766c6468dc7f15d1023edbe37e812",
      geometryEvidenceImage:
        "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
      referenceAdmission: "failed-low-contrast-material-only",
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      colliderAuthority: "metadata-only",
      rootScalePolicy: "unit-root",
      intrinsicClothVariant: true,
    });
    expect(String(white.userData.approximationNotes)).toContain(
      "white reference failed low-contrast geometry admission",
    );
  });

  it.each([
    ["black", createPoseurTableBlackProxy],
    ["white", createPoseurTableWhiteProxy],
  ] as const)("exposes complete %s runtime nodes, meshes, colliders, sockets, and groups", (
    _variant,
    factory,
  ) => {
    const root = factory();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);

    expect(runtime.nodes.root).toBe(root);
    expect(Object.keys(runtime.nodes).sort()).toEqual([
      ...PAD_IDS,
      "cover-assembly",
      ...DETAIL_IDS,
      "root",
    ].sort());
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);
    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "anchor-front-left",
      "anchor-front-right",
      "anchor-rear-left",
      "anchor-rear-right",
      "cover-waist",
      "floor-contact",
      "tabletop-centre",
      "upper-cover-seam",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "cloth-cover",
      "cloth-relief",
      "floor-pad-system",
    ]);
    expect(runtime.destructionGroups["cloth-cover"]).toEqual([runtime.nodes["cover-assembly"]]);
    expect(runtime.destructionGroups["cloth-relief"]).toEqual(
      DETAIL_IDS.map((id) => runtime.nodes[id]),
    );
    expect(runtime.destructionGroups["floor-pad-system"]).toEqual(
      PAD_IDS.map((id) => runtime.nodes[id]),
    );
  });

  it("keeps relief details with the selectable fabric while anchors remain selectable", () => {
    const root = createPoseurTableBlackProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.18,
      origin: [0, 0.5, 0],
    });
    const restingBounds = new Box3().setFromObject(root);

    for (const id of DETAIL_IDS) {
      expect(runtime.nodes[id]?.userData.surfaceDetail).toBe(true);
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
      const detailMesh = runtime.meshes[id];
      expect(detailMesh === undefined ? null : presentation.resolveInspectionPart(detailMesh)?.id)
        .toBe("cover-assembly");
    }
    for (const id of PAD_IDS) {
      const padMesh = runtime.meshes[id];
      expect(padMesh === undefined ? null : presentation.resolveInspectionPart(padMesh)?.id)
        .toBe(id);
    }
    expect(presentation.resolveInspectionPart(runtime.meshes["cover-assembly"] as Mesh)?.id)
      .toBe("cover-assembly");
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);

    presentation.setExplodeProgress(1);
    presentation.restore();
    root.updateMatrixWorld(true);
    const restoredBounds = new Box3().setFromObject(root);
    expect(restoredBounds.min.toArray()).toEqual(restingBounds.min.toArray());
    expect(restoredBounds.max.toArray()).toEqual(restingBounds.max.toArray());
  });

  it.each([
    ["poseur-table-black", createPoseurTableBlackProxy],
    ["poseur-table-white", createPoseurTableWhiteProxy],
  ] as const)("creates fresh %s geometry, materials, and five-map PBR sets", (slug, factory) => {
    const first = factory();
    const second = factory();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);
    const firstMaps = [...textureMaps(first)];

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect([...materials(first)]).toHaveLength(2);
    expect([...materials(first)].some((material) => material instanceof MeshPhysicalMaterial))
      .toBe(true);
    expect([...materials(first)].every(
      (material) => material instanceof MeshStandardMaterial && material.metalness === 0,
    )).toBe(true);
    expect(firstMaps).toHaveLength(10);
    expect(firstMaps.every((map) => !secondMaps.has(map))).toBe(true);
    expect(new Set(firstMaps.map((map) => map.name)).size).toBe(firstMaps.length);
    expect(firstMaps.every((map) => map.name.startsWith(`${slug}-`))).toBe(true);
    expect(firstMaps.filter((map) => map.name.endsWith("-albedo")))
      .toHaveLength(2);
    expect(firstMaps.filter((map) => map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === SRGBColorSpace)).toBe(true);
    expect(firstMaps.filter((map) => !map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === NoColorSpace)).toBe(true);
  });

  it.each([
    ["poseur-table-black", createPoseurTableBlackProxy],
    ["poseur-table-white", createPoseurTableWhiteProxy],
  ] as const)("publishes meaningful %s selectable parts and folds three relief meshes", (
    slug,
    factory,
  ) => {
    const manifest = createGeneratedFurniturePartManifest(slug, factory());
    const directParts = manifest.parts
      .filter((part) => part.kind === "part")
      .map((part) => part.name)
      .sort();

    expect(manifest.schemaVersion).toBe("venviewer.img2threejs-parts.v1");
    expect(manifest.model).toBe(slug);
    expect(manifest.unnamedMeshes).toBe(0);
    expect(manifest.integralMeshes).toBe(3);
    expect(directParts).toEqual(["cover-assembly", ...PAD_IDS].sort());
    expect(manifest.parts.find((part) => part.name === "cloth-relief")?.members)
      .toEqual([...DETAIL_IDS].sort());
    expect(manifest.parts.find((part) => part.name === "floor-pad-system")?.members)
      .toEqual([...PAD_IDS].sort());
  });
});
