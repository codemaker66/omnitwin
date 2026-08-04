/**
 * Deterministic, read-only metadata inspection for the Grand Hall pilot:
 * COLMAP sparse-model binaries and the E57 container's paged logical stream.
 * Pure functions over caller-supplied bytes — no filesystem access here.
 */

export interface ColmapCameraRecord {
  readonly cameraId: number;
  readonly modelId: number;
  readonly width: number;
  readonly height: number;
  readonly params: readonly number[];
}

export interface ColmapImageRecord {
  readonly imageId: number;
  readonly qvec: readonly [number, number, number, number];
  readonly tvec: readonly [number, number, number];
  readonly cameraId: number;
  readonly name: string;
}

// COLMAP camera model ids -> parameter counts (colmap/src/base/camera_models.h).
const COLMAP_MODEL_PARAMS: ReadonlyMap<number, number> = new Map([
  [0, 3], // SIMPLE_PINHOLE
  [1, 4], // PINHOLE
  [2, 4], // SIMPLE_RADIAL
  [3, 5], // RADIAL
  [4, 8], // OPENCV
  [5, 8], // OPENCV_FISHEYE
]);

export function parseColmapCamerasBin(bytes: Uint8Array): ColmapCameraRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Number(view.getBigUint64(0, true));
  const cameras: ColmapCameraRecord[] = [];
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    const cameraId = view.getInt32(offset, true);
    const modelId = view.getInt32(offset + 4, true);
    const width = Number(view.getBigUint64(offset + 8, true));
    const height = Number(view.getBigUint64(offset + 16, true));
    offset += 24;
    const paramCount = COLMAP_MODEL_PARAMS.get(modelId);
    if (paramCount === undefined) {
      throw new Error(`unsupported COLMAP camera model id: ${String(modelId)}`);
    }
    const params: number[] = [];
    for (let p = 0; p < paramCount; p += 1) {
      params.push(view.getFloat64(offset, true));
      offset += 8;
    }
    cameras.push({ cameraId, modelId, width, height, params });
  }
  if (offset !== bytes.byteLength) {
    throw new Error("cameras.bin has trailing bytes beyond the declared records");
  }
  return cameras;
}

export function parseColmapImagesBin(bytes: Uint8Array): ColmapImageRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Number(view.getBigUint64(0, true));
  const images: ColmapImageRecord[] = [];
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    const imageId = view.getInt32(offset, true);
    offset += 4;
    const pose: number[] = [];
    for (let p = 0; p < 7; p += 1) {
      pose.push(view.getFloat64(offset, true));
      offset += 8;
    }
    const cameraId = view.getInt32(offset, true);
    offset += 4;
    let name = "";
    for (;;) {
      const byte = view.getUint8(offset);
      offset += 1;
      if (byte === 0) break;
      name += String.fromCharCode(byte);
    }
    const points2D = Number(view.getBigUint64(offset, true));
    offset += 8 + points2D * 24;
    images.push({
      imageId,
      qvec: [pose[0] ?? 0, pose[1] ?? 0, pose[2] ?? 0, pose[3] ?? 0],
      tvec: [pose[4] ?? 0, pose[5] ?? 0, pose[6] ?? 0],
      cameraId,
      name,
    });
  }
  return images;
}

/** Camera centre in world coordinates: C = -R^T t for COLMAP's world-to-camera pose. */
export function cameraCentreFromPose(
  qvec: readonly [number, number, number, number],
  tvec: readonly [number, number, number],
): [number, number, number] {
  const [w, x, y, z] = qvec;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);
  const [tx, ty, tz] = tvec;
  return [
    -(r00 * tx + r10 * ty + r20 * tz),
    -(r01 * tx + r11 * ty + r21 * tz),
    -(r02 * tx + r12 * ty + r22 * tz),
  ];
}

const E57_PAGE_BYTES = 1024;
const E57_PAGE_DATA_BYTES = 1020;

/**
 * Read a logical byte range from an E57 physical file: the physical stream is
 * divided into 1024-byte pages whose final 4 bytes are a CRC; the logical
 * stream is the concatenation of the 1020-byte data portions.
 */
export function readE57LogicalBytes(
  physical: Uint8Array,
  physicalStart: number,
  logicalLength: number,
): Uint8Array {
  const out = new Uint8Array(logicalLength);
  let physicalOffset = physicalStart;
  for (let logical = 0; logical < logicalLength; ) {
    const within = physicalOffset % E57_PAGE_BYTES;
    if (within >= E57_PAGE_DATA_BYTES) {
      physicalOffset += E57_PAGE_BYTES - within;
      continue;
    }
    const byte = physical[physicalOffset];
    if (byte === undefined) {
      throw new Error("logical read ran past the end of the physical buffer");
    }
    out[logical] = byte;
    logical += 1;
    physicalOffset += 1;
  }
  return out;
}

export interface E57ScanTranslation {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const TRANSLATION_PATTERN =
  /<translation[^>]*>\s*<x[^>]*>([-+0-9.eE]+)<\/x>\s*<y[^>]*>([-+0-9.eE]+)<\/y>\s*<z[^>]*>([-+0-9.eE]+)<\/z>/gu;

/**
 * Extract data3D pose translations in document order from E57 XML text.
 * Scoped strictly to the data3D section: the images2D section carries 894
 * camera-pose translations in this venue's file that must never be counted
 * as scan poses.
 */
export function extractE57ScanTranslations(xml: string): E57ScanTranslation[] {
  const sectionStart = xml.search(/<data3D[\s>]/u);
  if (sectionStart < 0) return [];
  const sectionEnd = xml.indexOf("</data3D>", sectionStart);
  const section = xml.slice(sectionStart, sectionEnd < 0 ? xml.length : sectionEnd);
  const translations: E57ScanTranslation[] = [];
  for (const match of section.matchAll(TRANSLATION_PATTERN)) {
    translations.push({
      index: translations.length,
      x: Number(match[1]),
      y: Number(match[2]),
      z: Number(match[3]),
    });
  }
  return translations;
}
