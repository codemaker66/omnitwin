import {
  type BufferGeometry,
  Group,
  type Material,
  type Mesh,
  type Object3D,
  Texture,
} from "three";

import { createBanquetChairProxy } from "./createBanquetChairProxy.js";
import { createBarCounterProxy } from "./createBarCounterProxy.js";
import { createDanceFloorPanelProxy } from "./createDanceFloorPanelProxy.js";
import { createLecternProxy } from "./createLecternProxy.js";
import { createLaptopProxy } from "./createLaptopProxy.js";
import { createMicrophoneProxy } from "./createMicrophoneProxy.js";
import { createMicStandProxy } from "./createMicStandProxy.js";
import { createPlatformNarrowProxy } from "./createPlatformNarrowProxy.js";
import { createPlatformProxy } from "./createPlatformProxy.js";
import {
  createPoseurTableBlackProxy,
  createPoseurTableWhiteProxy,
} from "./createPoseurTableClothProxy.js";
import { createPoseurTableProxy } from "./createPoseurTableProxy.js";
import { createProjectorProxy } from "./createProjectorProxy.js";
import { createProjectorScreenProxy } from "./createProjectorScreenProxy.js";
import { createRoundTableProxy } from "./createRoundTableProxy.js";
import { createTrestle4ftProxy } from "./createTrestle4ftProxy.js";
import { createTrestleTableProxy } from "./createTrestleTableProxy.js";

export const GENERATED_FURNITURE_SLUGS = [
  "banquet-chair",
  "round-table-6ft",
  "trestle-6ft",
  "platform",
  "bar-counter",
  "dancefloor-panel",
  "projector-screen",
  "lectern",
  "projector",
  "trestle-4ft",
  "platform-narrow",
  "poseur-table",
  "laptop",
  "poseur-table-black",
  "poseur-table-white",
  "mic-stand",
  "microphone",
] as const;

export type GeneratedFurnitureSlug = (typeof GENERATED_FURNITURE_SLUGS)[number];
export type GeneratedFurnitureExplodeOrigin = readonly [number, number, number];

export interface GeneratedFurnitureFactoryOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

export interface GeneratedFurnitureProxyMarker {
  readonly kind: "ai-generated-furniture-proxy";
  readonly label: "AI-generated proxy — presentation only";
  readonly catalogueSlug: GeneratedFurnitureSlug;
  readonly provenance: "generated";
  readonly authority: "presentation-only";
  readonly measuredGeometry: false;
  readonly requiresVisibleBadge: true;
}

export const GENERATED_FURNITURE_PROXY_USER_DATA_KEY =
  "venviewerGeneratedFurnitureProxy";

type GeneratedFurnitureFactory = (
  options?: GeneratedFurnitureFactoryOptions,
) => Group;

const GENERATED_FURNITURE_FACTORIES: Readonly<
  Record<GeneratedFurnitureSlug, GeneratedFurnitureFactory>
> = {
  "banquet-chair": createBanquetChairProxy,
  "round-table-6ft": createRoundTableProxy,
  "trestle-6ft": createTrestleTableProxy,
  "platform": createPlatformProxy,
  "bar-counter": createBarCounterProxy,
  "dancefloor-panel": createDanceFloorPanelProxy,
  "projector-screen": createProjectorScreenProxy,
  "lectern": createLecternProxy,
  "projector": createProjectorProxy,
  "trestle-4ft": createTrestle4ftProxy,
  "platform-narrow": createPlatformNarrowProxy,
  "poseur-table": createPoseurTableProxy,
  "laptop": createLaptopProxy,
  "poseur-table-black": createPoseurTableBlackProxy,
  "poseur-table-white": createPoseurTableWhiteProxy,
  "mic-stand": createMicStandProxy,
  "microphone": createMicrophoneProxy,
};

const GENERATED_FURNITURE_EXPLODE_ORIGINS: Readonly<
  Record<GeneratedFurnitureSlug, GeneratedFurnitureExplodeOrigin>
