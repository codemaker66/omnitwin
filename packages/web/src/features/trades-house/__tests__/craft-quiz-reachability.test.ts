import { describe, expect, it } from "vitest";
import {
  CRAFT_ORDER,
  CRAFT_QUESTIONS,
  applyCraftQuizAnswer,
  rankCrafts,
  type CraftId,
  type CraftQuizQuestion,
  type CraftScores,
  type CraftWeights,
} from "../craft-quiz-model.js";

// `CRAFT_QUESTIONS` is declared `as const`, so each option's `weights` narrows to
// the exact literal keys it happens to carry and cannot be indexed by an arbitrary
// CraftId. The production helpers read it through the declared interface; this
// widened view lets the diagnostics below do the same.
const QUESTIONS: readonly CraftQuizQuestion[] = CRAFT_QUESTIONS;

type WinTally = Readonly<Record<CraftId, number>>;

interface PathCensus {
  readonly wins: WinTally;
  readonly paths: number;
}

/**
 * Walks every distinct answer path through the real quiz functions and tallies
 * which Craft each path awards. Nine questions of four options is 262,144 paths,
 * which is small enough to enumerate exhaustively rather than sample.
 */
function censusOfEveryAnswerPath(): PathCensus {
  const wins = new Map<CraftId, number>(CRAFT_ORDER.map((craftId) => [craftId, 0]));
  let paths = 0;

  function walk(questionIndex: number, scores: Readonly<CraftScores>, lastWeights: CraftWeights): void {
    if (questionIndex === CRAFT_QUESTIONS.length) {
      const [winner] = rankCrafts(scores, lastWeights);
      if (winner === undefined) throw new Error("Every completed path must rank a Craft.");
      wins.set(winner.craftId, (wins.get(winner.craftId) ?? 0) + 1);
      paths += 1;
      return;
    }

    const question = CRAFT_QUESTIONS[questionIndex];
    if (question === undefined) throw new RangeError(`Question ${String(questionIndex)} is unavailable.`);

    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
      const answer = applyCraftQuizAnswer(scores, questionIndex, optionIndex);
      walk(questionIndex + 1, answer.scores, answer.lastWeights);
    }
  }

  walk(0, {}, {});

  return { wins: Object.fromEntries(wins) as WinTally, paths };
}

let census: PathCensus | null = null;

function pathCensus(): PathCensus {
  census ??= censusOfEveryAnswerPath();
  return census;
}

/**
 * A Craft's "signature" answers are the options that weight it strictly higher
 * than every rival Craft. A Craft with no signature answer can only ever draw
 * level with a rival it shares options with, so it depends entirely on the
 * tie-break to surface — which is what starves it.
 */
function craftsWithoutASignatureAnswer(): readonly CraftId[] {
  return CRAFT_ORDER.filter((craftId) =>
    QUESTIONS.every((question) =>
      question.options.every((option) => {
        const weight = option.weights[craftId] ?? 0;
        if (weight === 0) return true;
        return CRAFT_ORDER.some((rival) => rival !== craftId && (option.weights[rival] ?? 0) >= weight);
      }),
    ),
  );
}

describe("craft quiz reachability", () => {
  it("enumerates every distinct answer path exactly once", () => {
    const { paths } = pathCensus();

    expect(paths).toBe(4 ** CRAFT_QUESTIONS.length);
  });

  it("can award every one of the fourteen Crafts", () => {
    const { wins } = pathCensus();
    const unreachable = CRAFT_ORDER.filter((craftId) => wins[craftId] === 0);

    expect(unreachable).toEqual([]);
  });

  // The three tests below characterise a KNOWN IMBALANCE in the supplied
  // weights rather than blessing it. `docs/operations/trades-house-leaflet-source-2026-07-10.md`
  // records the weights as client-supplied content, so they are pinned here
  // instead of silently retuned: any edit to CRAFT_QUESTIONS fails these and
  // must be re-blessed deliberately.

  it("records the two Crafts that no answer points to most strongly", () => {
    expect(craftsWithoutASignatureAnswer()).toEqual(["coopers", "skinners"]);
  });

  it("records that the starved Crafts are the least reachable ones", () => {
    const { wins, paths } = pathCensus();
    const share = (craftId: CraftId): number => wins[craftId] / paths;
    const leastReachable = [...CRAFT_ORDER].sort((left, right) => wins[left] - wins[right]).slice(0, 2);

    expect(leastReachable).toEqual(["coopers", "skinners"]);
    expect(share("coopers")).toBeLessThan(0.001);
    expect(share("skinners")).toBeLessThan(0.02);
  });

  it("records how far the spread runs from an even fourteen-way split", () => {
    const { wins } = pathCensus();
    const counts = CRAFT_ORDER.map((craftId) => wins[craftId]);
    const most = Math.max(...counts);
    const least = Math.min(...counts);

    expect({ most, least }).toEqual({ most: 55265, least: 168 });
    expect(Math.round(most / least)).toBe(329);
  });
});
