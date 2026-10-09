// ---------------------------------------------------------------------------
// Materials for the Grand Hall
//
// Photographed surfaces (walls, floor, ceiling, dome) show the scan's own
// images, relit for the current mood: the photograph already holds the hall's
// light at the time of the scan (daylight through the windows with the
// chandeliers and frieze uplights on), so each texel is scaled by the ratio of
// the mood's light to that scan light at its vertex, both from the same baked
// channels. In Daylight the ratio is one and the room is exactly as scanned;
// Evening and Candlelight dim the windows, warm the chandeliers and lift the
// frieze. Glossy photographs (varnished panelling, the floor) also reflect.
//
// The main door's painted mahogany multiplies its albedo by the vertex's baked
// light (emissive, so the renderer adds only reflections); gilt and brass are
// metals lit by the environment with a share of the bake so they never fall
// to black.
// ---------------------------------------------------------------------------

import { Color, FrontSide, type Material, type Side, type Texture } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, color, float, mix, positionWorld, smoothstep, texture, uniform, uv, vec2, vec3 } from "three/tsl";
import type { HallMaterialKey } from "./hall-builders.js";
import { HALL_MOODS, type HallMoodUniforms } from "./hall-mood.js";
import type { HallTextures } from "./hall-textures.js";
import type { HallPhotos, HallPhotoKind } from "./hall-photos.js";

type Shading = "gloss" | "metal" | "photo" | "photoGloss";

interface SurfaceStyle {
  readonly shading: Shading;
  readonly map?: Texture;
  readonly photo?: HallPhotoKind;
  readonly tint: string;
  /** Texture repeats per uv unit. */
  readonly repeat?: readonly [number, number];
  readonly roughness?: number;
  readonly side?: Side;
  /** Share of the bake a metal keeps as diffuse fill. */
  readonly fill?: number;
}

/**
 * Cut heights for the dollhouse cutaway: one per wall (in HALL_WALLS order)
 * and one for the ceiling and dome. A fragment above its part's cut height is
 * discarded, so the planner can look into the room from above while the
 * walls behind the furniture keep their full height.
 */
export class HallSectionUniforms {
  readonly cuts = [uniform(100), uniform(100), uniform(100), uniform(100), uniform(100)] as const;

  set(index: number, height: number): void {
    const cut = this.cuts[index];
    if (cut !== undefined) cut.value = height;
  }

  get(index: number): number {
    return this.cuts[index]?.value ?? 100;
  }
}

function sectionMask(section: HallSectionUniforms) {
  const wall = attribute("aWall", "float");
  const [c0, c1, c2, c3, c4] = section.cuts;
  const cut = wall.lessThan(-0.5).select(float(1000),
    wall.lessThan(0.5).select(c0,
      wall.lessThan(1.5).select(c1,
        wall.lessThan(2.5).select(c2,
          wall.lessThan(3.5).select(c3, c4)))));
  return positionWorld.y.lessThan(cut);
}

/** The baked irradiance at this vertex under the current mood. */
function bakedIrradiance(mood: HallMoodUniforms) {
  const light = attribute("aLight", "vec4");
  const ao = light.x;
  return mood.ambient.rgb.mul(mood.ambientIntensity).mul(ao)
    .add(mood.chandelier.rgb.mul(mood.chandelierIntensity).mul(light.y).mul(ao.mul(0.45).add(0.55)))
    .add(mood.daylight.rgb.mul(mood.daylightIntensity).mul(light.z).mul(ao.mul(0.5).add(0.5)))
    .add(mood.uplight.rgb.mul(mood.uplightIntensity).mul(light.w));
}

/**
 * The same irradiance under the light the scan was made in — the Daylight
 * mood's channels, fixed — against which photographs are relit.
 */
function scanIrradiance() {
  const scan = HALL_MOODS.daylight;
  const light = attribute("aLight", "vec4");
  const ao = light.x;
  const rgb = (hex: string) => vec3(...new Color(hex).toArray() as [number, number, number]);
  return rgb(scan.ambient).mul(scan.ambientIntensity).mul(ao)
    .add(rgb(scan.chandelier).mul(scan.chandelierIntensity).mul(light.y).mul(ao.mul(0.45).add(0.55)))
    .add(rgb(scan.daylight).mul(scan.daylightIntensity).mul(light.z).mul(ao.mul(0.5).add(0.5)))
    .add(rgb(scan.uplight).mul(scan.uplightIntensity).mul(light.w));
}

/** The daylight the scan was made in, as one colour. */
function scanDaylight() {
  const scan = HALL_MOODS.daylight;
  const [r, g, b] = new Color(scan.daylight).multiplyScalar(scan.daylightIntensity).toArray();
  return vec3(r, g, b);
}

/**
 * A wall photograph's texel for this fragment. The orthophotos look straight
 * at each wall, so faces they see edge-on — the sides of doorcases, boards
 * and reveals — would stretch a single row of texels into streaks; those
 * faces take the photograph's local average colour (five mip levels coarser,
 * about 15 cm a texel) instead.
 */
