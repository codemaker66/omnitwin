// -----------------------------------------------------------------------------
// The town remembers — mostly tests of restraint, as with the observations. A
// memory that fires every scene is a mechanic; the magic is that it is rare,
// deep, and true whatever you just chose.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CRAFT_QUESTIONS, type CraftId } from "../../craft-quiz-model.js";
import { CONVENER_MEMORIES, CONVENER_MEMORY_LINES, MEMORIES_PER_RUN, recallAt } from "../convener-memories.js";
import { CRAFT_NAMES, longestSentenceWords } from "../../__tests__/world-lexicon.js";

const NONE: ReadonlySet<string> = new Set();

describe("what he recalls", () => {
  it("recalls only what actually happened — a memory needs its earlier world", () => {
    // Carried the iron in scene 1: at the fire (scene 11) he recalls it.
    const iron: CraftId[] = ["hammermen", "fleshers", "wrights", "bakers", "masons", "coopers", "bakers", "hammermen", "wrights", "weavers", "hammermen"];
    expect(recallAt(10, iron, NONE)?.text).toMatch(/iron/i);
    // Carried the cuttings instead: no iron to recall.
    const cuttings: CraftId[] = ["gardeners", ...iron.slice(1)];
    expect(recallAt(10, cuttings, NONE)?.text ?? "").not.toMatch(/iron/i);
  });

  it("recalls nothing on most scenes for most people", () => {
    const worlds: CraftId[] = ["weavers", "wrights", "gardeners", "dyers", "hammermen", "dyers", "tailors"];
    expect(recallAt(2, worlds, NONE)).toBeNull();
    expect(recallAt(3, worlds, NONE)).toBeNull();
    expect(recallAt(5, worlds, NONE)).toBeNull();
  });

  it("stops after three in a run, and never repeats one", () => {
    const spoken = new Set<string>(["a", "b", "c"]);
    const iron: CraftId[] = new Array<CraftId>(11).fill("hammermen");
    expect(recallAt(10, iron, spoken)).toBeNull();
    const once = recallAt(10, iron, NONE);
    expect(once).not.toBeNull();
    expect(recallAt(10, iron, new Set([once?.text ?? ""]))).toBeNull();
    expect(MEMORIES_PER_RUN).toBe(3);
  });

  it("prefers the oldest applicable memory — a deep memory is the magic", () => {
    // At the wall (scene 12) both a scene-1 memory (the boots) and a scene-9
    // memory (would have left) apply. He remembers the boots.
    const worlds: CraftId[] = ["cordiners", "fleshers", "wrights", "bakers", "masons", "coopers", "bakers", "hammermen", "cordiners", "weavers", "hammermen", "tailors"];
    expect(recallAt(11, worlds, NONE)?.earlier.scene).toBe(0);
  });
});

describe("the memories themselves", () => {
  it("only recall the past at a later scene, and only scenes that exist", () => {
    for (const memory of CONVENER_MEMORIES) {
      expect(memory.at, memory.text).toBeGreaterThan(memory.earlier.scene);
      expect(memory.at).toBeLessThan(CRAFT_QUESTIONS.length);
      expect(memory.earlier.scene).toBeGreaterThanOrEqual(0);
    }
  });

  it("key on a world that scene actually offers — a memory of a choice nobody could make is a bug", () => {
    const orphans = CONVENER_MEMORIES.filter((memory) => {
      const scene = CRAFT_QUESTIONS[memory.earlier.scene];
      return scene === undefined || !scene.options.some((option) => option.world === memory.earlier.world);
    });
    expect(orphans.map((m) => m.text)).toEqual([]);
  });

  it("never predict or grade the present answer — they may recall, never judge", () => {
    const forbidden = /\b(you will (?:choose|pick|take|reach|go)|you were (?:always going to|right|wrong)|the right (?:choice|answer)|the wrong (?:choice|answer))\b/i;
    expect(CONVENER_MEMORY_LINES.filter((line) => forbidden.test(line))).toEqual([]);
  });

  it("name no Craft, stay plain, and are all distinct", () => {
    expect(CONVENER_MEMORY_LINES.filter((line) => CRAFT_NAMES.test(line))).toEqual([]);
    expect(CONVENER_MEMORY_LINES.filter((line) => longestSentenceWords(line) > 30)).toEqual([]);
    expect(new Set(CONVENER_MEMORY_LINES).size).toBe(CONVENER_MEMORY_LINES.length);
    expect(CONVENER_MEMORY_LINES.length).toBeGreaterThanOrEqual(20);
  });
});
