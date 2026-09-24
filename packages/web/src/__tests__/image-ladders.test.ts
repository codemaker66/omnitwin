import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { imageSize, publicAsset } from "../test/image-header.js";

// ---------------------------------------------------------------------------
// Display copies written by scripts/build-image-ladders.mjs. Each directory's
// provenance.json names the exact source every copy was cut from and the
// error its encoding introduced; these checks hold the committed files to it.
// ---------------------------------------------------------------------------

interface LadderProvenance {
  readonly transformation: { readonly encoding: string };
  readonly images: readonly {
    readonly source: { readonly path: string; readonly width: number; readonly height: number; readonly bytes: number; readonly sha256: string };
    readonly variants: readonly {
      readonly path: string;
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
      readonly sha256: string;
      readonly psnrDb: number | null;
      readonly maxChannelError: number;
    }[];
  }[];
}

const LADDERS = [
  "/trades-house-media/assets/crests/ladder/provenance.json",
  "/trades-house-media/assets/ladder/provenance.json",
] as const;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const ladder = (path: string): LadderProvenance => JSON.parse(publicAsset(path).toString("utf8")) as LadderProvenance;

describe("display-sized image copies", () => {
  it("are cut from the committed sources, at the recorded sizes, without upscaling", () => {
    for (const path of LADDERS) {
      for (const { source, variants } of ladder(path).images) {
        const original = publicAsset(source.path);
        expect(sha256(original), source.path).toBe(source.sha256);
        expect(imageSize(original), source.path).toEqual({ width: source.width, height: source.height });
        for (const variant of variants) {
          const bytes = publicAsset(variant.path);
          expect(sha256(bytes), variant.path).toBe(variant.sha256);
          expect(bytes.length, variant.path).toBe(variant.bytes);
          expect(bytes.length, variant.path).toBeLessThan(original.length);
          expect(imageSize(bytes), variant.path).toEqual({ width: variant.width, height: variant.height });
          expect(variant.width, variant.path).toBeLessThanOrEqual(source.width);
          expect(Math.abs(variant.height - (variant.width * source.height) / source.width), variant.path).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it("stay within a few levels of the exact resample", () => {
    for (const path of LADDERS) {
      const { transformation, images } = ladder(path);
      expect(transformation.encoding, path).toMatch(/^WebP near-lossless /u);
      for (const variant of images.flatMap((image) => image.variants)) {
        expect(variant.maxChannelError, variant.path).toBeLessThanOrEqual(6);
        expect(variant.psnrDb ?? Number.POSITIVE_INFINITY, variant.path).toBeGreaterThanOrEqual(45);
      }
    }
  });
});
