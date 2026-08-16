import {
  Box3,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import { readImg2ThreeSculptRuntime } from "../../../../lib/furniture-presentation-runtime.js";
import { createPlatformProxy } from "../createPlatformProxy.js";
import { createTrestleTableProxy } from "../createTrestleTableProxy.js";

function requireStandardMaterial(mesh: Mesh): MeshStandardMaterial {
  if (Array.isArray(mesh.material) || !(mesh.material instanceof MeshStandardMaterial)) {
    throw new Error(`${mesh.name} must use one MeshStandardMaterial`);
  }
  return mesh.material;
}

describe("generated furniture visual fidelity regressions", () => {
  it("stacks the trestle veneer above the core without coplanar top faces", () => {
    const root = createTrestleTableProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const core = runtime.meshes.tabletop;
    const veneer = runtime.meshes["tabletop-surface-detail"];
    if (core === undefined || veneer === undefined) {
      throw new Error("trestle tabletop core and veneer must be registered");
    }

    root.updateMatrixWorld(true);
    const coreBounds = new Box3().setFromObject(core);
    const veneerBounds = new Box3().setFromObject(veneer);

    expect(coreBounds.max.y).toBeCloseTo(veneerBounds.min.y, 6);
    expect(veneerBounds.max.y).toBeCloseTo(0.74, 6);
    expect(coreBounds.max.y).toBeLessThan(veneerBounds.max.y);
  });

  it("keeps the platform frame visibly silver under neutral non-IBL lighting", () => {
    const root = createPlatformProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const aluminiumPartIds = [
      "front-rail",
      "rear-rail",
      "front-left-upright",
      "rear-right-upright",
      "front-left-diagonal-brace",
    ] as const;

    for (const partId of aluminiumPartIds) {
      const mesh = runtime.meshes[partId];
      if (mesh === undefined) throw new Error(`platform part ${partId} must be registered`);
      const material = requireStandardMaterial(mesh);

      expect(material.color.getHex()).toBe(0xd7dadd);
      expect(material.metalness).toBeCloseTo(0.5, 6);
      expect(material.roughness).toBeCloseTo(0.3, 6);
    }
  });
});
