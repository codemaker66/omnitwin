// ---------------------------------------------------------------------------
// The spoken script — register and performance integrity.
//
// Every word here reaches the visitor twice: on screen, and in the Convener's
// mouth once the voice batch exists. Two standing rulings govern it, and both
// are easy to erode one edit at a time, so they are tests.
//
//   HOLLYWOOD SCOTS — obviously Scottish, understood cold by an American,
//   English or European reader with no glossary. Dense respellings (fower,
//   abune, naething, oot) are banned; rhythm and idiom carry the accent.
//
//   NO VERDICTS — the narrator never tells you what your answer says about
//   you. Four serious people answer these scenes four different ways; a
//   narrator who approved of one would hand players a map for gaming the sort.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CRAFT_QUESTIONS } from "../craft-quiz-model.js";
import {
  CONVENER_ACKNOWLEDGEMENTS,
  CONVENER_DELIBERATION,
  CONVENER_REACTIONS,
  convenerAcknowledgement,
  convenerReaction,
} from "../convener/convener-lines.js";

const SCENES = CRAFT_QUESTIONS.map((question) => ({
  where: question.title,
  text: question.scene,
}));

const OPTION_COPY = CRAFT_QUESTIONS.flatMap((question) =>
  question.options.map((option) => ({
    where: `${question.title} - ${option.lead}`,
    text: `${option.lead} ${option.body}`,
    cost: option.cost,
  })),
);

const ACK_COPY = CONVENER_ACKNOWLEDGEMENTS.map((text, index) => ({
  where: `acknowledgement ${String(index)}`,
  text,
}));

const REACTION_COPY = CONVENER_REACTIONS.flatMap((replies, questionIndex) =>
  replies.map((text, optionIndex) => ({
    where: `reaction ${String(questionIndex + 1)}.${String(optionIndex + 1)}`,
    text,
  })),
);

// The deliberation is the last thing he says before the verdict, which makes
// it the easiest place to leak one: a single craft noun here would turn the
// ceremony into the answer key.
const DELIBERATION_COPY = CONVENER_DELIBERATION.map((text, index) => ({
  where: `deliberation beat ${String(index + 1)}`,
  text,
}));

const ALL_SPOKEN = [
  ...SCENES,
  ...OPTION_COPY.map(({ where, text }) => ({ where, text })),
  ...ACK_COPY,
  ...REACTION_COPY,
  ...DELIBERATION_COPY,
];

