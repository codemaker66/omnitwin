import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createFurniturePresentationRuntime,
  type Img2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createGeneratedFurnitureAppearanceController } from "../generatedFurnitureAppearance.js";

function sharedMaterialFixture(): {
  readonly root: Group;
  readonly leftMesh: Mesh<BoxGeometry, MeshStandardMaterial>;
  readonly rightMesh: Mesh<BoxGeometry, MeshStandardMaterial>;
  readonly sharedMaterial: MeshStandardMaterial;
} {
  const root = new Group();
  root.name = "shared-material-fixture";
  const left = new Group();
  left.name = "left__pivot";
  const right = new Group();
  right.name = "right__pivot";
  const sharedMaterial = new MeshStandardMaterial({ color: "#6f573c" });
  const leftMesh = new Mesh(new BoxGeometry(), sharedMaterial);
  const rightMesh = new Mesh(new BoxGeometry(), sharedMaterial);
  leftMesh.name = "left-mesh";
  rightMesh.name = "right-mesh";
  left.add(leftMesh);
  right.add(rightMesh);
  root.add(left, right);
  const runtime: Img2ThreeSculptRuntime = {
    nodes: { root, left, right },
    meshes: { left: leftMesh, right: rightMesh },
    sockets: {},
    colliders: {},
    destructionGroups: {},
  };
  root.userData.sculptRuntime = runtime;
  return { root, leftMesh, rightMesh, sharedMaterial };
}

describe("generated furniture appearance", () => {
  it("highlights only the selected mesh when sibling parts share a material", () => {
    const { root, leftMesh, rightMesh, sharedMaterial } = sharedMaterialFixture();
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.2 });
    const appearance = createGeneratedFurnitureAppearanceController(root, presentation);

    appearance.apply({
      opacity: 0.5,
      colorOverride: "#123456",
      selectedPartId: "left",
    });

    expect(leftMesh.material).not.toBe(sharedMaterial);
    expect(rightMesh.material).toBe(sharedMaterial);
    expect(leftMesh.material.emissive.getHexString()).toBe("c9a84c");
    expect(rightMesh.material.emissive.getHex()).toBe(0);
    expect(leftMesh.material.opacity).toBeCloseTo(0.5);
    expect(rightMesh.material.opacity).toBeCloseTo(0.5);
    expect(leftMesh.material.color.getHexString()).toBe("123456");
    expect(rightMesh.material.color.getHexString()).toBe("123456");

    appearance.restore();
    presentation.dispose();
    expect(leftMesh.material).toBe(sharedMaterial);
    expect(rightMesh.material).toBe(sharedMaterial);
    expect(sharedMaterial.opacity).toBe(1);
    expect(sharedMaterial.color.getHexString()).toBe("6f573c");
  });

  it("restores and disposes temporary selected-material clones on selection change", () => {
    const { root, leftMesh, rightMesh } = sharedMaterialFixture();
    const presentation = createFurniturePresentationRuntime(root, { explodeDistance: 0.2 });
    const appearance = createGeneratedFurnitureAppearanceController(root, presentation);
    appearance.apply({ opacity: 1, selectedPartId: "left" });
    const leftClone = leftMesh.material;
    const disposeLeftClone = vi.spyOn(leftClone, "dispose");

    appearance.apply({ opacity: 1, selectedPartId: "right" });

    expect(disposeLeftClone).toHaveBeenCalledOnce();
    expect(leftMesh.material).not.toBe(leftClone);
    expect(rightMesh.material).not.toBe(leftMesh.material);

    const rightClone = rightMesh.material;
    const disposeRightClone = vi.spyOn(rightClone, "dispose");
    appearance.restore();
    presentation.dispose();
    expect(disposeRightClone).toHaveBeenCalledOnce();
  });
});
