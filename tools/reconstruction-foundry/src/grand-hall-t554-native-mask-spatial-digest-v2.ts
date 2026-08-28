import { createHash } from "node:crypto";

import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";

export const GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX = 256;
export const GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX = 256;

const MASK_TILE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_TILE_V2";
const REASON_TILE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REASON_TILE_V2";
const PIXEL_TILE_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_PIXEL_TILE_INVENTORY_V2";
const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const TILE_COLUMN_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX / GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
const TILE_ROW_COUNT =
  GRAND_HALL_PANORAMA_HEIGHT_PX / GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
const TILE_COUNT = TILE_COLUMN_COUNT * TILE_ROW_COUNT;
const TILE_PIXEL_COUNT =
  GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX *
  GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_REASON_SAMPLE = 5;

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

export interface GrandHallT554NativeMaskTileDigestPairV2 {
  readonly maskSha256: `sha256:${string}`;
  readonly reasonSha256: `sha256:${string}`;
}

export type GrandHallT554NativeMaskReasonSampleCountsV2 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface GrandHallT554NativeMaskSpatialFactsV2 {
  readonly includedPixelCount: number;
  readonly excludedPixelCount: number;
  /** Index zero is included; indexes 1..5 use the fixed exclusion-reason codebook. */
  readonly reasonSampleCounts: GrandHallT554NativeMaskReasonSampleCountsV2;
  readonly pixelTileInventorySha256: `sha256:${string}`;
}

function assertExactBuffer(
  value: unknown,
  expectedByteLength: number,
  name: string,
): asserts value is Buffer {
  if (!Buffer.isBuffer(value) || value.length !== expectedByteLength) {
    throw new TypeError(`${name} must be an exact ${String(expectedByteLength)}-byte Buffer`);
  }
}

function domainBytesDigest(
  domain: string,
  chunks: readonly Buffer[],
): `sha256:${string}` {
  const hash = createHash("sha256").update(`${domain}\n`, "utf8");
  chunks.forEach((chunk) => hash.update(chunk));
  return `sha256:${hash.digest("hex")}`;
}

function digestRowMajorTile(
  plane: Buffer,
  tileColumn: number,
  tileRow: number,
  domain: string,
): `sha256:${string}` {
  const hash = createHash("sha256").update(`${domain}\n`, "utf8");
  const firstX = tileColumn * GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX;
  const firstY = tileRow * GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
  for (
    let localY = 0;
    localY < GRAND_HALL_T554_NATIVE_MASK_TILE_HEIGHT_PX;
    localY += 1
  ) {
    const start =
      (firstY + localY) * GRAND_HALL_PANORAMA_WIDTH_PX + firstX;
    hash.update(
      plane.subarray(
        start,
        start + GRAND_HALL_T554_NATIVE_MASK_TILE_WIDTH_PX,
      ),
    );
  }
  return `sha256:${hash.digest("hex")}`;
}

function assertTileDigestPair(
  value: GrandHallT554NativeMaskTileDigestPairV2 | undefined,
  tileIndex: number,
): asserts value is GrandHallT554NativeMaskTileDigestPairV2 {
  if (
    value === undefined ||
    !SHA256_PATTERN.test(value.maskSha256) ||
    !SHA256_PATTERN.test(value.reasonSha256)
  ) {
    throw new TypeError(
      `native mask tile digest pair ${String(tileIndex)} is absent or malformed`,
    );
  }
}

function reasonCountTuple(
  counts: readonly number[],
): GrandHallT554NativeMaskReasonSampleCountsV2 {
  return Object.freeze([
    counts[0] ?? 0,
    counts[1] ?? 0,
    counts[2] ?? 0,
    counts[3] ?? 0,
    counts[4] ?? 0,
    counts[5] ?? 0,
  ]);
}

/**
 * Commits one exact tile using the established v2 byte domains. The input
 * planes are read synchronously and are neither retained nor exposed.
 */
