// ---------------------------------------------------------------------------
// A surveyed room's photographs: wall atlas, ceiling and floor
//
// Loaded as the Grand Hall's are (grand-hall/hall-photos.ts), but named by the
// room's record instead of by constants. They arrive in the background; until
// one does, its surface shows a single texel of a plain mid-grey, so the
// room has its shape from the first frame and then takes its photographs.
// Materials sample them through texture nodes this class owns, so a loaded
// image is swapped in everywhere at once without rebuilding a material, and
// the placeholder is made the way the image will be (filtered, sRGB), so the
// swap compiles nothing.
//
// The record lists each photograph at several sizes, largest first. A
// computer or a tablet takes the first; a phone or a software rasteriser the
// next size down, a quarter of the download and of the texture memory
// (grand-hall/hall-finish.ts decides which a device is).
//
// The record carries no average colours, so every placeholder is the same
// tone; a photograph that fails to load leaves its surface in it, and the
// caller is told (SurveyedRoomModel counts it as failed, never as loaded).
// ---------------------------------------------------------------------------

import {
  ClampToEdgeWrapping,
  DataTexture,
  ImageBitmapLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from "three";
import { texture as textureNode } from "three/tsl";
import { surveyFileUrl, type SurveyedRoomEntry } from "./room-registry.js";
import type { SurveyRecord } from "./survey-record.js";

export type RoomPhotoKind = "walls" | "ceiling" | "floor";

export const ROOM_PHOTO_KINDS: readonly RoomPhotoKind[] = ["walls", "ceiling", "floor"];

/** One photograph to load for a room on this device. */
export interface RoomPhotoSource {
  readonly kind: RoomPhotoKind;
  readonly file: string;
  readonly url: string;
}

/** At or above this photograph quality a device takes the largest image. */
export const FULL_PHOTO_QUALITY = 0.75;

/**
 * The image of a list (largest first) for a device's photograph quality: the
 * largest at full quality, otherwise the next size down where there is one.
 * Null for a surface that publishes no photograph.
 */
export function roomPhotoFile(files: readonly string[], quality: number): string | null {
  const [largest, next] = files;
  if (largest === undefined) return null;
  return quality >= FULL_PHOTO_QUALITY ? largest : next ?? largest;
}

/** The photographs a room loads on a device, each at the entry's revision. */
export function roomPhotoSources(
  record: Pick<SurveyRecord, "atlas" | "ceiling" | "floor">, entry: SurveyedRoomEntry, quality: number,
): RoomPhotoSource[] {
  const lists: Readonly<Record<RoomPhotoKind, readonly string[]>> = {
    walls: record.atlas.files, ceiling: record.ceiling.files, floor: record.floor.files,
  };
  return ROOM_PHOTO_KINDS.flatMap((kind): RoomPhotoSource[] => {
    const file = roomPhotoFile(lists[kind], quality);
    return file === null ? [] : [{ kind, file, url: surveyFileUrl(entry, file) }];
  });
}

/** What every surface shows until its photograph arrives: a plain, warm mid-grey (sRGB). */
export const ROOM_PLACEHOLDER_TONE: readonly [number, number, number] = [132, 123, 112];

function placeholder(): DataTexture {
  const [r, g, b] = ROOM_PLACEHOLDER_TONE;
  // Opaque: in the wall atlas a lower alpha would mark glass.
  const created = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  created.colorSpace = SRGBColorSpace;
  // A DataTexture defaults to nearest filtering, which WebGPU's node builder
  // treats as unfilterable and binds without a sampler; a material's biased
  // sample then fails to compile (hall-photos.ts). Linear keeps it a sampled
  // texture, bound as the photograph that replaces it will be.
  created.magFilter = LinearFilter;
  created.minFilter = LinearFilter;
  created.needsUpdate = true;
  return created;
}

/** A texture node sampling one photograph (typed as a vec4 sample). */
function photoNode(image: Texture, uv: Parameters<typeof textureNode>[1]) {
  return textureNode(image, uv);
}

export type RoomPhotoNode = ReturnType<typeof photoNode>;

export class RoomPhotos {
  private readonly current: Record<RoomPhotoKind, Texture>;
  private readonly placeholders: Texture[];
  private readonly nodes: Record<RoomPhotoKind, RoomPhotoNode[]> = { walls: [], ceiling: [], floor: [] };
  private readonly loaded: Texture[] = [];
  private readonly bitmaps: ImageBitmap[] = [];
  private disposed = false;

  constructor() {
    const walls = placeholder();
    const ceiling = placeholder();
    const floor = placeholder();
    this.current = { walls, ceiling, floor };
    this.placeholders = [walls, ceiling, floor];
  }

  /** A sampling node for one photograph at the given texture coordinates. */
  sample(kind: RoomPhotoKind, uv: Parameters<typeof textureNode>[1]): RoomPhotoNode {
    const node = photoNode(this.current[kind], uv);
    this.nodes[kind].push(node);
    return node;
  }

  /** Loads each photograph; `onSettled` runs as each arrives or fails, never after dispose. */
  load(sources: readonly RoomPhotoSource[], onSettled: (source: RoomPhotoSource, loaded: boolean) => void): void {
    // Decoded off the main thread: an image element is decoded on it at its
    // first upload, hundreds of milliseconds for a 4096 px atlas. The bitmap
    // is flipped as it decodes, so either backend uploads it unflipped and
    // sees the same orientation; its alpha is kept as stored, since the wall
    // atlas's alpha is a mask (glass), not a coverage to premultiply by.
    const loader = new ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
    for (const source of sources) {
      loader.load(source.url, (bitmap) => {
        if (this.disposed) { bitmap.close(); return; }
        this.bitmaps.push(bitmap);
        const image = new Texture(bitmap);
        image.flipY = false;
        image.colorSpace = SRGBColorSpace;
        image.wrapS = ClampToEdgeWrapping;
        image.wrapT = ClampToEdgeWrapping;
        image.magFilter = LinearFilter;
        image.minFilter = LinearMipmapLinearFilter;
        image.generateMipmaps = true;
        image.anisotropy = 8;
        image.needsUpdate = true;
        this.loaded.push(image);
        this.current[source.kind] = image;
        for (const node of this.nodes[source.kind]) node.value = image;
        onSettled(source, true);
      }, undefined, () => {
        // A missing photograph leaves its surface in the placeholder's tone.
        if (!this.disposed) onSettled(source, false);
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const texture of [...this.placeholders, ...this.loaded]) texture.dispose();
    for (const bitmap of this.bitmaps) bitmap.close();
  }
}
