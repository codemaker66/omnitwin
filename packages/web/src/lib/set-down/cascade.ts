// ---------------------------------------------------------------------------
// Which pieces of a Lay out are heard, when, and how loud (T-700).
//
// A layout lands as a ripple: a set's table first, then its chairs round it,
// the sets farther from the middle later (landingDelays). Voicing every piece
// would be a roar and past the eight-voice budget, so a cascade picks eight:
// one piece of each table family, then chairs spread across the layout, so the
// sound sweeps the room. Each is at least 85-110 ms after the one before and
// 1 dB softer. This is the listening page's cascade as Blake approved it by
// ear on 14 Nov (ruling R75); a voice is never scheduled before its own piece
// lands (R27).
// ---------------------------------------------------------------------------

import { seededRandom } from "../planner-sound-render.js";
import type { BodyFamily } from "./bodies.js";

/** The most voices a cascade plays (the eight-voice budget). */
export const CASCADE_VOICES = 8;
/** The least gap between one voice and the next. */
export const CASCADE_GAP_S = 0.085;
/** Up to this much more, drawn from the play's seed, so the cascade is not a metronome. */
export const CASCADE_GAP_SPREAD_S = 0.025;
/** Each voice is this much softer than the one before. */
export const CASCADE_STEP_DB = -1;

/** A piece of a batch that lands together. */
export interface CascadePiece {
  readonly id: string;
  readonly family: BodyFamily;
  /** When it reaches its support, after the batch's first piece starts down. */
  readonly landsAfterSeconds: number;
}

/** A piece the cascade voices: when after the batch's first landing, and at what level. */
export interface CascadeVoice {
  readonly id: string;
  readonly offsetSeconds: number;
  readonly levelDb: number;
}

/** From this many pieces a batch is a cascade; fewer are each voiced at their own landing. */
const CASCADE_FROM = 4;

function landsAt(piece: CascadePiece): number {
  return Number.isFinite(piece.landsAfterSeconds) ? piece.landsAfterSeconds : 0;
}

/** In order of landing; pieces landing together keep their order (Array.prototype.sort is stable). */
function byLanding(pieces: readonly CascadePiece[]): readonly CascadePiece[] {
  return [...pieces].sort((a, b) => landsAt(a) - landsAt(b));
}

/**
 * The listening page's selection: the first piece of each family other than
 * chairs, in the batch's order, then chairs spread evenly across the batch,
 * up to eight in all.
 */
function cascadeSelection(pieces: readonly CascadePiece[]): readonly CascadePiece[] {
  const tables: CascadePiece[] = [];
  const chairs: CascadePiece[] = [];
  const families = new Set<BodyFamily>();
  for (const piece of pieces) {
    if (piece.family === "chair") chairs.push(piece);
    else if (!families.has(piece.family)) {
      families.add(piece.family);
      tables.push(piece);
    }
  }
  const picked = tables.slice(0, CASCADE_VOICES);
  const count = Math.min(CASCADE_VOICES - picked.length, chairs.length);
  for (let k = 0; k < count; k += 1) {
    const chair = chairs[Math.floor(((k + 0.5) * chairs.length) / count)];
    if (chair !== undefined) picked.push(chair);
  }
  return picked;
}

/**
 * The voices of a batch that lands together.
 *
 * One to three pieces each play at their own landing. Four or more take the
 * page's selection, in order of landing, the first at its own landing and
 * each later one at its own landing or 85-110 ms after the one before,
 * whichever is later; `seededRandom(seed)` is drawn once for each voice after
 * the first, as the page draws it. Each voice is 1 dB softer than the one
 * before. With every landing at 0, as on the listening page, this is the
 * page's cascade to the bit.
 */
export function planCascade(pieces: readonly CascadePiece[], seed: number): readonly CascadeVoice[] {
  if (pieces.length < CASCADE_FROM) {
    return byLanding(pieces).map((piece, index) => ({ id: piece.id, offsetSeconds: landsAt(piece), levelDb: CASCADE_STEP_DB * index }));
  }
  const random = seededRandom(seed);
  let offset = 0;
  return byLanding(cascadeSelection(pieces)).map((piece, index) => {
    offset = index === 0 ? landsAt(piece) : Math.max(landsAt(piece), offset + (CASCADE_GAP_S + CASCADE_GAP_SPREAD_S * random()));
    return { id: piece.id, offsetSeconds: offset, levelDb: CASCADE_STEP_DB * index };
  });
}
