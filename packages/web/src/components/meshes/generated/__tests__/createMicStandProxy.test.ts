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
import { createMicStandProxy } from "../createMicStandProxy.js";

const EXPECTED_DIMENSIONS = [0.5, 1.6, 0.5] as const;

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

function bounds(object: Object3D | undefined): Box3 {
  expect(object).toBeDefined();
  return new Box3().setFromObject(object as Object3D);
}

function expectPhysicalContact(first: Object3D | undefined, second: Object3D | undefined): void {
  const firstBounds = bounds(first).expandByScalar(0.001);
  const secondBounds = bounds(second).expandByScalar(0.001);
  expect(firstBounds.intersectsBox(secondBounds)).toBe(true);
}

describe("createMicStandProxy", () => {
  it("builds the exact catalogue envelope from a unit root at floor level", () => {
    const root = createMicStandProxy();
    const modelBounds = new Box3().setFromObject(root);
    const size = modelBounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(EXPECTED_DIMENSIONS[0], 6);
    expect(size.y).toBeCloseTo(EXPECTED_DIMENSIONS[1], 6);
    expect(size.z).toBeCloseTo(EXPECTED_DIMENSIONS[2], 6);
    expect(modelBounds.min.y).toBeCloseTo(0, 6);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.userData.canonicalDimensionsMetres).toEqual(EXPECTED_DIMENSIONS);
  });

  it("publishes honest generated provenance and passive negative semantics", () => {
    const root = createMicStandProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      passiveStandOnly: true,
      containsMicrophone: false,
      containsCable: false,
      containsPower: false,
      branded: false,
      tagged: false,
      emptyUniversalClip: true,
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#mic-stand",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/mic-stand-imagegen-v1.png",
      colliderAuthority: "metadata-only",
    });
  });

  it("exposes every visible mesh through complete unique runtime maps", () => {
    const root = createMicStandProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);
    const meshIds = Object.keys(runtime.meshes).sort();

    expect(runtime.nodes.root).toBe(root);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(meshIds.every((id) => runtime.nodes[id] !== undefined)).toBe(true);
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);

    for (const id of [
      "tripod-base-assembly",
      "tripod-hub-shell",
      "tripod-leg-system",
      "tripod-leg-rear",
      "tripod-foot-system",
      "tripod-foot-front-left",
      "upright-assembly",
      "lower-upright-pole",
      "upper-upright-pole",
      "telescoping-lock-collar",
      "boom-assembly",
      "boom-hinge-body",
      "hinge-axle-system",
      "boom-tube",
      "rear-counterweight-sleeve",
      "boom-slide-collar",
      "terminal-adapter",
      "empty-microphone-clip",
      "empty-clip-left-jaw",
      "empty-clip-right-jaw",
    ]) {
      expect(runtime.nodes[id]).toBeDefined();
      expect(runtime.colliders[id]).toBeDefined();
    }
  });

  it("preserves the tripod, telescoping, hinge, compact-boom, and empty-clip identity", () => {
    const runtime = readImg2ThreeSculptRuntime(createMicStandProxy());
    const ids = Object.keys(runtime.meshes);

    expect(ids.filter((id) => /^tripod-leg-(rear|front-left|front-right)$/.test(id)))
      .toHaveLength(3);
    expect(ids.filter((id) => /^tripod-foot-(rear|front-left|front-right)$/.test(id)))
      .toHaveLength(3);
    expect(ids.filter((id) => /^tripod-foot-.+-rib-[123]$/.test(id)))
      .toHaveLength(9);
    expect(ids.filter((id) => /^telescoping-collar-rib-[1-4]$/.test(id)))
      .toHaveLength(4);
    expect(runtime.meshes["tripod-hub-shell"]?.geometry).toBeInstanceOf(LatheGeometry);
    expect(runtime.meshes["boom-hinge-body"]?.geometry).toBeInstanceOf(ExtrudeGeometry);
    expect(runtime.meshes["upright-cable-clip"]?.geometry).toBeInstanceOf(TorusGeometry);
    expect(runtime.meshes["boom-cable-clip"]?.geometry).toBeInstanceOf(TorusGeometry);

    const leftJaw = bounds(runtime.nodes["empty-clip-left-jaw"]);
    const rightJaw = bounds(runtime.nodes["empty-clip-right-jaw"]);
    expect(leftJaw.max.x).toBeLessThan(rightJaw.min.x);
    expect(leftJaw.intersectsBox(rightJaw)).toBe(false);
    expectPhysicalContact(runtime.nodes["empty-clip-left-jaw"], runtime.nodes["empty-clip-cradle"]);
    expectPhysicalContact(runtime.nodes["empty-clip-right-jaw"], runtime.nodes["empty-clip-cradle"]);

    expect(ids.some((id) => /microphone-(head|capsule)|cable-(wire|run)|power|brand|tag/i.test(id)))
      .toBe(false);
  });

  it("keeps every support and connector physically attached within one millimetre", () => {
    const runtime = readImg2ThreeSculptRuntime(createMicStandProxy());

    for (const suffix of ["rear", "front-left", "front-right"] as const) {
      expectPhysicalContact(runtime.nodes[`tripod-leg-${suffix}`], runtime.nodes["tripod-hub-shell"]);
      expectPhysicalContact(runtime.nodes[`tripod-leg-${suffix}`], runtime.nodes[`tripod-foot-${suffix}`]);
    }
    expectPhysicalContact(runtime.nodes["tripod-hub-shell"], runtime.nodes["lower-upright-pole"]);
    expectPhysicalContact(runtime.nodes["lower-upright-pole"], runtime.nodes["telescoping-lock-collar"]);
    expectPhysicalContact(runtime.nodes["upper-upright-pole"], runtime.nodes["telescoping-lock-collar"]);
    expectPhysicalContact(runtime.nodes["upper-upright-pole"], runtime.nodes["boom-hinge-body"]);
    expectPhysicalContact(runtime.nodes["boom-hinge-body"], runtime.nodes["hinge-axle"]);
    expectPhysicalContact(runtime.nodes["boom-hinge-body"], runtime.nodes["boom-tube"]);
    expectPhysicalContact(runtime.nodes["boom-tube"], runtime.nodes["rear-counterweight-sleeve"]);
    expectPhysicalContact(runtime.nodes["boom-tube"], runtime.nodes["boom-slide-collar"]);
    expectPhysicalContact(runtime.nodes["boom-tube"], runtime.nodes["terminal-adapter"]);
    expectPhysicalContact(runtime.nodes["terminal-adapter"], runtime.nodes["empty-clip-cradle"]);
  });

  it("publishes passive planning sockets and semantic destruction groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createMicStandProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "boom-hinge",
      "boom-terminal",
      "empty-clip-centre",
      "floor-contact",
      "foot-front-left",
      "foot-front-right",
      "foot-rear",
      "hub-centre",
      "telescoping-lock",
      "upright-bottom",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "boom-assembly",
      "collar-grip-rib-system",
      "empty-clip-jaw-system",
      "empty-microphone-clip",
      "hinge-axle-system",
      "leg-root-hardware-system",
      "tripod-base-assembly",
      "tripod-foot-system",
      "tripod-hub",
      "tripod-leg-system",
      "upright-assembly",
    ]);
    expect(Object.values(runtime.destructionGroups).every((group) => group.length > 0)).toBe(true);
    expect(runtime.destructionGroups["tripod-base-assembly"]).toContain(runtime.nodes["tripod-hub"]);
    expect(runtime.destructionGroups["tripod-leg-system"]).toContain(runtime.nodes["tripod-leg-rear"]);
    expect(runtime.destructionGroups["tripod-foot-system"]).toContain(runtime.nodes["tripod-foot-rear"]);
    expect(runtime.destructionGroups["leg-root-hardware-system"])
      .toContain(runtime.nodes["tripod-leg-root-rear-cap"]);
    expect(runtime.destructionGroups["upright-assembly"]).toContain(runtime.nodes["lower-upright-pole"]);
    expect(runtime.destructionGroups["collar-grip-rib-system"])
      .toContain(runtime.nodes["telescoping-collar-rib-1"]);
    expect(runtime.destructionGroups["boom-assembly"]).toContain(runtime.nodes["boom-tube"]);
    expect(runtime.destructionGroups["hinge-axle-system"]).toContain(runtime.nodes["hinge-axle"]);
    expect(runtime.destructionGroups["empty-microphone-clip"])
      .toContain(runtime.nodes["empty-clip-jaw-system"]);
    expect(runtime.destructionGroups["empty-clip-jaw-system"])
      .toContain(runtime.nodes["empty-clip-left-jaw"]);
  });

  it("supports inspection and keeps subordinate relief with semantic parents", () => {
    const root = createMicStandProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.18,
      origin: [0, 0.8, 0],
    });
    const detailIds = Object.keys(runtime.nodes).filter(
      (id) => runtime.nodes[id]?.userData.surfaceDetail === true,
    );

    expect(detailIds.length).toBeGreaterThanOrEqual(24);
    for (const id of detailIds) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      if (runtime.meshes[id] !== undefined) {
        expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
      }
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);
    expect(presentation.resolveInspectionPart(runtime.meshes["telescoping-collar-rib-1"] as Mesh)?.id)
      .toBe("telescoping-lock-collar");
    expect(presentation.resolveInspectionPart(runtime.meshes["tripod-foot-rear-rib-1"] as Mesh)?.id)
      .toBe("tripod-foot-rear");
    expect(presentation.resolveInspectionPart(runtime.meshes["empty-clip-left-pad"] as Mesh)?.id)
      .toBe("empty-clip-left-jaw");
  });

  it("creates fresh geometry, materials, and independently named PBR maps", () => {
    const first = createMicStandProxy();
    const second = createMicStandProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);
    const firstMaps = [...textureMaps(first)];

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(firstMaps).toHaveLength(20);
    expect(firstMaps.every((map) => !secondMaps.has(map))).toBe(true);
    expect(new Set(firstMaps.map((map) => map.name)).size).toBe(firstMaps.length);
    expect(firstMaps.every((map) => map.name.startsWith("mic-stand-"))).toBe(true);
    expect(firstMaps.filter((map) => map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === SRGBColorSpace)).toBe(true);
    expect(firstMaps.filter((map) => !map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === NoColorSpace)).toBe(true);
  });
});
