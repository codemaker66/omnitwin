import {
  Box3,
  ExtrudeGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Shape,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createBanquetChairProxy } from "../createBanquetChairProxy.js";

const EXPECTED_PART_IDS = [
  "seat-pad",
  "backrest-pad",
  "back-frame-loop",
  "front-left-leg",
  "front-right-leg",
  "rear-left-leg",
  "rear-right-leg",
  "underseat-front-rail",
  "underseat-rear-rail",
  "underseat-left-rail",
  "underseat-right-rail",
  "left-lateral-brace",
  "right-lateral-brace",
  "front-left-foot-cap",
  "front-right-foot-cap",
  "rear-left-foot-cap",
  "rear-right-foot-cap",
] as const;

function worldPosition(object: Mesh | undefined): Vector3 {
  if (object === undefined) throw new Error("expected a mapped chair mesh");
  return object.getWorldPosition(new Vector3());
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`expected ${label}`);
  return value;
}

function extrudedShapes(geometry: ExtrudeGeometry): readonly Shape[] {
  return Array.isArray(geometry.parameters.shapes)
    ? geometry.parameters.shapes
    : [geometry.parameters.shapes];
}

describe("createBanquetChairProxy", () => {
  it("builds the canonical metre-scale chair envelope", () => {
    const chair = createBanquetChairProxy();
    chair.updateWorldMatrix(true, true);
    const size = new Box3().setFromObject(chair).getSize(new Vector3());

    expect(size.x).toBeCloseTo(0.45, 3);
    expect(size.y).toBeCloseTo(0.9, 3);
    expect(size.z).toBeCloseTo(0.45, 3);
    expect(new Box3().setFromObject(chair).min.y).toBeCloseTo(0, 3);
  });

  it("keeps every structural item separate, named, and semantically mapped", () => {
    const chair = createBanquetChairProxy();
    const runtime = readImg2ThreeSculptRuntime(chair);
    const traversedMeshes: Mesh[] = [];
    chair.traverse((object) => {
      if (object instanceof Mesh) traversedMeshes.push(object);
    });

    for (const id of EXPECTED_PART_IDS) {
      expect(runtime.nodes[id]?.name).toBe(`${id}__pivot`);
      expect(runtime.meshes[id]?.name).toBe(`${id}__mesh`);
      expect(runtime.meshes[id]?.parent).toBe(runtime.nodes[id]);
    }
    expect(new Set(EXPECTED_PART_IDS.map((id) => runtime.meshes[id])).size).toBe(
      EXPECTED_PART_IDS.length,
    );
    expect(traversedMeshes.every((mesh) => mesh.name.trim().length > 0)).toBe(true);
    expect(new Set(traversedMeshes.map((mesh) => mesh.name)).size).toBe(traversedMeshes.length);
  });

  it("uses low-poly chamfered upholstery and an open extruded brass back loop", () => {
    const runtime = readImg2ThreeSculptRuntime(createBanquetChairProxy());
    const seat = requireValue(runtime.meshes["seat-pad"], "seat mesh");
    const backrest = requireValue(runtime.meshes["backrest-pad"], "backrest mesh");
    const loop = requireValue(runtime.meshes["back-frame-loop"], "back frame mesh");

    expect(seat.geometry).toBeInstanceOf(RoundedBoxGeometry);
    expect(backrest.geometry).toBeInstanceOf(RoundedBoxGeometry);
    expect(loop.geometry).toBeInstanceOf(ExtrudeGeometry);
    if (!(loop.geometry instanceof ExtrudeGeometry)) {
      throw new Error("expected the back loop to use extruded open-profile geometry");
    }
    expect(extrudedShapes(loop.geometry).every((shape) => shape.holes.length === 1)).toBe(true);
    expect(loop.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect((loop.material as MeshPhysicalMaterial).metalness).toBeGreaterThan(0.8);
    expect(seat.geometry.getAttribute("position").count).toBeLessThan(500);
    expect(backrest.geometry.getAttribute("position").count).toBeLessThan(500);
  });

  it("publishes complete runtime maps and semantic destruction assemblies", () => {
    const chair = createBanquetChairProxy();
    const runtime = readImg2ThreeSculptRuntime(chair);

    expect(runtime.nodes.root).toBe(chair);
    expect(Object.keys(runtime.meshes).sort()).toEqual(
      Object.keys(runtime.nodes).filter((id) => id !== "root").sort(),
    );
    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "back-loop-contact",
      "backrest-mount",
      "brace-contact",
      "floor-contact",
      "front-leg-contact",
      "rear-leg-contact",
      "seat-contact",
    ]);
    expect(runtime.sockets["seat-contact"]?.position.toArray()).toEqual([0, 0.445, 0]);
    expect(runtime.sockets["back-loop-contact"]?.position.toArray()).toEqual([
      0,
      0.48,
      -0.19,
    ]);
    expect(runtime.sockets["front-leg-contact"]?.position.toArray()).toEqual([
      0,
      0.43,
      0.17,
    ]);
    expect(runtime.sockets["rear-leg-contact"]?.position.toArray()).toEqual([
      0,
      0.43,
      -0.17,
    ]);
    expect(runtime.sockets["brace-contact"]?.position.toArray()).toEqual([0, 0.24, 0]);
    expect(runtime.sockets["backrest-mount"]?.parent).toBe(runtime.nodes["back-frame-loop"]);
    chair.updateWorldMatrix(true, true);
    const backrestMountWorld = runtime.sockets["backrest-mount"]
      ?.getWorldPosition(new Vector3());
    expect(backrestMountWorld?.x).toBeCloseTo(0, 9);
    expect(backrestMountWorld?.y).toBeCloseTo(0.735, 9);
    expect(backrestMountWorld?.z).toBeCloseTo(-0.172, 9);
    expect(runtime.destructionGroups["brass-frame"]).toHaveLength(11);
    expect(runtime.destructionGroups["underseat-frame"]).toHaveLength(6);
    expect(runtime.destructionGroups["front-leg-pair"]).toHaveLength(2);
    expect(runtime.destructionGroups["rear-leg-pair"]).toHaveLength(2);
    expect(runtime.destructionGroups["lateral-brace-pair"]).toHaveLength(2);
    expect(runtime.destructionGroups["foot-cap-system"]).toHaveLength(4);
    expect(runtime.destructionGroups["seat-assembly"]?.[0]).toBe(runtime.nodes["seat-pad"]);
    expect(runtime.destructionGroups["backrest-assembly"]?.[0]).toBe(
      runtime.nodes["backrest-pad"],
    );
    for (const id of EXPECTED_PART_IDS) expect(runtime.colliders[id]).toBeDefined();
  });

  it("keeps surface details attached and resolves their clicks to the parent cushion", () => {
    const chair = createBanquetChairProxy();
    const runtime = readImg2ThreeSculptRuntime(chair);
    const seat = requireValue(runtime.nodes["seat-pad"], "seat node");
    const seatDetail = requireValue(runtime.nodes["seat-panel-detail"], "seat detail node");
    const detailMesh = requireValue(runtime.meshes["seat-panel-detail"], "seat detail mesh");
    const controller = createFurniturePresentationRuntime(chair, {
      explodeDistance: 0.3,
    });
    chair.updateWorldMatrix(true, true);
    const initialSeatWorld = seat.getWorldPosition(new Vector3());
    const initialDetailWorld = worldPosition(detailMesh);

    expect(controller.resolveInspectionPart(detailMesh)?.id).toBe("seat-pad");
    expect(seatDetail.userData.surfaceDetail).toBe(true);
    expect(detailMesh.userData.surfaceDetail).toBe(true);
    expect(seatDetail.userData.explodeWithParent).toBe(true);
    expect(detailMesh.userData.explodeWithParent).toBe(true);
    controller.setExplodeProgress(1);
    chair.updateWorldMatrix(true, true);

    const seatDelta = seat.getWorldPosition(new Vector3()).sub(initialSeatWorld);
    const detailDelta = worldPosition(detailMesh).sub(initialDetailWorld);
    expect(detailDelta.distanceTo(seatDelta)).toBeLessThan(1e-9);
    expect(seatDelta.length()).toBeCloseTo(0.3);
  });

  it("honours explicit shadow options without changing the model contract", () => {
    const chair = createBanquetChairProxy({
      castShadow: false,
      receiveShadow: false,
    });
    const runtime = readImg2ThreeSculptRuntime(chair);

    expect(Object.values(runtime.meshes).every((mesh) => !mesh.castShadow)).toBe(true);
    expect(Object.values(runtime.meshes).every((mesh) => !mesh.receiveShadow)).toBe(true);
  });

  it("publishes the restored generated-reference provenance without measured authority", () => {
    const chair = createBanquetChairProxy();

    expect(chair.userData).toMatchObject({
      canonicalDimensionsMetres: [0.45, 0.9, 0.45],
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#banquet-chair",
      evidenceImage:
        "packages/web/src/assets/generated-furniture/banquet-chair-imagegen-v1.png",
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
    });
  });
});
