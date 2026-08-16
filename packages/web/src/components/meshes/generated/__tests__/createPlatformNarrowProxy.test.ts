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
import { createPlatformNarrowProxy } from "../createPlatformNarrowProxy.js";

const EXPECTED_DIMENSIONS = [2.44, 0.4, 1.02] as const;
const EXPECTED_MESH_COUNT = 67;
const EXPECTED_LEG_IDS = [
  "front-left-upright",
  "front-centre-upright",
  "front-right-upright",
  "rear-left-upright",
  "rear-centre-upright",
  "rear-right-upright",
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
      material.bumpMap,
      material.normalMap,
      material.roughnessMap,
    ]) {
      if (map !== null) result.add(map);
    }
  }
  return result;
}

describe("createPlatformNarrowProxy", () => {
  it("builds the exact narrow catalogue envelope from a unit root at floor level", () => {
    const root = createPlatformNarrowProxy();
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
    expect(root.userData.operationalSupportPlaneY).toBe(EXPECTED_DIMENSIONS[1]);
  });

  it("authors the narrow deck, frame, leg, and brace spacing directly", () => {
    const root = createPlatformNarrowProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const deckSize = new Box3()
      .setFromObject(runtime.nodes["deck-panel"] ?? root)
      .getSize(new Vector3());
    const leftRailSize = new Box3()
      .setFromObject(runtime.nodes["left-rail"] ?? root)
      .getSize(new Vector3());

    expect(deckSize.z).toBeCloseTo(1.02, 6);
    expect(leftRailSize.z).toBeCloseTo(0.95, 6);
    expect(runtime.nodes["front-rail"]?.position.z).toBeCloseTo(0.475, 6);
    expect(runtime.nodes["rear-rail"]?.position.z).toBeCloseTo(-0.475, 6);

    const xStations = EXPECTED_LEG_IDS
      .map((id) => runtime.nodes[id]?.position.x)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    expect(xStations).toEqual([-1.075, -1.075, 0, 0, 1.075, 1.075]);
    expect(EXPECTED_LEG_IDS.map((id) => runtime.nodes[id]?.position.z)).toEqual([
      0.43,
      0.43,
      0.43,
      -0.43,
      -0.43,
      -0.43,
    ]);
    expect(Object.keys(runtime.nodes).filter((id) => id.endsWith("-diagonal-brace")))
      .toHaveLength(12);
  });

  it("keeps every named part inside the exact canonical envelope", () => {
    const root = createPlatformNarrowProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const halfWidth = EXPECTED_DIMENSIONS[0] / 2;
    const halfDepth = EXPECTED_DIMENSIONS[2] / 2;

    for (const [id, node] of Object.entries(runtime.nodes)) {
      if (id === "root") continue;
      const bounds = new Box3().setFromObject(node);
      expect(bounds.min.x, `${id} crosses -X`).toBeGreaterThanOrEqual(-halfWidth - 1e-6);
      expect(bounds.max.x, `${id} crosses +X`).toBeLessThanOrEqual(halfWidth + 1e-6);
      expect(bounds.min.y, `${id} sinks below floor`).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.max.y, `${id} exceeds support plane`)
        .toBeLessThanOrEqual(EXPECTED_DIMENSIONS[1] + 1e-6);
      expect(bounds.min.z, `${id} crosses -Z`).toBeGreaterThanOrEqual(-halfDepth - 1e-6);
      expect(bounds.max.z, `${id} crosses +Z`).toBeLessThanOrEqual(halfDepth + 1e-6);
    }
  });

  it("seats every lock bolt into its lock plate", () => {
    const root = createPlatformNarrowProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    root.updateMatrixWorld(true);

    for (const legId of EXPECTED_LEG_IDS) {
      const plate = runtime.meshes[`${legId}-corner-lock-detail`];
      expect(plate, `${legId} lock plate exists`).toBeDefined();
      if (plate === undefined) continue;
      const plateBounds = new Box3().setFromObject(plate);

      for (const side of ["left", "right"] as const) {
        const boltId = `${legId}-${side}-lock-bolt-detail`;
        const bolt = runtime.meshes[boltId];
        expect(bolt, `${boltId} exists`).toBeDefined();
        if (bolt === undefined) continue;
        expect(
          new Box3().setFromObject(bolt).intersectsBox(plateBounds),
          `${boltId} must physically overlap its lock plate`,
        ).toBe(true);
      }
    }
  });

  it("publishes honest dedicated-reference provenance and no measured or physics authority", () => {
    const root = createPlatformNarrowProxy();

    expect(root.name).toBe("platform-narrow-proxy");
    expect(root.userData).toMatchObject({
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      operational: false,
      colliderAuthority: "metadata-only",
      rootScalePolicy: "unit-root",
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#platform-narrow",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/platform-narrow-imagegen-v1.png",
      referenceImageSha256:
        "04f338fabf9fa8b089001440851a3e7bdd6b0367206655caa451bdd997363b86",
    });
    expect(String(root.userData.approximationNotes)).toContain("not measured");
  });

  it("exposes every visible mesh through complete unique runtime maps", () => {
    const root = createPlatformNarrowProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const visibleMeshes = meshes(root);
    const nodeIds = Object.keys(runtime.nodes).filter((id) => id !== "root").sort();
    const meshIds = Object.keys(runtime.meshes).sort();

    expect(visibleMeshes).toHaveLength(EXPECTED_MESH_COUNT);
    expect(runtime.nodes.root).toBe(root);
    expect(nodeIds).toEqual(meshIds);
    expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
    expect(new Set(Object.values(runtime.meshes))).toEqual(new Set(visibleMeshes));
    expect(new Set(visibleMeshes.map((mesh) => mesh.name)).size).toBe(visibleMeshes.length);
    expect(visibleMeshes.every((mesh) => mesh.name.endsWith("__mesh"))).toBe(true);
    expect(nodeIds.every((id) => runtime.colliders[id] !== undefined)).toBe(true);
  });

  it("publishes planning sockets and complete semantic destruction groups", () => {
    const runtime = readImg2ThreeSculptRuntime(createPlatformNarrowProxy());

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "centre-underframe",
      "deck-support-plane",
      "floor-contact",
      "left-frame-coupling",
      "right-frame-coupling",
      "stack-centre",
    ]);
    expect(runtime.sockets["floor-contact"]?.position.toArray()).toEqual([0, 0, 0]);
    expect(runtime.sockets["deck-support-plane"]?.position.y).toBe(0.4);
    expect(runtime.sockets["left-frame-coupling"]?.position.x).toBe(-1.22);
    expect(runtime.sockets["right-frame-coupling"]?.position.x).toBe(1.22);

    expect(Object.keys(runtime.destructionGroups).sort()).toEqual([
      "brace-system",
      "corner-lock-system",
      "deck-assembly",
      "foot-system",
      "leg-system",
      "perimeter-frame",
    ]);
    expect(runtime.destructionGroups["deck-assembly"]).toHaveLength(6);
    expect(runtime.destructionGroups["perimeter-frame"]).toHaveLength(7);
    expect(runtime.destructionGroups["leg-system"]).toHaveLength(6);
    expect(runtime.destructionGroups["brace-system"]).toHaveLength(12);
    expect(runtime.destructionGroups["corner-lock-system"]).toHaveLength(18);
    expect(runtime.destructionGroups["foot-system"]).toHaveLength(6);
  });

  it("keeps surface details with semantic parents and restores explode exactly", () => {
    const root = createPlatformNarrowProxy({ castShadow: false, receiveShadow: true });
    const runtime = readImg2ThreeSculptRuntime(root);
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.24 });
    const detailIds = Object.keys(runtime.nodes).filter(
      (id) => id !== "root" && runtime.nodes[id]?.userData.surfaceDetail === true,
    );
    const restingBounds = new Box3().setFromObject(root);

    expect(detailIds).toHaveLength(41);
    for (const id of detailIds) {
      expect(runtime.nodes[id]?.userData.explodeWithParent).toBe(true);
      expect(runtime.meshes[id]?.userData.explodeWithParent).toBe(true);
    }
    expect(meshes(root).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(meshes(root).every((mesh) => mesh.receiveShadow)).toBe(true);

    const carpet = runtime.meshes["deck-carpet-detail"];
    const hinge = runtime.meshes["front-centre-left-diagonal-brace-upper-hinge-detail"];
    expect(carpet === undefined ? null : presentation.resolveInspectionPart(carpet)?.id)
      .toBe("deck-panel");
    expect(hinge === undefined ? null : presentation.resolveInspectionPart(hinge)?.id)
      .toBe("front-centre-left-diagonal-brace");

    presentation.setExplodeProgress(1);
    presentation.setExplodeProgress(0);
    root.updateMatrixWorld(true);
    const restoredBounds = new Box3().setFromObject(root);
    expect(restoredBounds.min.toArray()).toEqual(restingBounds.min.toArray());
    expect(restoredBounds.max.toArray()).toEqual(restingBounds.max.toArray());
  });

  it("creates fresh named geometry, materials, and procedural maps for every root", () => {
    const first = createPlatformNarrowProxy();
    const second = createPlatformNarrowProxy();
    const secondGeometries = new Set(meshes(second).map((mesh) => mesh.geometry));
    const secondMaterials = materials(second);
    const secondMaps = textureMaps(second);

    expect(meshes(first).every((mesh) => !secondGeometries.has(mesh.geometry))).toBe(true);
    expect([...materials(first)].every((material) => !secondMaterials.has(material))).toBe(true);
    expect([...materials(first)].every((material) => material.name.startsWith("platform-narrow-")))
      .toBe(true);
    expect(textureMaps(first).size).toBe(1);
    expect([...textureMaps(first)].every((map) => !secondMaps.has(map))).toBe(true);
    expect([...textureMaps(first)].every((map) => map.name.startsWith("platform-narrow-")))
      .toBe(true);
  });
});
