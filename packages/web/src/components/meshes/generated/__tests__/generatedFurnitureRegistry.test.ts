import {
  BoxGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { readImg2ThreeSculptRuntime } from "../../../../lib/furniture-presentation-runtime.js";
import {
  createGeneratedFurnitureObject,
  disposeGeneratedFurnitureObject,
  generatedFurnitureExplodeOrigin,
  GENERATED_FURNITURE_PROXY_USER_DATA_KEY,
  GENERATED_FURNITURE_SLUGS,
  isGeneratedFurnitureSlug,
} from "../generatedFurnitureRegistry.js";

describe("generated furniture registry", () => {
  it("supports exactly the six approved catalogue slugs", () => {
    expect(GENERATED_FURNITURE_SLUGS).toEqual([
      "banquet-chair",
      "round-table-6ft",
      "trestle-6ft",
      "platform",
      "bar-counter",
      "dancefloor-panel",
    ]);
    for (const slug of GENERATED_FURNITURE_SLUGS) {
      expect(isGeneratedFurnitureSlug(slug)).toBe(true);
    }
    expect(isGeneratedFurnitureSlug("platform-narrow")).toBe(false);
    expect(isGeneratedFurnitureSlug("projector-screen")).toBe(false);
    expect(isGeneratedFurnitureSlug("")).toBe(false);
  });

  it.each(GENERATED_FURNITURE_SLUGS)(
    "constructs a fresh raw-metric %s factory root with explicit proxy provenance",
    (slug) => {
      const first = createGeneratedFurnitureObject(slug);
      const second = createGeneratedFurnitureObject(slug);
      const marker: unknown = first.userData[GENERATED_FURNITURE_PROXY_USER_DATA_KEY];

      expect(first).not.toBe(second);
      expect(first.scale.toArray()).toEqual([1, 1, 1]);
      expect(readImg2ThreeSculptRuntime(first).nodes.root).toBe(first);
      expect(marker).toEqual({
        kind: "ai-generated-furniture-proxy",
        label: "AI-generated proxy — presentation only",
        catalogueSlug: slug,
        provenance: "generated",
        authority: "presentation-only",
        measuredGeometry: false,
        requiresVisibleBadge: true,
      });

      disposeGeneratedFurnitureObject(first);
      disposeGeneratedFurnitureObject(second);
    },
  );

  it("uses each canonical envelope centre as the radial explode origin", () => {
    expect(generatedFurnitureExplodeOrigin("banquet-chair")).toEqual([0, 0.45, 0]);
    expect(generatedFurnitureExplodeOrigin("round-table-6ft")).toEqual([0, 0.38, 0]);
    expect(generatedFurnitureExplodeOrigin("trestle-6ft")).toEqual([0, 0.37, 0]);
    expect(generatedFurnitureExplodeOrigin("platform")).toEqual([0, 0.2, 0]);
    expect(generatedFurnitureExplodeOrigin("bar-counter")).toEqual([0, 0.604, 0]);
    expect(generatedFurnitureExplodeOrigin("dancefloor-panel")).toEqual([0, 0.025, 0]);
  });

  it("disposes shared geometry and material exactly once per owned root", () => {
    const root = new Group();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    disposeGeneratedFurnitureObject(root);

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it("disposes material textures owned by a generated root", () => {
    const root = new Group();
    const texture = new DataTexture();
    const material = new MeshBasicMaterial({ map: texture });
    root.add(new Mesh(new BoxGeometry(), material));
    const textureDispose = vi.spyOn(texture, "dispose");

    disposeGeneratedFurnitureObject(root);

    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