export function computeGrandHallT554NativeMaskTileDigestPairV2(
  maskTile: Buffer,
  reasonTile: Buffer,
): GrandHallT554NativeMaskTileDigestPairV2 {
  assertExactBuffer(maskTile, TILE_PIXEL_COUNT, "native mask tile");
  assertExactBuffer(reasonTile, TILE_PIXEL_COUNT, "native reason tile");
  return Object.freeze({
    maskSha256: domainBytesDigest(MASK_TILE_DIGEST_DOMAIN, [maskTile]),
    reasonSha256: domainBytesDigest(REASON_TILE_DIGEST_DOMAIN, [reasonTile]),
  });
}

/**
 * Commits the fixed row-major 32 x 16 tile inventory. Its canonical JSON is
 * byte-identical to the original mask-store v2 stable-JSON composition.
 */
export function computeGrandHallT554NativeMaskPixelTileInventorySha256V2(
  tileDigests: readonly GrandHallT554NativeMaskTileDigestPairV2[],
): `sha256:${string}` {
  if (!isRuntimeArray(tileDigests) || tileDigests.length !== TILE_COUNT) {
    throw new TypeError(
      `native mask tile inventory must contain exactly ${String(TILE_COUNT)} entries`,
    );
  }
  const entries: string[] = [];
  for (let tileIndex = 0; tileIndex < TILE_COUNT; tileIndex += 1) {
    const pair = tileDigests[tileIndex];
    assertTileDigestPair(pair, tileIndex);
    entries.push(
      `{"maskSha256":"${pair.maskSha256}",` +
      `"reasonSha256":"${pair.reasonSha256}",` +
      `"tileIndex":${String(tileIndex)}}`,
    );
  }
  const canonicalInventory = `[${entries.join(",")}]`;
  return `sha256:${createHash("sha256")
    .update(`${PIXEL_TILE_INVENTORY_DIGEST_DOMAIN}\n`, "utf8")
    .update(canonicalInventory, "utf8")
    .digest("hex")}`;
}

/**
 * Validates and commits an exact row-major 8,192 x 4,096 binary mask/reason
 * pair. The returned digest is directly comparable with exactStateV2() at the
 * same committed revision; no pixel plane is retained in the result.
 */
export function deriveGrandHallT554NativeMaskSpatialFactsV2(
  maskPlane: Buffer,
  reasonPlane: Buffer,
): GrandHallT554NativeMaskSpatialFactsV2 {
  assertExactBuffer(maskPlane, PIXEL_COUNT, "row-major native mask plane");
  assertExactBuffer(reasonPlane, PIXEL_COUNT, "row-major native reason plane");

  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  const reasonSampleCounts = [0, 0, 0, 0, 0, 0];
  for (let offset = 0; offset < PIXEL_COUNT; offset += 1) {
    const maskSample = maskPlane[offset];
    const reasonSample = reasonPlane[offset];
    if (maskSample === 0 && reasonSample === 0) {
      includedPixelCount += 1;
      reasonSampleCounts[0] = (reasonSampleCounts[0] ?? 0) + 1;
    } else if (
      maskSample === 255 &&
      reasonSample !== undefined &&
      reasonSample >= 1 &&
      reasonSample <= MAX_REASON_SAMPLE
    ) {
      excludedPixelCount += 1;
      reasonSampleCounts[reasonSample] =
        (reasonSampleCounts[reasonSample] ?? 0) + 1;
    } else {
      throw new Error(
        `binary mask and reason map disagree at source-grid offset ${String(offset)}`,
      );
    }
  }

  const tileDigests: GrandHallT554NativeMaskTileDigestPairV2[] = [];
  for (let tileRow = 0; tileRow < TILE_ROW_COUNT; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < TILE_COLUMN_COUNT; tileColumn += 1) {
      tileDigests.push(Object.freeze({
        maskSha256: digestRowMajorTile(
          maskPlane,
          tileColumn,
          tileRow,
          MASK_TILE_DIGEST_DOMAIN,
        ),
        reasonSha256: digestRowMajorTile(
          reasonPlane,
          tileColumn,
          tileRow,
          REASON_TILE_DIGEST_DOMAIN,
        ),
      }));
    }
  }

  return Object.freeze({
    includedPixelCount,
    excludedPixelCount,
    reasonSampleCounts: reasonCountTuple(reasonSampleCounts),
    pixelTileInventorySha256:
      computeGrandHallT554NativeMaskPixelTileInventorySha256V2(tileDigests),
  });
}
