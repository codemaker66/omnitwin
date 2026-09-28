import { Vector4, type Matrix4, type Vector3 } from "three";

/** Hides captured splats a measured surface replaces (T-639: the floor slab
 * under the photographic floor). `matrix` maps a scene-frame splat centre to
 * (u, v, signed distance above the surface, 1); a splat is hidden when (u, v)
 * lies on the mask and the distance is within [-below, above]. */
export interface SplatExclusion {
  readonly matrix: Matrix4;
  readonly below: number;
  readonly above: number;
  readonly mask: { readonly width: number; readonly height: number; readonly data: Uint8Array };
}

/** The host's fixed mask grid; one R8 texture shared by every draw. */
export const EXCLUSION_MASK_WIDTH = 1024;
export const EXCLUSION_MASK_HEIGHT = 512;

export function resampleExclusionMask(mask: SplatExclusion["mask"], width: number, height: number): Uint8Array {
  if (mask.data.length !== mask.width * mask.height) throw new Error("The exclusion mask size does not match its data.");
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(((x + 0.5) * mask.width) / width));
      out[y * width + x] = mask.data[sy * mask.width + sx] ?? 0;
    }
  }
  return out;
}

/** CPU reference of the shader rule in native-splat-scene.ts. */
export function excludedBySlab(point: Vector3, exclusion: SplatExclusion): boolean {
  const q = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(exclusion.matrix);
  if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return false;
  if (q.z < -exclusion.below || q.z > exclusion.above) return false;
  const { width, height, data } = exclusion.mask;
  const x = Math.min(width - 1, Math.floor(q.x * width));
  const y = Math.min(height - 1, Math.floor(q.y * height));
  return (data[y * width + x] ?? 0) >= 128;
}
