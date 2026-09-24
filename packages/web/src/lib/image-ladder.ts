// ---------------------------------------------------------------------------
// Display-sized copies of a public image, written by
// scripts/build-image-ladders.mjs as `${base}-${width}.webp`. Pair `srcSet`
// with a `sizes` hint no smaller than the box the page draws the image in;
// the browser then fetches the narrowest copy that is sharp at that size and
// the screen's pixel ratio. `src` is the widest copy, for anything that
// ignores srcset.
// ---------------------------------------------------------------------------

export interface LadderSources {
  readonly src: string;
  readonly srcSet: string;
}

export function ladderSources(base: string, widths: readonly number[]): LadderSources {
  const widest = widths.at(-1);
  if (widest === undefined) throw new Error(`The ladder for ${base} has no widths.`);
  return {
    src: `${base}-${String(widest)}.webp`,
    srcSet: widths.map((width) => `${base}-${String(width)}.webp ${String(width)}w`).join(", "),
  };
}
