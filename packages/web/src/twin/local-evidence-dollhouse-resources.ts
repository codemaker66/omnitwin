import {
  BufferGeometry,
  Material,
  Texture,
  type Object3D,
} from "three";

interface ObjectWithGeometry extends Object3D {
  readonly geometry: BufferGeometry;
}

interface ObjectWithMaterial extends Object3D {
  readonly material: Material | readonly Material[];
}

const disposedGeometries = new WeakSet<BufferGeometry>();
const disposedMaterials = new WeakSet<Material>();
const disposedTextures = new WeakSet<Texture>();
const closedTextureData = new WeakSet();

const MATERIAL_TEXTURE_SLOTS = [
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "gradientMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "lightMap",
  "map",
  "matcap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "specularMap",
  "thicknessMap",
  "transmissionMap",
] as const;

function geometryOf(object: Object3D): BufferGeometry | null {
  if (!("geometry" in object)) {
    return null;
  }
  const geometry = (object as ObjectWithGeometry).geometry;
  return geometry instanceof BufferGeometry ? geometry : null;
}

function materialsOf(object: Object3D): readonly Material[] {
  if (!("material" in object)) {
    return [];
  }
  const material = (object as ObjectWithMaterial).material;
  if (material instanceof Material) {
    return [material];
  }
  return Array.isArray(material)
    ? material.filter((entry): entry is Material => entry instanceof Material)
    : [];
}

function texturesOf(material: Material): readonly Texture[] {
  const textures: Texture[] = [];
  // GLTFLoader's standard/physical materials retain decoded images in these
  // direct texture slots. Read descriptors rather than invoking accessors.
  for (const key of MATERIAL_TEXTURE_SLOTS) {
    const descriptor = Object.getOwnPropertyDescriptor(material, key);
    const value: unknown = descriptor?.value;
    if (value instanceof Texture) {
      textures.push(value);
    }
  }
  return textures;
}

function isClosable(value: object): value is object & { close: () => void } {
  return "close" in value && typeof value.close === "function";
}

function closeOwnedTextureData(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      closeOwnedTextureData(entry);
    }
    return;
  }
  if (typeof value !== "object" || value === null || closedTextureData.has(value)) {
    return;
  }
  if (!isClosable(value)) {
    return;
  }
  closedTextureData.add(value);
  value.close();
}

/**
 * Releases resources decoded from a unique local `blob:` GLB. Weak guards make
 * the operation idempotent and shared references inside the scene dispose only
 * once. This must never be used for public URL-backed GLTF cache entries.
 */
export function disposeOwnedLocalDollhouseScene(scene: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  scene.traverse((object) => {
    const geometry = geometryOf(object);
    if (geometry !== null) {
      geometries.add(geometry);
    }
    for (const material of materialsOf(object)) {
      materials.add(material);
      for (const texture of texturesOf(material)) {
        textures.add(texture);
      }
    }
  });

  for (const texture of textures) {
    if (!disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      // GLTFLoader may decode embedded WebP images to ImageBitmap. Three's
      // Texture.dispose() releases GPU state but does not close that browser-
      // owned CPU bitmap, so release both aliases (deduplicated) explicitly.
      closeOwnedTextureData(texture.source.data);
      closeOwnedTextureData(texture.image);
      closeOwnedTextureData(texture.mipmaps);
      texture.dispose();
    }
  }
  for (const material of materials) {
    if (!disposedMaterials.has(material)) {
      disposedMaterials.add(material);
      material.dispose();
    }
  }
  for (const geometry of geometries) {
    if (!disposedGeometries.has(geometry)) {
      disposedGeometries.add(geometry);
      geometry.dispose();
    }
  }
}
