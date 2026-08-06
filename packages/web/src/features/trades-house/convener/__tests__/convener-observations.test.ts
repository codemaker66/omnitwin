// -----------------------------------------------------------------------------
// What he notices about you — and, more importantly, what he stays quiet about.
//
// The failure mode here is not a crash. It is a narrator who remarks on every
// single answer, which turns a character into a mechanic. Most of these tests
// therefore assert SILENCE.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  CONVENER_OBSERVATIONS,
  observePlay,
  type ObservationId,
  type PlayRecord,
} from "../convener-observations.js";

const NOTHING_SPENT: ReadonlySet<ObservationId> = new Set();

function play(over: Partial<PlayRecord> = {}): PlayRecord {
  return { answerMs: [], seats: [], skips: 0, priorRuns: 0, ...over };
}

describe("staying quiet", () => {
  it("says nothing about an ordinary answer", () => {
    expect(observePlay(play({ answerMs: [9_000], seats: [1] }), NOTHING_SPENT)).toBeNull();
  });

  it("says nothing across a whole ordinary playthrough", () => {
    // Twelve unremarkable answers at a human pace, no repeated seat run, no
    // skips, first visit. He should not utter one remark — the rarity IS the
    // feature, and a regression here would make him a nag.
    const seats = [0, 2, 1, 3, 2, 0, 3, 1, 2, 3, 0, 1];
    const spent = new Set<ObservationId>();
    const remarks: ObservationId[] = [];
    for (let i = 0; i < 12; i += 1) {
      const record = play({
        answerMs: Array.from({ length: i + 1 }, (_, k) => 9_000 + k * 400),
        seats: seats.slice(0, i + 1),
      });
      const noticed = observePlay(record, spent);
      if (noticed !== null) { spent.add(noticed.id); remarks.push(noticed.id); }
    }
    expect(remarks).toEqual([]);
  });

  it("never repeats an observation it has already made", () => {
    const record = play({ answerMs: [1_000, 1_000, 1_000], seats: [0, 1, 2] });
    expect(observePlay(record, NOTHING_SPENT)?.id).toBe("quick");
    expect(observePlay(record, new Set<ObservationId>(["quick"]))).toBeNull();
  });
});

describe("what he does notice", () => {
  it("greets a returning visitor, but only on their first answer", () => {
    expect(observePlay(play({ answerMs: [9_000], seats: [0], priorRuns: 1 }), NOTHING_SPENT)?.id)
      .toBe("returning");
    // Noticing on answer five would read as the page having only just checked.
    expect(observePlay(
      play({ answerMs: [9_000, 9_000, 9_000, 9_000, 9_000], seats: [0, 1, 2, 1, 0], priorRuns: 1 }),
      NOTHING_SPENT,
    )).toBeNull();
  });

  it("notices three quick answers in a row, not two", () => {
    expect(observePlay(play({ answerMs: [1_000, 1_000], seats: [0, 1] }), NOTHING_SPENT)).toBeNull();
    expect(observePlay(play({ answerMs: [1_000, 1_000, 1_000], seats: [0, 1, 2] }), NOTHING_SPENT)?.id)
      .toBe("quick");
  });

  it("does not count a streak broken by one considered answer", () => {
    expect(observePlay(play({ answerMs: [1_000, 20_000, 1_000], seats: [0, 1, 2] }), NOTHING_SPENT))
      .toBeNull();
  });

  it("notices a long pause on the answer it happened to", () => {
    expect(observePlay(play({ answerMs: [9_000, 40_000], seats: [0, 1] }), NOTHING_SPENT)?.id)
      .toBe("lingerer");
    // ...and not on the next one, which was ordinary.
    expect(observePlay(
      play({ answerMs: [9_000, 40_000, 9_000], seats: [0, 1, 2] }),
      new Set<ObservationId>(),
    )).toBeNull();
  });

  it("notices four of the same seat, not three", () => {
    expect(observePlay(play({ answerMs: [9e3, 9e3, 9e3], seats: [2, 2, 2] }), NOTHING_SPENT)).toBeNull();
    expect(observePlay(play({ answerMs: [9e3, 9e3, 9e3, 9e3], seats: [2, 2, 2, 2] }), NOTHING_SPENT)?.id)
      .toBe("sameSeat");
  });

  it("mentions being cut off only after the third time", () => {
    expect(observePlay(play({ answerMs: [9_000], seats: [0], skips: 2 }), NOTHING_SPENT)).toBeNull();
    expect(observePlay(play({ answerMs: [9_000], seats: [0], skips: 3 }), NOTHING_SPENT)?.id)
      .toBe("skipper");
  });

  it("stays quiet about a visitor who simply used all four seats — that is not rare", () => {
    // This WAS an observation. The ordinary-playthrough test proved it fired on
    // normal play, so it was cut rather than have him remark on nothing.
    expect(observePlay(play({ answerMs: [9e3, 9e3, 9e3, 9e3], seats: [0, 1, 2, 3] }), NOTHING_SPENT))
      .toBeNull();
  });

  it("makes at most ONE remark per answer, however much is true at once", () => {
    // Returning, cut off, and rushing, all on the first answer. Three lines at
    // once would be a malfunction, not a character.
    const noticed = observePlay(
      play({ answerMs: [900, 900, 900], seats: [1, 1, 1], skips: 5, priorRuns: 3 }),
      NOTHING_SPENT,
    );
    expect(noticed).not.toBeNull();
    expect(typeof noticed?.text).toBe("string");
  });
});

describe("the lines themselves", () => {
  it("exposes every line for the voice generator", () => {
    expect(CONVENER_OBSERVATIONS).toHaveLength(5);
    expect(new Set(CONVENER_OBSERVATIONS).size).toBe(5);
  });

  it("keeps the Hollywood Scots register — understandable outside Scotland", () => {
    const banned = [/\bnaebody\b/iu, /\bnaething\b/iu, /\bmair\b/iu, /\bbaith\b/iu, /\bfower\b/iu, /\bthe morn\b/iu];
    expect(CONVENER_OBSERVATIONS.filter((line) => banned.some((p) => p.test(line)))).toEqual([]);
  });

  it("never grades the answer — he may notice your manner, not judge your choice", () => {
    // A verdict here would turn a sorting into a test, and would tip the scale
    // the hidden axis model exists to protect.
    // Phrases, not bare words. "Dinnae mistake speed for certainty" is the verb
    // and passes no judgment at all, but a bare /mistake/ rejected it — the
    // pattern has to describe a verdict, not merely brush against one.
    const verdict = /\b(you(?:'re| are) (?:right|wrong)|wrong answer|bad answer|the correct|made a mistake|should have (?:picked|chosen|said))\b/iu;
    expect(CONVENER_OBSERVATIONS.filter((line) => verdict.test(line))).toEqual([]);
  });

  it("names no Craft — the sorting must never be guessable from his asides", () => {
    const crafts = /\b(hammermen|wrights|masons|coopers|tailors|weavers|dyers|skinners|cordiners|bakers|fleshers|maltmen|gardeners|barbers)\b/iu;
    expect(CONVENER_OBSERVATIONS.filter((line) => crafts.test(line))).toEqual([]);
  });
});