/** Respellings the register ruling bans outright, with their plain forms. */
const BANNED_SPELLINGS: readonly (readonly [RegExp, string])[] = [
  [/\bfower\b/iu, "four"],
  [/\babune\b/iu, "above"],
  [/\bnaething\b/iu, "nothing"],
  [/\bnaebody\b/iu, "nobody"],
  [/\bmair\b/iu, "more"],
  [/\bsiller\b/iu, "money"],
  [/\bmercat\b/iu, "market"],
  [/\bbaith\b/iu, "both"],
  [/\bmooth\b/iu, "mouth"],
  [/\bwithoot\b|\bwi'out\b/iu, "without"],
  [/\bgaed\b/iu, "went"],
  [/\bthe morn\b/iu, "tomorrow"],
  // "greeting" for crying inverts its meaning for non-Scots readers.
  [/\bgreeting\b/iu, "crying"],
];

describe("the twelve scenes", () => {
  it("ships exactly twelve, each with four options", () => {
    expect(SCENES).toHaveLength(12);
    expect(OPTION_COPY).toHaveLength(48);
  });

  it("never repeats a scene or an option", () => {
    expect(new Set(SCENES.map(({ text }) => text)).size).toBe(12);
    expect(new Set(OPTION_COPY.map(({ text }) => text)).size).toBe(48);
    expect(new Set(CRAFT_QUESTIONS.map((question) => question.title)).size).toBe(12);
  });

  it("names a distinct price on every option — the cost is what keeps them equal", () => {
    for (const { where, cost } of OPTION_COPY) {
      expect(cost.trim().length, where).toBeGreaterThan(0);
    }
    expect(new Set(OPTION_COPY.map(({ cost }) => cost)).size).toBe(48);
  });

  it("keeps every scene short enough to hold a reader", () => {
    for (const { where, text } of SCENES) {
      // ~620 chars is about eleven seconds in his mouth at speaking pace.
      expect(text.length, `${where} runs long`).toBeLessThanOrEqual(620);
      expect(text.length, `${where} is too thin to be a scene`).toBeGreaterThan(180);
    }
  });

  it("finishes every sentence — he performs, he never trails off", () => {
    for (const { where, text } of [...SCENES, ...ACK_COPY]) {
      expect(/[.!?…”"]$/u.test(text.trim()), `${where}: "${text.slice(-40)}"`).toBe(true);
    }
  });
});

describe("Hollywood Scots register", () => {
  it("uses no banned respelling anywhere in the spoken corpus", () => {
    const offences: string[] = [];
    for (const { where, text } of ALL_SPOKEN) {
      for (const [pattern, plain] of BANNED_SPELLINGS) {
        if (pattern.test(text)) offences.push(`${where}: ${pattern.source} -> write "${plain}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("still sounds Scottish — the accent lives in the allowed words", () => {
    const allowed = /\b(aye|ye|yer|ken|auld|wee|nae|och|cannae|doesnae|isnae|didnae|wisnae|willnae|tae|wi')\b/iu;
    const flat = SCENES.filter(({ text }) => !allowed.test(text)).map(({ where }) => where);
    expect(flat, "these scenes read as standard English").toEqual([]);
  });

  it("shouts single words only — capitals are his emphasis, not his volume", () => {
    for (const { where, text } of ALL_SPOKEN) {
      const shouted = text.match(/\b[A-Z]{2,}\b/gu) ?? [];
      for (const word of shouted) {
        expect(word.length, `${where} shouts "${word}"`).toBeLessThanOrEqual(12);
      }
      expect(shouted.length, `${where} shouts ${String(shouted.length)} times`).toBeLessThanOrEqual(3);
    }
  });
});

describe("the Convener's reactions", () => {
  it("answers all forty-eight options, aligned to the scenes", () => {
    expect(CONVENER_REACTIONS).toHaveLength(CRAFT_QUESTIONS.length);
    CRAFT_QUESTIONS.forEach((question, index) => {
      expect(CONVENER_REACTIONS[index], `scene ${String(index + 1)}`)
        .toHaveLength(question.options.length);
    });
    expect(REACTION_COPY).toHaveLength(48);
  });

  it("never says the same thing twice", () => {
    expect(new Set(REACTION_COPY.map(({ text }) => text)).size).toBe(48);
  });

  it("keeps every reply short enough to be a reply, not a speech", () => {
    for (const { where, text } of REACTION_COPY) {
      expect(text.trim().length, `${where} is empty`).toBeGreaterThan(20);
      expect(text.length, `${where} runs long`).toBeLessThanOrEqual(200);
      expect(/[.!?…”"]$/u.test(text.trim()), where).toBe(true);
    }
  });

  // The load-bearing one. He may notice the choice and name its price; the
  // moment he grades it, he has published the answer key.
  it("reacts without ever grading the answer", () => {
    const verdict = /\b(good choice|right choice|wrong choice|well chosen|wisely|foolish|you should have|the correct|a mistake|bad call)\b/iu;
    const judging = REACTION_COPY.filter(({ text }) => verdict.test(text));
    expect(judging, "these reactions grade the answer").toEqual([]);
  });

  // Naming a Craft in a reaction would let a player reverse-engineer the sort.
  it("never names a Craft", () => {
    const crafts = /\b(hammermen|wrights|masons|coopers|tailors|weavers|dyers|bonnetmakers|skinners|cordiners|bakers|fleshers|maltmen|gardeners|barbers)\b/iu;
    const leaking = REACTION_COPY.filter(({ text }) => crafts.test(text));
    expect(leaking, "these reactions name the Craft they serve").toEqual([]);
  });

  it("looks up by scene and option, and survives a bad index", () => {
    expect(convenerReaction(0, 0)).toBe(CONVENER_REACTIONS[0]?.[0]);
    expect(convenerReaction(11, 3)).toBe(CONVENER_REACTIONS[11]?.[3]);
    expect(convenerReaction(99, 99).length).toBeGreaterThan(0);
    expect(convenerReaction(-1, -1).length).toBeGreaterThan(0);
  });
});

describe("the Convener's acknowledgements", () => {
  it("gives every scene its own line, so a run never hears a repeat", () => {
    expect(CONVENER_ACKNOWLEDGEMENTS.length).toBeGreaterThanOrEqual(CRAFT_QUESTIONS.length);
    expect(new Set(CONVENER_ACKNOWLEDGEMENTS).size).toBe(CONVENER_ACKNOWLEDGEMENTS.length);
    const used = CRAFT_QUESTIONS.map((_, index) => convenerAcknowledgement(index));
    expect(new Set(used).size).toBe(CRAFT_QUESTIONS.length);
  });

  // The load-bearing one: he must not grade the answer.
  it("passes no judgement on the choice", () => {
    const verdict = /\b(right choice|wrong|good choice|well chosen|wise|foolish|brave|coward|better|worse|should have|mistake)\b/iu;
    const judging = CONVENER_ACKNOWLEDGEMENTS.filter((line) => verdict.test(line));
    expect(judging, "these acknowledgements grade the answer").toEqual([]);
  });

  it("stays in range for any index, including a hostile one", () => {
    expect(convenerAcknowledgement(0)).toBe(CONVENER_ACKNOWLEDGEMENTS[0]);
    expect(convenerAcknowledgement(-5).length).toBeGreaterThan(0);
    expect(convenerAcknowledgement(9_999).length).toBeGreaterThan(0);
  });
});
