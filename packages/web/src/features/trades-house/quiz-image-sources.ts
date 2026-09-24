import { ladderSources, type LadderSources } from "../../lib/image-ladder.js";

// ---------------------------------------------------------------------------
// The craft quiz's crests and armorial as display-sized WebP copies of the
// supplied PNGs (scripts/build-image-ladders.mjs; hashes and measured error in
// each ladder's provenance.json). The PNGs remain the files of record, and the
// printable leaflet still uses them, but the quiz drew 220 KB crests at 56 CSS
// px and 1–1.5 MB armorials at 216.
// ---------------------------------------------------------------------------

const ASSETS = "/trades-house-media/assets";

/** The widest box the intro rails draw a crest in, measured across viewports. */
export const RAIL_CREST_SIZES = "56px";
// 1x, 2x and 3x of that box, then the crests' own 320 px for denser screens.
const RAIL_CREST_WIDTHS = [56, 112, 168, 320] as const;
// The result medallion draws a crest at up to 192 CSS px (48% of its largest,
// 400 px medallion): every pixel of the source is needed from 2x screens up.
const CREST_SOURCE_WIDTH = 320;

function crestLadder(crest: string): string {
  const name = /^\/trades-house-media\/assets\/crests\/([a-z-]+)\.png$/u.exec(crest)?.[1];
  if (name === undefined) throw new Error(`No display copies exist for the crest ${crest}.`);
  return `${ASSETS}/crests/ladder/${name}`;
}

/** A crest in the intro rails (pair with RAIL_CREST_SIZES). */
export function railCrestSources(crest: string): LadderSources {
  return ladderSources(crestLadder(crest), RAIL_CREST_WIDTHS);
}

/** A crest in the result medallion: the full-resolution copy. */
export function medallionCrestSrc(crest: string): string {
  return `${crestLadder(crest)}-${String(CREST_SOURCE_WIDTH)}.webp`;
}

/** The widest box the intro draws its armorial in (both variants), in CSS px. */
export const INTRO_ARMORIAL_SIZES = "216px";
/** Below 1180 px wide: the achievement, the arms with the building above them. */
export const INTRO_ACHIEVEMENT: LadderSources = ladderSources(`${ASSETS}/ladder/achievement`, [216, 432, 648]);
/** From 1180 px wide: the arms alone. */
export const INTRO_ARMS: LadderSources = ladderSources(`${ASSETS}/ladder/crest-sm`, [216, 432, 648]);