> = {
  "banquet-chair": [0, 0.45, 0],
  "round-table-6ft": [0, 0.38, 0],
  "trestle-6ft": [0, 0.37, 0],
  "platform": [0, 0.2, 0],
  "bar-counter": [0, 0.604, 0],
  // Envelope centre. Deliberately clear of every pivot centre (subframe
  // y=0.015, deck y=0.039, locks y=0.008) so no part hits the runtime's
  // degenerate-direction fallback and shoots off at a hashed angle.
  "dancefloor-panel": [0, 0.025, 0],
  "projector-screen": [0, 0.9, 0],
  "lectern": [0, 0.575, 0],
  "projector": [0, 0.05, 0],
  "trestle-4ft": [0, 0.37, 0],
  "platform-narrow": [0, 0.2, 0],
  "poseur-table": [0, 0.525, 0],
  "laptop": [0, 0.125, 0],
  "poseur-table-black": [0, 0.525, 0],
  "poseur-table-white": [0, 0.525, 0],
  "mic-stand": [0, 0.8, 0],
  "microphone": [0, 0.125, 0],
};

type DisposableMesh = Mesh;

const MATERIAL_TEXTURE_KEYS = [
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
  "specularMap",
  "thicknessMap",
  "transmissionMap",
] as const;

type MaterialTextureKey = (typeof MATERIAL_TEXTURE_KEYS)[number];
type MaterialWithTextures = Material
  & Partial<Readonly<Record<MaterialTextureKey, unknown>>>;

function isDisposableMesh(object: Object3D): object is DisposableMesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

function proxyMarker(slug: GeneratedFurnitureSlug): GeneratedFurnitureProxyMarker {
  return Object.freeze({
    kind: "ai-generated-furniture-proxy",
    label: "AI-generated proxy — presentation only",
    catalogueSlug: slug,
    provenance: "generated",
    authority: "presentation-only",
    measuredGeometry: false,
    requiresVisibleBadge: true,
  });
}

/** Narrow an arbitrary catalogue slug to the exact generated-proxy registry. */
export function isGeneratedFurnitureSlug(
  slug: string,
): slug is GeneratedFurnitureSlug {
  switch (slug) {
    case "banquet-chair":
    case "round-table-6ft":
    case "trestle-6ft":
    case "platform":
    case "bar-counter":
    case "dancefloor-panel":
    case "projector-screen":
    case "lectern":
    case "projector":
    case "trestle-4ft":
    case "platform-narrow":
    case "poseur-table":
    case "laptop":
    case "poseur-table-black":
    case "poseur-table-white":
    case "mic-stand":
    case "microphone":
      return true;
    default:
      return false;
  }
}

/** Canonical metre-space envelope centre used for radial part separation. */
export function generatedFurnitureExplodeOrigin(
  slug: GeneratedFurnitureSlug,
): GeneratedFurnitureExplodeOrigin {
  return GENERATED_FURNITURE_EXPLODE_ORIGINS[slug];
}

/** Construct a fresh generated proxy only when a caller elects to render it. */
export function createGeneratedFurnitureObject(
  slug: GeneratedFurnitureSlug,
  options: GeneratedFurnitureFactoryOptions = {},
): Group {
  const root = GENERATED_FURNITURE_FACTORIES[slug](options);
  root.userData[GENERATED_FURNITURE_PROXY_USER_DATA_KEY] = proxyMarker(slug);
  return root;
}

/**
 * Dispose resources owned by a generated proxy.
 *
 * Factories create their geometry and materials per root. Sets keep disposal
 * correct when multiple meshes within an assembly deliberately share either.
 */
export function disposeGeneratedFurnitureObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    if (!isDisposableMesh(object)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      const materialWithTextures = material as MaterialWithTextures;
      for (const key of MATERIAL_TEXTURE_KEYS) {
        const texture = materialWithTextures[key];
        if (texture instanceof Texture) textures.add(texture);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
