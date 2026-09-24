import { describe, expect, it } from "vitest";
import { imageSize, publicAsset, srcSetRungs } from "../../../test/image-header.js";
import { CRAFT_PROFILES } from "../craft-quiz-model.js";
import {
  INTRO_ACHIEVEMENT,
  INTRO_ARMORIAL_SIZES,
  INTRO_ARMS,
  RAIL_CREST_SIZES,
  medallionCrestSrc,
  railCrestSources,
} from "../quiz-image-sources.js";

const px = (sizes: string): number => Number(/^(\d+)px$/u.exec(sizes)?.[1] ?? Number.NaN);

/** Every rung is a WebP of its stated width, cut from the source without cropping or upscaling. */
function expectLadderOf(source: string, sources: { readonly src: string; readonly srcSet: string }, sizes: string, exactAspect: boolean): void {
  const original = imageSize(publicAsset(source));
  const originalBytes = publicAsset(source).length;
  const rungs = srcSetRungs(sources.srcSet);
  expect(rungs.map((rung) => rung.width), source).toEqual([...rungs.map((rung) => rung.width)].sort((a, b) => a - b));
  expect(sources.src, source).toBe(rungs.at(-1)?.path);
  // Sharp at the widest box on a 3x screen, and never wider than the source.
  expect(rungs.some((rung) => rung.width >= 3 * px(sizes)), source).toBe(true);
  expect(rungs.at(-1)?.width ?? Number.POSITIVE_INFINITY, source).toBeLessThanOrEqual(original.width);
  for (const rung of rungs) {
    const bytes = publicAsset(rung.path);
    expect(bytes.toString("ascii", 8, 12), rung.path).toBe("WEBP");
    const size = imageSize(bytes);
    expect(size.width, rung.path).toBe(rung.width);
    if (exactAspect) expect(size.height * original.width, rung.path).toBe(size.width * original.height);
    // A rung's height is the rounded source aspect: within half a pixel.
    expect(Math.abs(size.height - (size.width * original.height) / original.width), rung.path).toBeLessThanOrEqual(0.5);
    expect(bytes.length, rung.path).toBeLessThan(originalBytes);
  }
}

describe("craft quiz image sources", () => {
  it("draws every rail crest from a display-sized ladder of its own supplied crest", () => {
    for (const craft of Object.values(CRAFT_PROFILES)) {
      const sources = railCrestSources(craft.crest);
      expect(sources.srcSet, craft.name).toContain(`crests/ladder/${/([a-z-]+)\.png$/u.exec(craft.crest)?.[1] ?? ""}-56.webp 56w`);
      expectLadderOf(craft.crest, sources, RAIL_CREST_SIZES, false);
    }
  });

  it("gives the result medallion the crest at its full source resolution", () => {
    for (const craft of Object.values(CRAFT_PROFILES)) {
      const copy = imageSize(publicAsset(medallionCrestSrc(craft.crest)));
      expect(copy, craft.name).toEqual(imageSize(publicAsset(craft.crest)));
      // Shared with the rail's widest rung, so a crest fetched there is reused.
      expect(railCrestSources(craft.crest).src, craft.name).toBe(medallionCrestSrc(craft.crest));
    }
  });

  it("keeps the intro armorial's exact proportions at every width", () => {
    expectLadderOf("/trades-house-media/assets/achievement.png", INTRO_ACHIEVEMENT, INTRO_ARMORIAL_SIZES, true);
    expectLadderOf("/trades-house-media/assets/crest-sm.png", INTRO_ARMS, INTRO_ARMORIAL_SIZES, true);
  });

  it("names only crests that have display copies", () => {
    expect(() => railCrestSources("/images/venues/trades-hall-glasgow-crest.png")).toThrow(/No display copies/u);
    expect(() => medallionCrestSrc("/trades-house-media/assets/crests/../crest-sm.png")).toThrow(/No display copies/u);
  });
});
