import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";

import {
  deriveGrandHallT554NativeMaskSpatialFactsV2,
} from "../grand-hall-t554-native-mask-spatial-digest-v2.js";

const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;

function createExcludedPlanes(): {
  readonly mask: Buffer;
  readonly reasons: Buffer;
} {
  return {
    mask: Buffer.alloc(PIXEL_COUNT, 255),
    reasons: Buffer.alloc(PIXEL_COUNT, 5),
  };
}

describe("Grand Hall T-554 native mask spatial digest v2", () => {
  it("distinguishes equal-count masks with pixels at different source-grid positions", () => {
    const planes = createExcludedPlanes();
    try {
      planes.mask[0] = 0;
      planes.reasons[0] = 0;
      const first = deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      );

      planes.mask[0] = 255;
      planes.reasons[0] = 5;
      planes.mask[GRAND_HALL_PANORAMA_WIDTH_PX + 1] = 0;
      planes.reasons[GRAND_HALL_PANORAMA_WIDTH_PX + 1] = 0;
      const moved = deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      );

      expect(moved.includedPixelCount).toBe(first.includedPixelCount);
      expect(moved.excludedPixelCount).toBe(first.excludedPixelCount);
      expect(moved.reasonSampleCounts).toEqual(first.reasonSampleCounts);
      expect(moved.pixelTileInventorySha256).not.toBe(
        first.pixelTileInventorySha256,
      );
    } finally {
      planes.mask.fill(0);
      planes.reasons.fill(0);
    }
  }, 30_000);

  it("distinguishes swapped exclusion-reason locations with identical counts", () => {
    const planes = createExcludedPlanes();
    try {
      planes.reasons[0] = 1;
      planes.reasons[1] = 3;
      const first = deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      );

      planes.reasons[0] = 3;
      planes.reasons[1] = 1;
      const swapped = deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      );

      expect(swapped.includedPixelCount).toBe(first.includedPixelCount);
      expect(swapped.excludedPixelCount).toBe(first.excludedPixelCount);
      expect(swapped.reasonSampleCounts).toEqual(first.reasonSampleCounts);
      expect(swapped.pixelTileInventorySha256).not.toBe(
        first.pixelTileInventorySha256,
      );
    } finally {
      planes.mask.fill(0);
      planes.reasons.fill(0);
    }
  }, 30_000);

  it("rejects malformed lengths, samples, and binary/reason disagreement", () => {
    const planes = createExcludedPlanes();
    const shortMask = Buffer.alloc(PIXEL_COUNT - 1, 255);
    try {
      const establishedV2Baseline = deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      );
      expect(establishedV2Baseline.pixelTileInventorySha256).toBe(
        "sha256:00fb75790d2897cb94ff7c3d63c03b0e00dceac857dc7497f755ecb6ca9dd2a5",
      );

      expect(() => deriveGrandHallT554NativeMaskSpatialFactsV2(
        shortMask,
        planes.reasons,
      )).toThrow(/exact/u);

      planes.mask[17] = 0;
      expect(() => deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      )).toThrow(/disagree at source-grid offset 17/u);

      planes.mask[17] = 255;
      planes.reasons[17] = 6;
      expect(() => deriveGrandHallT554NativeMaskSpatialFactsV2(
        planes.mask,
        planes.reasons,
      )).toThrow(/disagree at source-grid offset 17/u);
    } finally {
      shortMask.fill(0);
      planes.mask.fill(0);
      planes.reasons.fill(0);
    }
  }, 30_000);
});
