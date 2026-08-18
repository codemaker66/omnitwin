// Shared by the scene gate and the deliberation gate: one lexicon, one truth.
import type { CraftId } from "../craft-quiz-model.js";

/** How every home option must be recognisable to a reader who knows nothing
 *  of the Incorporations but can make the obvious guess. One hit is enough;
 *  the point is that there IS one, in the answer's own words. */
export const WORLD_LEXICON: Readonly<Record<CraftId, readonly RegExp[]>> = {
  hammermen: [/\biron\b/i, /\btongs\b/i, /\bfiles?\b/i, /\bpunch(?:es)?\b/i, /\bhammer\b/i, /\brust\b/i, /\bheat\b/i, /\bforge\b/i, /\bmetal\b/i],
  wrights: [/\bwood\b/i, /\btimber\b/i, /\bjoints?\b/i, /\bash\b/i, /\bgrain\b/i, /\bpegged\b/i, /\bhoused\b/i, /\bframing\b/i, /\bplane\b/i, /\bchisel/i],
  masons: [/\bstone\b/i, /\barch\b/i, /\bwalls?\b/i, /\bmortar\b/i, /\bcourses\b/i, /\blime\b/i],
  coopers: [/\bhold(?:s|ing)?\b/i, /\bheld\b/i, /\bhoop/i, /\bstave/i, /\bbarrel/i, /\bcask/i, /\bleaks?\b/i, /\bsealed\b/i],
  tailors: [/\bmeasures?\b/i, /\bcuts?\b/i, /\bpattern-book\b/i, /\bounce\b/i, /\bseam\b/i, /\bcloth\b/i, /\bmark\b/i, /\btested\b/i, /\blocked room\b/i, /\bshut room\b/i, /\belevenpence\b/i, /\bneedle\b/i, /\bfit\b/i],
  weavers: [/\bloom\b/i, /\bthread/i, /\bwarp\b/i, /\bweft\b/i, /\bpattern/i, /\bdrafts?\b/i, /\bthreading\b/i, /\bweave/i],
  dyers: [/\bcolour/i, /\bdye/i, /\bwool\b/i, /\bvats?\b/i],
  skinners: [/\bhide\b/i, /\bleather\b/i, /\bspoiled\b/i, /\bdiscard/i, /\bcharter\b/i, /\boldest\b/i, /\bcharity\b/i, /\bworth keeping\b/i],
  cordiners: [/\bboots?\b/i, /\bfeet\b/i, /\bshod\b/i, /\bshoes?\b/i, /\bwalk(?:ed|s)?\b/i, /\broad\b/i, /\bsoles?\b/i],
  bakers: [/\bflour\b/i, /\bbread\b/i, /\bloaf\b/i, /\bbake/i, /\boven\b/i, /\bdough\b/i, /\bhungry\b/i, /\bfeeds?\b/i],
  fleshers: [/\bknife\b/i, /\bmeat\b/i, /\bstomach\b/i, /\bblock\b/i, /\bblood\b/i],
  maltmen: [/\bbarley\b/i, /\bmalt/i, /\bale\b/i, /\bbeer\b/i, /\bjug\b/i, /\bbrew/i, /\bbroth\b/i, /\bcellar\b/i, /\bcheer\b/i],
  gardeners: [/\bseed/i, /\bwillow\b/i, /\bcuttings\b/i, /\bgrass\b/i, /\bpasture\b/i, /\blambs?\b/i, /\bgarden/i, /\bsoil\b/i, /\bplant/i, /\bcomes up\b/i],
  barbers: [/\brazor\b/i, /\bblade\b/i, /\bthroat\b/i, /\bfaces?\b/i, /\bshave/i, /\bvoice\b/i, /\bask\b/i, /\blisten\b/i],
};

/** The Incorporations by name, in every spelling the copy might reach for. */
export const CRAFT_NAMES = /\b(hammermen|wrights|masons|coopers|tailors|weavers|dyers|bonnetmakers|skinners|furriers|glovers|cordiners|bakers|baxters|fleshers|maltmen|gardeners|barbers)\b/i;

/** Longest sentence in a text, in words. The plainness gate caps this at thirty. */
export function longestSentenceWords(text: string): number {
  return Math.max(0, ...text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length));
}
