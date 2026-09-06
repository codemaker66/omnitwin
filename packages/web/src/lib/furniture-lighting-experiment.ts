import { Box3, LightProbe, Matrix4, SphericalHarmonics3, Vector3 } from "three";
import { GRAND_HALL_FURNITURE_LIGHTING_PROBE as measurement } from "../data/grand-hall-furniture-lighting-probe.js";
import { getCatalogueItem } from "./catalogue.js";
import { normalizeFurnitureScale } from "./furniture-scale.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { toRenderSpace } from "../constants/scale.js";
import type { PlacedItem } from "./placement.js";
import type { DirectionalLight } from "three";

export type FurnitureLightingChoice = "baseline" | "panorama" | "panorama-shadow";
type Triple = readonly [number, number, number];

/** Local opt-in comparison. Unknown values, other rooms and model mode stay baseline. */
export function resolveFurnitureLightingExperiment(options: {
  readonly search: string;
  readonly development: boolean;
  readonly roomSlug: string | null;
  readonly layerMode: string;
  readonly splatActive: boolean;
  readonly timelinePreviewActive: boolean;
}): FurnitureLightingChoice {
  if (!options.development || options.roomSlug !== "grand-hall"
    || options.layerMode !== "splat" || !options.splatActive || options.timelinePreviewActive) return "baseline";
  const value = new URLSearchParams(options.search).get("furniture-lighting");
  return value === "panorama" || value === "panorama-shadow" ? value : "baseline";
}

export function createFurnitureLightProbe(coefficients: readonly (readonly number[])[] = measurement.diffuse_sh_rgb): LightProbe {
  if (coefficients.length !== 9 || coefficients.some((rgb) => rgb.length !== 3 || rgb.some((v) => !Number.isFinite(v)))) {
    throw new Error("Furniture lighting requires nine finite RGB SH coefficients");
  }
  return new LightProbe(new SphericalHarmonics3().fromArray(coefficients.flat()), 1);
}

export const FURNITURE_KEY_DIRECTION = new Vector3().fromArray(measurement.key_direction_to_light).normalize();
export const FURNITURE_KEY_RGB: Triple = measurement.key_linear_rgb_irradiance;
/** One map for the fitted furniture extent, at the same resolution on every device. */
export const FURNITURE_SHADOW_MAP_SIZE = 2048;

/** R3F assigns pierced camera bounds; Three does not refresh an existing map's projection. */
export function refreshFurnitureShadowProjection(light: DirectionalLight): void {
  light.shadow.camera.updateProjectionMatrix();
}

export interface FurnitureShadowFrame {
  readonly position: Triple;
  readonly target: Triple;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near: number;
  readonly far: number;
}

/** Fit canonical furniture bounds, including rotation, scale and table dressing. */
export function furnitureShadowFrame(items: readonly PlacedItem[]): FurnitureShadowFrame {
  const corners: Vector3[] = [];
  for (const placed of items) {
    if (!isSceneFurniturePlacement(placed)) continue;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    const scale = normalizeFurnitureScale(placed.scale);
    const halfWidth = toRenderSpace(item.width)*scale/2;
    const halfDepth = toRenderSpace(item.depth)*scale/2;
    const cos = Math.cos(placed.rotationY), sin = Math.sin(placed.rotationY);
    for (const x of [-halfWidth, halfWidth]) {
      for (const z of [-halfDepth, halfDepth]) {
        for (const y of [0, (item.height+.25)*scale]) {
          corners.push(new Vector3(placed.x+x*cos+z*sin, placed.y+y, placed.z-x*sin+z*cos));
        }
      }
    }
  }
  if (corners.length === 0) corners.push(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
  const bounds = new Box3().setFromPoints(corners);
  const target = bounds.getCenter(new Vector3());
  const distance = bounds.getSize(new Vector3()).length()+2;
  const position = target.clone().addScaledVector(FURNITURE_KEY_DIRECTION, distance);
  const view = new Matrix4().lookAt(position, target, new Vector3(0, 1, 0)).setPosition(position).invert();
  const projected = new Box3().setFromPoints(corners.map((corner) => corner.clone().applyMatrix4(view)));
  const margin = .3;
  return {
    position: [position.x, position.y, position.z], target: [target.x, target.y, target.z],
    left: projected.min.x-margin, right: projected.max.x+margin,
    bottom: projected.min.y-margin, top: projected.max.y+margin,
    near: Math.max(.1, -projected.max.z-margin), far: -projected.min.z+margin,
  };
}
