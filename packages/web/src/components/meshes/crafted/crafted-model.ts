import { type BufferGeometry, Color, Group, type Material, Mesh } from "three";
import { HALL_SUN_CASTER_LAYER } from "../../grand-hall/hall-sun.js";
import { craftedMaterial, isFloorShade, isShadowCaster, type CraftedMaterialId } from "./crafted-materials.js";
import { mergeParts } from "./crafted-geometry.js";

// ---------------------------------------------------------------------------
// Crafted furniture models
//
// A factory returns parts (geometry + palette material). The parts that share
// a material merge into one geometry, so a chair is two or three meshes and
// the instancing layer draws every chair of a type in two or three calls.
// The merged geometry is shared by every copy of a piece (crafted-registry.ts
// caches it); each copy owns only its materials, which the placement ghost
// fades and tints. The maps belong to crafted-textures.ts.
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

/** Merges a factory's parts into one geometry per material, in first-seen order. */
export function mergeCraftedParts(parts: readonly CraftedPart[]): ReadonlyMap<CraftedMaterialId, BufferGeometry> {
  const byMaterial = new Map<CraftedMaterialId, BufferGeometry[]>();
  for (const part of parts) {
    const list = byMaterial.get(part.material) ?? [];
    list.push(part.geometry);
    byMaterial.set(part.material, list);
  }
  const merged = new Map<CraftedMaterialId, BufferGeometry>();
  for (const [id, list] of byMaterial) {
    const geometry = mergeParts(list);
    geometry.computeBoundingSphere();
    merged.set(id, geometry);
  }
  return merged;
}

/**
 * A model drawing shared geometry with materials of its own. Disposing it
 * releases the materials; the geometry belongs to whoever shared it.
 */
export function instantiateCraftedModel(
  name: string,
  geometries: ReadonlyMap<CraftedMaterialId, BufferGeometry>,
): CraftedFurnitureInstance {
  const object = new Group();
  object.name = name;
  const owned: OwnedMaterial[] = [];
  const casters: Mesh[] = [];
  // A piece with a shadow caster casts the sun's shadow with it alone: the
  // parts that are seen only receive (crafted-materials.ts).
  const hasCaster = [...geometries.keys()].some(isShadowCaster);
  for (const [id, geometry] of geometries) {
    const material = craftedMaterial(id);
    const mesh = new Mesh(geometry, material);
    mesh.name = `${name}:${id}`;
    const caster = isShadowCaster(id);
    const shade = isFloorShade(id);
    mesh.castShadow = caster || (!hasCaster && !shade);
    mesh.receiveShadow = !caster && !shade;
    object.add(mesh);
    if (caster) {
      // On the stand-ins' layer, which only shadow cameras see: the view never
      // draws it (no pipeline, no vertices, no pick), so it is never faded or
      // tinted either.
      mesh.layers.set(HALL_SUN_CASTER_LAYER);
      casters.push(mesh);
      continue;
    }
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
      // A ghost (faded or tinted) casts no sun shadow: carried through a drag,
      // it would bring the caster into the shadow pass mid-gesture, and the
      // placement ghost must compile nothing then.
      const ghost = multiplier < 1 || colorOverride !== undefined;
      for (const mesh of casters) mesh.castShadow = !ghost;
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
      for (const entry of owned) entry.material.dispose();
      for (const mesh of casters) {
        const material = mesh.material;
        if (!Array.isArray(material)) material.dispose();
      }
    },
  };
}
