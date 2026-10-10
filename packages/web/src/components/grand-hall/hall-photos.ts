// ---------------------------------------------------------------------------
// The hall's photographs: wall atlas, floor, ceiling and dome
//
// Made by projecting the scan's 8K station panoramas onto the measured
// surfaces (tools/grand-hall-survey). They load in the background; until
// they arrive each surface shows a single texel of its average colour, so the
// room reads correctly from the first frame and simply sharpens. Materials
// sample them through texture nodes this class owns, so a loaded image is
// swapped in everywhere at once without rebuilding a material.
// ---------------------------------------------------------------------------

import {
  ClampToEdgeWrapping,
  DataTexture,
  ImageBitmapLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from "three";
import { texture as textureNode } from "three/tsl";

/** Where the survey's images are published (dated by the capture). */
export const HALL_PHOTO_BASE = "/rooms/grand-hall/survey-2026-07-11";

/**
 * Raised whenever the survey's files are rebuilt in place. The folder is
 * served with an hour's cache and a week's stale-while-revalidate, so a new
 * build must never meet an old atlas or relief kept by a browser.
 */
export const HALL_SURVEY_REVISION = 3;

/** A survey file's URL, at this revision. */
export function hallSurveyUrl(file: string): string {
  return `${HALL_PHOTO_BASE}/${file}?r=${String(HALL_SURVEY_REVISION)}`;
}

export type HallPhotoKind = "walls" | "floor" | "ceiling" | "dome";

/**
 * The photographs the hall loads. The floor is drawn (hall-floor.ts): its
 * survey image stays published for the survey's record but is not fetched.
 */
export const HALL_LOADED_PHOTOS: readonly Exclude<HallPhotoKind, "floor">[] = ["walls", "ceiling", "dome"];

/** Number of photographs the hall loads. */
export const HALL_PHOTO_COUNT = HALL_LOADED_PHOTOS.length;

/** Files for a device: full resolution on desktops, half on phones. */
export function hallPhotoFiles(quality: number): Readonly<Record<Exclude<HallPhotoKind, "floor">, string>> {
  const full = quality >= 0.75;
  return {
    walls: hallSurveyUrl(`walls-${full ? "4096" : "2048"}.webp`),
    ceiling: hallSurveyUrl(`ceiling-${full ? "3072" : "1536"}.webp`),
    dome: hallSurveyUrl(`dome-${full ? "4096" : "2048"}.webp`),
  };
}

/** Average colour of each image (sRGB), shown until it loads. */
const PLACEHOLDER: Readonly<Record<HallPhotoKind, readonly [number, number, number]>> = {
  walls: [134, 117, 100],
  floor: [158, 138, 115],
  ceiling: [144, 113, 76],
  dome: [133, 106, 76],
};

function placeholder(rgb: readonly [number, number, number]): DataTexture {
  const created = new DataTexture(new Uint8Array([rgb[0], rgb[1], rgb[2], 255]), 1, 1, RGBAFormat, UnsignedByteType);
  created.colorSpace = SRGBColorSpace;
  // A DataTexture defaults to nearest filtering, which WebGPU's node builder
  // treats as unfilterable and binds without a sampler; the wall material's
  // biased sample then fails to compile. Linear keeps it a sampled texture.
  created.magFilter = LinearFilter;
  created.minFilter = LinearFilter;
  created.needsUpdate = true;
  return created;
}

/** A texture node sampling one photograph (typed as a vec4 sample). */
function photoNode(image: Texture, uv: Parameters<typeof textureNode>[1]) {
  return textureNode(image, uv);
}

type PhotoNode = ReturnType<typeof photoNode>;

export class HallPhotos {
  private readonly current: Record<HallPhotoKind, Texture>;
  private readonly placeholders: Texture[];
  private readonly nodes: Record<HallPhotoKind, PhotoNode[]> = { walls: [], floor: [], ceiling: [], dome: [] };
  private readonly loaded: Texture[] = [];
  private readonly bitmaps: ImageBitmap[] = [];
  private disposed = false;

  constructor() {
    const walls = placeholder(PLACEHOLDER.walls);
    const floor = placeholder(PLACEHOLDER.floor);
    const ceiling = placeholder(PLACEHOLDER.ceiling);
    const dome = placeholder(PLACEHOLDER.dome);
    this.current = { walls, floor, ceiling, dome };
    this.placeholders = [walls, floor, ceiling, dome];
  }

  /** A sampling node for one photograph at the given texture coordinates. */
  sample(kind: HallPhotoKind, uv: Parameters<typeof textureNode>[1]): PhotoNode {
    const node = photoNode(this.current[kind], uv);
    this.nodes[kind].push(node);
    return node;
  }

  /** Loads every photograph; `onSettled` runs as each arrives or fails. */
  load(quality: number, onSettled: (kind: HallPhotoKind, loaded: boolean) => void): void {
    const files = hallPhotoFiles(quality);
    // Decoded off the main thread: an image element is decoded on it at its
    // first upload, hundreds of milliseconds for the 4096 px walls, a stall
    // on a phone. The bitmap is flipped as it decodes, so either backend
    // uploads it unflipped and sees the same orientation.
    const loader = new ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
    for (const kind of HALL_LOADED_PHOTOS) {
      loader.load(files[kind], (bitmap) => {
        if (this.disposed) { bitmap.close(); return; }
        this.bitmaps.push(bitmap);
        const image = new Texture(bitmap);
        image.flipY = false;
        image.colorSpace = SRGBColorSpace;
        image.wrapS = kind === "dome" ? RepeatWrapping : ClampToEdgeWrapping;
        image.wrapT = ClampToEdgeWrapping;
        image.magFilter = LinearFilter;
        image.minFilter = LinearMipmapLinearFilter;
        image.generateMipmaps = true;
        image.anisotropy = 8;
        image.needsUpdate = true;
        this.loaded.push(image);
        this.current[kind] = image;
        for (const node of this.nodes[kind]) node.value = image;
        onSettled(kind, true);
      }, undefined, () => {
        // A missing photograph leaves its surfaces in their average colour.
        if (!this.disposed) onSettled(kind, false);
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const texture of [...this.placeholders, ...this.loaded]) texture.dispose();
    for (const bitmap of this.bitmaps) bitmap.close();
  }
}
