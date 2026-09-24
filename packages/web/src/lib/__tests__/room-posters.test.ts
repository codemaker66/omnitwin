import { describe, expect, it } from "vitest";
import { imageSize, publicAsset, srcSetRungs } from "../../test/image-header.js";
import { SUPPLIED_ROOM_STILLS, roomPosterSources, roomScanPosterUrl } from "../room-posters.js";

describe("room poster sources", () => {
  it("serves every supplied photograph through a WebP ladder cut from that photograph", () => {
    for (const [slug, still] of Object.entries(SUPPLIED_ROOM_STILLS)) {
      const sources = roomPosterSources(slug);
      expect(sources.srcSet, slug).toBeDefined();
      const rungs = srcSetRungs(sources.srcSet ?? "");
      expect(rungs.length, slug).toBeGreaterThanOrEqual(3);
      expect(rungs.map((rung) => rung.width), slug).toEqual([...rungs.map((rung) => rung.width)].sort((a, b) => a - b));
      expect(sources.src, slug).toBe(rungs.at(-1)?.path);

      const original = imageSize(publicAsset(still));
      for (const rung of rungs) {
        const bytes = publicAsset(rung.path);
        expect(bytes.toString("ascii", 8, 12), rung.path).toBe("WEBP");
        const size = imageSize(bytes);
        expect(size.width, rung.path).toBe(rung.width);
        expect(size.width / size.height, rung.path).toBeCloseTo(original.width / original.height, 2);
        // Display-sized means well under the original's weight.
        expect(bytes.length, rung.path).toBeLessThan(publicAsset(still).length);
      }
    }
  });

  it("falls back to the scan poster for rooms without a photograph", () => {
    for (const slug of ["unknown-room", "__proto__", "constructor", "toString", ""]) {
      expect(roomPosterSources(slug)).toEqual({ src: roomScanPosterUrl(slug) });
    }
  });
});
