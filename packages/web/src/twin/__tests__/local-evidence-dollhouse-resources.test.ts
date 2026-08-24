import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
} from "three";
import { disposeOwnedLocalDollhouseScene } from "../local-evidence-dollhouse-resources.js";

describe("local evidence dollhouse resource ownership", () => {
  it("disposes shared geometry, materials, and textures exactly once even across repeated cleanup", () => {
    const scene = new Group();
    const sharedGeometry = new BoxGeometry();
    const sharedTexture = new Texture();
    const secondaryTexture = new Texture();
    const decodedImage = { close: vi.fn() };
    sharedTexture.image = decodedImage;
    secondaryTexture.image = decodedImage;
    const sharedMaterial = new MeshStandardMaterial({ map: sharedTexture });
    sharedMaterial.normalMap = secondaryTexture;
    const secondaryMaterial = new MeshBasicMaterial({ map: sharedTexture });

    // Match a real GLTF hierarchy: geometry, materials, and textures can all
    // be referenced by more than one mesh and by multi-material meshes.
    scene.add(new Mesh(sharedGeometry, sharedMaterial));
    scene.add(new Mesh(sharedGeometry, sharedMaterial));
    scene.add(new Mesh(sharedGeometry, [sharedMaterial, secondaryMaterial]));

    const geometryDispose = vi.spyOn(sharedGeometry, "dispose");
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, "dispose");
    const secondaryMaterialDispose = vi.spyOn(secondaryMaterial, "dispose");
    const sharedTextureDispose = vi.spyOn(sharedTexture, "dispose");
    const secondaryTextureDispose = vi.spyOn(secondaryTexture, "dispose");

    disposeOwnedLocalDollhouseScene(scene);
    disposeOwnedLocalDollhouseScene(scene);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(sharedMaterialDispose).toHaveBeenCalledTimes(1);
    expect(secondaryMaterialDispose).toHaveBeenCalledTimes(1);
    expect(sharedTextureDispose).toHaveBeenCalledTimes(1);
    expect(secondaryTextureDispose).toHaveBeenCalledTimes(1);
    expect(decodedImage.close).toHaveBeenCalledTimes(1);
  });
});
