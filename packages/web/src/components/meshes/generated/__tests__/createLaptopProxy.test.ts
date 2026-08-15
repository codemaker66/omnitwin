import {
  Box3,
  CylinderGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
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
import { createLaptopProxy } from "../createLaptopProxy.js";

const EXPECTED_DIMENSIONS = [0.36, 0.25, 0.25] as const;

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

describe("createLaptopProxy", () => {
  it("builds the exact catalogue envelope from a unit root at floor level", () => {
    const root = createLaptopProxy();
    const bounds = new Box3().setFromObject(root);
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
    expect(root.userData.fixedHingeAngleRadians).toBeCloseTo(0.135, 9);
  });

  it("publishes honest generated provenance without measured, operational, or physics authority", () => {
    const root = createLaptopProxy();

    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#laptop",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/laptop-imagegen-v1.png",
      colliderAuthority: "metadata-only",
    });
  });

  it("exposes every visible mesh through named runtime nodes and complete collider metadata", () => {
    const root = createLaptopProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);

    expect(runtime.nodes.root).toBe(root);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);

    for (const id of [
      "base-assembly",
      "base-shell",
      "upper-deck",
      "trackpad",
      "keyboard-bed",
      "keyboard-key-system",
      "spacebar-key",
      "foot-system",
      "left-port-system",
      "hinge-system",
      "hinge-left",
      "hinge-right",
      "display-assembly",
      "display-shell",
      "bezel",
      "screen-surface",
      "camera-aperture",
    ]) {
      expect(runtime.nodes[id]).toBeDefined();
      expect(runtime.colliders[id]).toBeDefined();
    }
  });

  it("builds a real open clamshell, dense key field, twin hinges, ports, and feet", () => {
    const runtime = readImg2ThreeSculptRuntime(createLaptopProxy());
    const ids = Object.keys(runtime.meshes);
    const keyIds = ids.filter((id) => /^key-r\d-c\d+$/.test(id) || id === "spacebar-key");

    expect(keyIds).toHaveLength(73);
    expect(ids.filter((id) => id.startsWith("hinge-")).sort()).toEqual([
      "hinge-left",
      "hinge-right",
    ]);
    expect(ids.filter((id) => id.startsWith("port-recess-"))).toHaveLength(3);
    expect(ids.filter((id) => id.startsWith("foot-"))).toHaveLength(4);
    expect(runtime.meshes["base-shell"]?.geometry).toBeInstanceOf(RoundedBoxGeometry);
    expect(runtime.meshes["display-shell"]?.geometry).toBeInstanceOf(RoundedBoxGeometry);
    expect(runtime.meshes["hinge-left"]?.geometry).toBeInstanceOf(CylinderGeometry);
    expect(runtime.meshes["camera-aperture"]?.geometry).toBeInstanceOf(CylinderGeometry);
    expect(runtime.nodes["display-assembly"]?.rotation.x).toBeCloseTo(0.135, 9);
    expect(ids.some((id) => id.includes("logo") || id.includes("legend"))).toBe(false);
  });

  it("publishes planning sockets and semantic destruction groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createLaptopProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "display-hinge-axis",
      "floor-contact",
      "keyboard-centre",
      "screen-centre",
      "trackpad-centre",
    ]);
    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "base-shell",
      "display",
      "hinges",
      "input-deck",
    ]);
    expect(runtime.destructionGroups.display).toContain(runtime.nodes["screen-surface"]);
    expect(runtime.destructionGroups.hinges).toContain(runtime.nodes["hinge-system"]);
    expect(runtime.destructionGroups["input-deck"]).toContain(runtime.nodes["keyboard-key-system"]);
  });

  it("keeps repeated and surface details with meaningful selectable parent assemblies", () => {
    const root = createLaptopProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.08,
      origin: [0, 0.1, 0],
    });

    expect(runtime.nodes["key-r0-c0"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["port-recess-rear"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["foot-front-left"]?.userData.explodeWithParent).toBe(true);
    expect(runtime.nodes["camera-aperture"]?.userData.explodeWithParent).toBe(true);
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);
    expect(presentation.resolveInspectionPart(runtime.meshes["key-r0-c0"] as Mesh)?.id)
      .toBe("keyboard-key-system");
    expect(presentation.resolveInspectionPart(runtime.meshes["port-recess-rear"] as Mesh)?.id)
      .toBe("left-port-system");
    expect(presentation.resolveInspectionPart(runtime.meshes["hinge-left"] as Mesh)?.id)
      .toBe("hinge-system");
    expect(presentation.resolveInspectionPart(runtime.meshes["screen-surface"] as Mesh)?.id)
      .toBe("screen-surface");
  });

  it("creates fresh geometry, materials, and independently named PBR maps", () => {
    const first = createLaptopProxy();
    const second = createLaptopProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);
    const firstMaps = [...textureMaps(first)];

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect(firstMaps).toHaveLength(25);
    expect(firstMaps.every((map) => !secondMaps.has(map))).toBe(true);
    expect(new Set(firstMaps.map((map) => map.name)).size).toBe(firstMaps.length);
    expect(firstMaps.every((map) => map.name.startsWith("laptop-"))).toBe(true);
    expect(firstMaps.filter((map) => map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === SRGBColorSpace)).toBe(true);
    expect(firstMaps.filter((map) => !map.name.endsWith("-albedo"))
      .every((map) => map.colorSpace === NoColorSpace)).toBe(true);
  });
});
