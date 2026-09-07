import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { createGltfFurnitureInstance } from "../gltf-furniture-instance.js";

const dimensions = { width: 0.42, height: 0.88, depth: 0.58 };

describe("imported furniture instances", () => {
  it.each(["burgess-turini-18-3", "checked-banquet-chair"])("aligns supplied +Z %s to planner -Z without moving its footprint or changing the cache", (slug) => {
    const source = new Group();
    source.position.set(10, -4, 7);
    const material = new MeshStandardMaterial();
    const geometry = new BoxGeometry(0.42, 0.88, 0.58);
    source.add(new Mesh(geometry, material));
    const back = new Group();
    back.name = "backrest-marker";
    back.position.set(0, 0.3, -0.25);
    source.add(back);
    const instance = createGltfFurnitureInstance(source, { ...dimensions, slug });
    const bounds = new Box3().setFromObject(instance.object);
    expect(bounds.getCenter(new Vector3()).toArray()).toEqual([
      expect.closeTo(0, 6), expect.closeTo(0.44, 6), expect.closeTo(0, 6),
    ]);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    const renderedBack = instance.object.getObjectByName("backrest-marker");
    expect(renderedBack?.getWorldPosition(new Vector3()).z).toBeGreaterThan(0);
    expect(source.rotation.y).toBe(0);
    expect(source.position.toArray()).toEqual([10, -4, 7]);
    expect(back.position.z).toBe(-0.25);
    instance.dispose(); geometry.dispose(); material.dispose();
  });

  it("fits the full hierarchy uniformly and centres the XZ footprint with its base on the floor", () => {
    const source = new Group();
    source.position.set(10, -4, 7);
    const sourceMaterial = new MeshStandardMaterial();
    const sourceGeometry = new BoxGeometry(42, 88, 58);
    const mesh = new Mesh(sourceGeometry, sourceMaterial);
    mesh.position.set(23, 37, -11);
    source.add(mesh);
    const instance = createGltfFurnitureInstance(source, dimensions);
    const bounds = new Box3().setFromObject(instance.object);
    expect(bounds.getSize(new Vector3()).toArray()).toEqual([
      expect.closeTo(0.42, 6), expect.closeTo(0.88, 6), expect.closeTo(0.58, 6),
    ]);
    expect(bounds.min.toArray()).toEqual([
      expect.closeTo(-0.21, 6), expect.closeTo(0, 6), expect.closeTo(-0.29, 6),
    ]);
    expect(source.position.toArray()).toEqual([10, -4, 7]);
    instance.dispose(); sourceGeometry.dispose(); sourceMaterial.dispose();
  });

  it("preserves PBR maps and material arrays, isolates ghost overrides, and releases only owned materials", () => {
    const map = new Texture();
    const normalMap = new Texture();
    const metalnessMap = new Texture();
    const sourceMaterial = new MeshStandardMaterial({
      color: "#882233", map, normalMap, metalnessMap, opacity: 0.8, transparent: true,
    });
    const frameMaterial = new MeshStandardMaterial({ color: "#bb8844", metalness: 0.8 });
    const geometry = new BoxGeometry(42, 88, 58);
    const source = new Group();
    source.add(new Mesh(geometry, [sourceMaterial, frameMaterial]));
    source.add(new Mesh(geometry, sourceMaterial));
    const sourceDispose = vi.spyOn(sourceMaterial, "dispose");
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const textureDispose = vi.spyOn(map, "dispose");
    const instance = createGltfFurnitureInstance(source, dimensions);
    const meshes: Mesh[] = [];
    instance.object.traverse((object) => { if (object instanceof Mesh) meshes.push(object); });
    const materials = meshes[0]?.material;
    if (!Array.isArray(materials) || !(materials[0] instanceof MeshStandardMaterial)) {
      throw new Error("Expected independent material array");
    }
    const upholstery = materials[0];
    const materialDispose = vi.spyOn(upholstery, "dispose");
    expect(upholstery).not.toBe(sourceMaterial);
    expect(meshes[1]?.material).toBe(upholstery);
    expect(upholstery.map).toBe(map);
    expect(upholstery.normalMap).toBe(normalMap);
    expect(upholstery.metalnessMap).toBe(metalnessMap);
    expect(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
    instance.setAppearance(0.5, "#00ff00");
    expect(upholstery.opacity).toBe(0.4);
    expect(upholstery.depthWrite).toBe(false);
    expect(upholstery.color.getHexString()).toBe("00ff00");
    expect(sourceMaterial.color.getHexString()).toBe("882233");
    expect(sourceMaterial.opacity).toBe(0.8);
    instance.setAppearance(1);
    expect(upholstery.color.getHexString()).toBe("882233");
    expect(upholstery.opacity).toBe(0.8);
    expect(upholstery.transparent).toBe(true);
    expect(upholstery.depthWrite).toBe(sourceMaterial.depthWrite);
    instance.dispose();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    sourceMaterial.dispose(); frameMaterial.dispose(); geometry.dispose();
    map.dispose(); normalMap.dispose(); metalnessMap.dispose();
  });

  it("rejects an empty asset so the furniture error boundary can keep its fallback visible", () => {
    expect(() => createGltfFurnitureInstance(new Group(), dimensions)).toThrow(/bounds/i);
  });
});
