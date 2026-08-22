// -----------------------------------------------------------------------------
// The town remembers.
//
// The design lesson from Reigns is not the swipe: it is that once a few cards
// visibly remember what you did earlier, EVERY card feels authored. So he
// occasionally recalls an earlier choice at a later scene — the iron you carried
// in through the water gate was in the room that burned; you came in on your
// feet through the gate nobody watched, and now you are asked to keep it.
//
// Rules, learned from the observations and kept here:
//   at most one memory per scene, three per run, each spoken once;
//   spoken AFTER his reply, so every line must be true whatever was just chosen
//   — it may recall the past and name the present situation, never predict or
//   grade the present answer;
//   the oldest applicable memory wins, because a deep memory is the magic.
//
// Keyed on the WORLD of the earlier answer, not its index, so a rewrite of an
// option's words that keeps its world keeps its memory.
// -----------------------------------------------------------------------------

import type { CraftId } from "../craft-quiz-model.js";

export interface Memory {
  /** The earlier scene (0-based) and the world of the answer given there. */
  readonly earlier: { readonly scene: number; readonly world: CraftId };
  /** The scene (0-based) at which he recalls it. */
  readonly at: number;
  readonly text: string;
}

export const MEMORIES_PER_RUN = 3;

export const CONVENER_MEMORIES: readonly Memory[] = [
  // ---- what you carried in (scene 1) --------------------------------------
  { earlier: { scene: 0, world: "hammermen" }, at: 10,
    text: "The iron you carried four hundred miles was in that room." },
  { earlier: { scene: 0, world: "hammermen" }, at: 4,
    text: "You came in with iron in the bag. I have watched how you look at a poor joint." },
  { earlier: { scene: 0, world: "gardeners" }, at: 6,
    text: "The cuttings you carried in are in the ground now, and some of them have taken." },
  { earlier: { scene: 0, world: "gardeners" }, at: 9,
    text: "You kept willow slips alive for four hundred miles. You know what it is to wait on a green thing." },
  { earlier: { scene: 0, world: "tailors" }, at: 6,
    text: "You carried a book of measures in over bread. I have not forgotten it." },
  { earlier: { scene: 0, world: "tailors" }, at: 11,
    text: "The book you carried in: half the men in it are dead, and the measures are still good." },
  { earlier: { scene: 0, world: "cordiners" }, at: 8,
    text: "You came in on your feet, through the gate nobody was watching. You know the way out." },
  { earlier: { scene: 0, world: "cordiners" }, at: 11,
    text: "You came in through the gate nobody watched, on your own two feet. Now they have handed you the gate." },

  // ---- the low river (scene 2) ---------------------------------------------
  { earlier: { scene: 1, world: "fleshers" }, at: 7,
    text: "You went into the river before you knew the bottom. This is a door." },
  { earlier: { scene: 1, world: "fleshers" }, at: 10,
    text: "You went into the river first. The fire will not wait as long." },
  { earlier: { scene: 1, world: "wrights" }, at: 7,
    text: "You went for the ash pole and lost nothing but time. It is the same choice again, in a smaller room." },
  { earlier: { scene: 1, world: "barbers" }, at: 8,
    text: "You woke the whole bank once. This town has kept quiet for sixty years." },
  { earlier: { scene: 1, world: "weavers" }, at: 5,
    text: "You walked the gravel because you could see it. You cannot see the bottom of this one either." },

  // ---- the fence (scene 3) --------------------------------------------------
  { earlier: { scene: 2, world: "wrights" }, at: 8,
    text: "Their fence is yours now, since you mended it better than they asked. This is a bigger fence." },
  { earlier: { scene: 2, world: "weavers" }, at: 7,
    text: "You asked the oldest woman what the fence was for. Nobody here can tell you what is behind that door." },
  { earlier: { scene: 2, world: "coopers" }, at: 7,
    text: "You mended a fence to hold what you could not name. It is the same door." },

  // ---- the naming (scene 4) ------------------------------------------------
  { earlier: { scene: 3, world: "coopers" }, at: 11,
    text: "You kept your own name at the well. There is a bench with it on now." },
  { earlier: { scene: 3, world: "dyers" }, at: 11,
    text: "You took a name you had not earned yet. A year on, you are nearer it." },
  { earlier: { scene: 3, world: "bakers" }, at: 9,
    text: "You let them call you by the work. This child wants the work." },
  { earlier: { scene: 3, world: "maltmen" }, at: 9,
    text: "You let the town choose your name. Now a child is waiting to be told what to call the work." },

  // ---- the ring (scene 6) ---------------------------------------------------
  { earlier: { scene: 5, world: "coopers" }, at: 11,
    text: "You counted the old man's stock true when nobody would have known. Nobody will know how you vote, either." },

  // ---- the thin winter (scene 7) -------------------------------------------
  { earlier: { scene: 6, world: "gardeners" }, at: 10,
    text: "You kept the seed back through the thin winter. You know what four sacks are." },
  { earlier: { scene: 6, world: "bakers" }, at: 10,
    text: "You put yours into the pot first, in the thin winter. Four sacks were in that room tonight." },

  // ---- what the town is built on (scene 9) ---------------------------------
  { earlier: { scene: 8, world: "cordiners" }, at: 11,
    text: "You would have walked out over the leat. And still you are here, asked to keep the gate." },
  { earlier: { scene: 8, world: "tailors" }, at: 11,
    text: "You made them look at one another over the leat. Now they have put you on the body that decides." },
];

/**
 * The one memory worth speaking at `scene`, given the worlds of the answers so
 * far (index = scene), or null — the common case. `spoken` carries the texts
 * already used this run. The OLDEST applicable memory wins.
 */
export function recallAt(
  scene: number,
  worldsSoFar: readonly CraftId[],
  spoken: ReadonlySet<string>,
): Memory | null {
  if (spoken.size >= MEMORIES_PER_RUN) return null;
  const candidates = CONVENER_MEMORIES.filter(
    (memory) =>
      memory.at === scene
      && !spoken.has(memory.text)
      && worldsSoFar[memory.earlier.scene] === memory.earlier.world,
  );
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left.earlier.scene - right.earlier.scene);
  return candidates[0] ?? null;
}

/** Every line he can recall — the corpus the voice generator reads. */
export const CONVENER_MEMORY_LINES: readonly string[] = CONVENER_MEMORIES.map((memory) => memory.text);