function wallTexel(photos: HallPhotos) {
  const sample = photos.sample("walls", attribute("aAtlas", "vec2"));
  const face = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize();
  const wall = attribute("aWall", "float");
  // Window and door walls face along z; the end walls along x.
  const alongZ = wall.lessThan(0.5).or(wall.greaterThan(1.5).and(wall.lessThan(2.5)));
  const facing = alongZ.select(face.z.abs(), face.x.abs());
  return mix(sample.bias(float(5)), sample, smoothstep(0.18, 0.42, facing));
}

/** A photographed surface's colour under the current mood. */
function relitPhoto(photos: HallPhotos, kind: HallPhotoKind, mood: HallMoodUniforms) {
  const sample = kind === "walls" ? wallTexel(photos) : photos.sample(kind, uv());
  const image = sample.rgb;
  // (baked + k) / (scan + k): exactly 1 under the scan's own light, so
  // Daylight is the photograph, and finite where the bake is nearly dark.
  const k = float(0.06);
  const lit = image.mul(bakedIrradiance(mood).add(k).div(scanIrradiance().add(k)));
  if (kind !== "walls") return lit;
  // Glazing seen between the curtains is the view out, not a lit surface: it
  // follows the daylight alone, falling to dusk blue and then dark. The
  // atlas's alpha marks it (half opaque where the photograph shows glass).
  const glass = float(1).sub(sample.a).mul(2).clamp(0, 1);
  const outside = image.mul(mood.daylight.rgb.mul(mood.daylightIntensity).div(scanDaylight()));
  return mix(lit, outside, glass);
}

function albedoNode(style: SurfaceStyle) {
  const tint = color(new Color(style.tint)).rgb;
  if (style.map === undefined) return tint;
  const repeat = style.repeat ?? [1, 1];
  return texture(style.map, uv().mul(vec2(repeat[0], repeat[1]))).rgb.mul(tint);
}

function createSurface(style: SurfaceStyle, mood: HallMoodUniforms, photos: HallPhotos): Material {
  const side = style.side ?? FrontSide;
  if (style.shading === "photo" || style.shading === "photoGloss") {
    const lit = relitPhoto(photos, style.photo ?? "walls", mood);
    if (style.shading === "photo") {
      const material = new MeshBasicNodeMaterial({ side, fog: false });
      material.colorNode = lit;
      return material;
    }
    const material = new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.45, metalness: 0, fog: false });
    material.colorNode = vec3(0);
    material.emissiveNode = lit;
    return material;
  }
  const albedo = albedoNode(style);
  const irradiance = bakedIrradiance(mood);
  if (style.shading === "gloss") {
    const material = new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.4, metalness: 0, fog: false });
    material.colorNode = vec3(0);
    material.emissiveNode = albedo.mul(irradiance);
    return material;
  }
  // Metal: gilt and brass.
  const material = new MeshStandardNodeMaterial({ side, roughness: style.roughness ?? 0.32, metalness: 1, fog: false });
  material.colorNode = albedo;
  material.emissiveNode = albedo.mul(irradiance).mul(style.fill ?? 0.35);
  material.aoNode = attribute("aLight", "vec4").x;
  return material;
}

/** Shading, texture and tint of every hall material. */
function styles(textures: HallTextures): Record<HallMaterialKey, SurfaceStyle> {
  return {
    floor: { shading: "photoGloss", photo: "floor", tint: "#ffffff", roughness: 0.5 },
    wallPhoto: { shading: "photo", photo: "walls", tint: "#ffffff" },
    wallPhotoGloss: { shading: "photoGloss", photo: "walls", tint: "#ffffff", roughness: 0.42 },
    ceilingPhoto: { shading: "photo", photo: "ceiling", tint: "#ffffff" },
    domePhoto: { shading: "photo", photo: "dome", tint: "#ffffff" },
    mahoganyDark: { shading: "gloss", map: textures.mahoganyDark, tint: "#ffffff", repeat: [1, 1], roughness: 0.38 },
    gilt: { shading: "metal", tint: "#d6a650", roughness: 0.3, fill: 0.4 },
    brass: { shading: "metal", tint: "#c9a35a", roughness: 0.28, fill: 0.4 },
  };
}

export type HallMaterials = ReadonlyMap<HallMaterialKey, Material>;

export function createHallMaterials(textures: HallTextures, photos: HallPhotos, mood: HallMoodUniforms, section: HallSectionUniforms): HallMaterials {
  const table = styles(textures);
  const materials = new Map<HallMaterialKey, Material>();
  for (const key of Object.keys(table) as HallMaterialKey[]) {
    const material = createSurface(table[key], mood, photos);
    if (material instanceof MeshBasicNodeMaterial || material instanceof MeshStandardNodeMaterial) {
      material.maskNode = sectionMask(section);
    }
    material.name = `grand-hall-${key}`;
    materials.set(key, material);
  }
  return materials;
}

export function disposeHallMaterials(materials: HallMaterials): void {
  for (const material of materials.values()) material.dispose();
}
