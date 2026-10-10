import { type BufferGeometry, Color, Group, type Material, Mesh } from "three";
import { craftedMaterial, type CraftedMaterialId } from "./crafted-materials.js";
import { mergeParts } from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Crafted furniture models
//
// A factory returns parts (geometry + palette material). This module merges
// the parts that share a material into one mesh, so a chair is two or three
// meshes, and the instancing layer draws every chair of a type in two or
// three calls. The instance owns its geometries and materials; the shared
// maps belong to crafted-textures.ts.
// ---------------------------------------------------------------------------

export interface CraftedPart {
  readonly material: CraftedMaterialId;
  readonly geometry: BufferGeometry;
}

export interface CraftedFurnitureInstance {
  readonly object: Group;
  /** Fades or tints the model (placement ghost); `undefined` restores its own colours. */
  readonly setAppearance: (opacity: number, colorOverride?: string) => void;
  readonly dispose: () => void;
}

interface OwnedMaterial {
  readonly material: Material;
  readonly baseColour: Color | null;
  readonly baseOpacity: number;
  readonly baseTransparent: boolean;
  readonly baseDepthWrite: boolean;
}

function colourOf(material: Material): Color | null {
  return "color" in material && material.color instanceof Color ? material.color : null;
}

/** Builds one owned model from a factory's parts. */
export function buildCraftedModel(name: string, parts: readonly CraftedPart[]): CraftedFurnitureInstance {
  const byMaterial = new Map<CraftedMaterialId, BufferGeometry[]>();
  for (const part of parts) {
    const list = byMaterial.get(part.material) ?? [];
    list.push(part.geometry);
    byMaterial.set(part.material, list);
  }
  const object = new Group();
  object.name = name;
  const owned: OwnedMaterial[] = [];
  const geometries: BufferGeometry[] = [];
  for (const [id, list] of byMaterial) {
    const geometry = mergeParts(list);
    geometry.computeBoundingSphere();
    geometries.push(geometry);
    const material = craftedMaterial(id);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${name}:${id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);
    const colour = colourOf(material);
    owned.push({
      material,
      baseColour: colour === null ? null : colour.clone(),
      baseOpacity: material.opacity,
      baseTransparent: material.transparent,
      baseDepthWrite: material.depthWrite,
    });
  }
  return {
    object,
    setAppearance(opacity, colorOverride) {
      const multiplier = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
      for (const entry of owned) {
        const colour = colourOf(entry.material);
        if (colour !== null && entry.baseColour !== null) {
          colour.copy(entry.baseColour);
          if (colorOverride !== undefined) colour.set(colorOverride);
        }
        entry.material.opacity = entry.baseOpacity * multiplier;
        entry.material.depthWrite = multiplier < 1 ? false : entry.baseDepthWrite;
        const transparent = entry.baseTransparent || multiplier < 1;
        if (entry.material.transparent !== transparent) {
          entry.material.transparent = transparent;
          entry.material.needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const entry of owned) entry.material.dispose();
    },
  };
}
