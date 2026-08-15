import {
  BufferGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// Furniture instancing — geometry core
//
// A placed furniture item is a composite model (e.g. a banquet chair is ~13
// sub-meshes spread across ~5 materials). Drawn per-item that is ~13 draw calls
// each; a realistic 162-item layout costs ~3000 draw calls and drops the
// planner to ~15fps. The fix is to draw each *material group* of a model once
// for every item of that variant, via an InstancedMesh.
//
// This module is the pure, WebGL-free core: it takes a model's extracted
// sub-mesh parts and collapses them into one merged BufferGeometry per material
// (with each part's local transform baked in). The merged geometries become the
// per-variant InstancedMesh geometries; the per-item world transforms become
// the instance matrices.
// ---------------------------------------------------------------------------

/** A single sub-mesh harvested from a model: its geometry, a material identity, and its local transform. */
export interface ExtractedPart {
  readonly geometry: BufferGeometry;
  /** Stable signature identifying the material (so same-material parts merge). */
  readonly materialKey: string;
  /** The part's transform relative to the model origin. */
  readonly matrix: Matrix4;
}

/** One merged geometry covering every part that shares a material. */
export interface MergedMaterialGroup {
  readonly materialKey: string;
  readonly geometry: BufferGeometry;
}

function textureAppearanceSignature(slot: string, texture: Texture | null): readonly unknown[] {
  if (texture === null) return [slot, null];
  const semanticName = texture.name.trim();
  if (semanticName.length === 0) {
    throw new Error(
      `Cannot safely instance a material with an unnamed ${slot} texture; `
      + "name the texture semantically or use the per-item renderer fallback",
    );
  }

  const transform = texture.matrixAutoUpdate
    ? [
        texture.offset.x,
        texture.offset.y,
        texture.repeat.x,
        texture.repeat.y,
        texture.center.x,
        texture.center.y,
        texture.rotation,
      ]
    : texture.matrix.toArray();

  return [
    slot,
    semanticName,
    texture.mapping,
    texture.channel,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.colorSpace,
    texture.flipY,
    texture.generateMipmaps,
    texture.premultiplyAlpha,
    texture.unpackAlignment,
    texture.matrixAutoUpdate,
    transform,
  ];
}

/**
 * Stable visual signature used by the instancing harvester.
 *
 * Texture UUIDs are intentionally excluded: generated furniture creates fresh
 * resources per root, so UUIDs would split otherwise identical material
 * batches. Procedural maps instead carry stable semantic names. An unnamed map
 * throws, which makes `InstancedFurnitureLayer` use its existing per-item
 * fallback rather than merging visually different textures by accident.
 */
export function materialAppearanceSignature(material: Material): string {
  const parts: unknown[] = [
    material.type,
    material.side,
    material.transparent,
    material.opacity,
  ];
  if (material instanceof MeshStandardMaterial) {
    parts.push(
      material.color.getHexString(),
      material.emissive.getHexString(),
      material.roughness,
      material.metalness,
      material.normalScale.x,
      material.normalScale.y,
      textureAppearanceSignature("map", material.map),
      textureAppearanceSignature("normalMap", material.normalMap),
      textureAppearanceSignature("roughnessMap", material.roughnessMap),
    );
  } else if (material instanceof MeshBasicMaterial) {
    parts.push(
      material.color.getHexString(),
      textureAppearanceSignature("map", material.map),
    );
  }
  return JSON.stringify(parts);
}

/**
 * Groups parts by material signature and merges each group into a single
 * BufferGeometry, baking every part's local transform into its vertices.
 *
 * Returned groups follow first-seen material order so the caller can pair them
 * with a stable material list. Input geometries are never mutated — each is
 * cloned before its transform is baked.
 *
 * @throws if a group's geometries cannot be merged (incompatible attribute
 * sets). The caller should catch this and fall back to non-instanced rendering
 * for that variant rather than dropping the model.
 */
export function mergePartsByMaterial(parts: readonly ExtractedPart[]): MergedMaterialGroup[] {
  interface CompatibleGeometryBucket {
    readonly materialKey: string;
    readonly geometries: BufferGeometry[];
  }

  const byKey = new Map<string, CompatibleGeometryBucket>();
  const order: string[] = [];
  const untransferredGeometry = new Set<BufferGeometry>();

  for (const part of parts) {
    const baked = part.geometry.clone();
    baked.applyMatrix4(part.matrix);
    untransferredGeometry.add(baked);
    // BufferGeometryUtils cannot merge indexed and non-indexed geometry in
    // one call. Keep both under the same material identity while emitting two
    // compatible draw groups when a procedural model mixes those topologies.
    const bucketKey = `${part.materialKey}\u0000${baked.index === null ? "non-indexed" : "indexed"}`;
    let bucket = byKey.get(bucketKey);
    if (bucket === undefined) {
      bucket = { materialKey: part.materialKey, geometries: [] };
      byKey.set(bucketKey, bucket);
      order.push(bucketKey);
    }
    bucket.geometries.push(baked);
  }

  const groups: MergedMaterialGroup[] = [];
  try {
    for (const bucketKey of order) {
      const bucket = byKey.get(bucketKey);
      if (bucket === undefined) continue;
      const { geometries, materialKey } = bucket;
      let geometry: BufferGeometry | null;
      if (geometries.length === 1) {
        geometry = geometries[0] ?? null;
        if (geometry !== null) untransferredGeometry.delete(geometry);
      } else {
        try {
          geometry = mergeGeometries(geometries, false);
        } finally {
          for (const source of geometries) {
            source.dispose();
            untransferredGeometry.delete(source);
          }
        }
      }
      if (geometry === null) {
        throw new Error(`mergePartsByMaterial: could not merge geometries for material "${materialKey}"`);
      }
      groups.push({ materialKey, geometry });
    }
    return groups;
  } catch (error: unknown) {
    for (const geometry of untransferredGeometry) geometry.dispose();
    for (const group of groups) group.geometry.dispose();
    throw error;
  }
}
