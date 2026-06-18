import { BufferGeometry, Matrix4 } from "three";
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
  const byKey = new Map<string, BufferGeometry[]>();
  const order: string[] = [];

  for (const part of parts) {
    const baked = part.geometry.clone();
    baked.applyMatrix4(part.matrix);
    let list = byKey.get(part.materialKey);
    if (list === undefined) {
      list = [];
      byKey.set(part.materialKey, list);
      order.push(part.materialKey);
    }
    list.push(baked);
  }

  const groups: MergedMaterialGroup[] = [];
  for (const materialKey of order) {
    const geometries = byKey.get(materialKey) ?? [];
    let geometry: BufferGeometry | null;
    if (geometries.length === 1) {
      geometry = geometries[0] ?? null;
    } else {
      geometry = mergeGeometries(geometries, false);
    }
    if (geometry === null) {
      throw new Error(`mergePartsByMaterial: could not merge geometries for material "${materialKey}"`);
    }
    groups.push({ materialKey, geometry });
  }

  return groups;
}
