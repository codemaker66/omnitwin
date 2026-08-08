// ---------------------------------------------------------------------------
// The sorting geometry gate.
//
// This is the promise the quiz makes: answer honestly and the Craft you get
// is the Craft you match. Three properties keep that true, and all three are
// easy to break with a single edited number — so they are asserted here
// rather than trusted.
//
//   1. Every one of the fourteen Crafts is genuinely reachable.
//   2. A "pure" respondent — someone who always picks the option nearest
//      their own values — is sorted to themselves.
//   3. Within any one scene, no two options push in near-enough the same
//      direction to make choosing between them meaningless.
//
// Previously this file enumerated all 4^9 answer paths against craft-weight
// scoring. Under the axis model that enumeration is both infeasible
// (4^12 = 16.7M paths x 14 cosines) and beside the point: what matters is
// direction, so the simulations below probe direction directly.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  AXIS_KEYS,
  CRAFT_AXIS_PROFILES,
  CRAFT_ORDER,
  CRAFT_QUESTIONS,
  ZERO_AXIS_TOTALS,
  applyCraftQuizAnswer,
  craftAffinity,
  rankCrafts,
  type AxisTotals,
  type AxisVector,
  type CraftId,
} from "../craft-quiz-model.js";

function toTotals(vector: AxisVector): AxisTotals {
  return {
    a1: vector.a1 ?? 0,
    a2: vector.a2 ?? 0,
    a3: vector.a3 ?? 0,
    a4: vector.a4 ?? 0,
    a5: vector.a5 ?? 0,
  };
}

function cosineBetween(left: AxisTotals, right: AxisTotals): number {
  const dot = AXIS_KEYS.reduce((sum, key) => sum + left[key] * right[key], 0);
  const scale = Math.hypot(...AXIS_KEYS.map((key) => left[key]))
    * Math.hypot(...AXIS_KEYS.map((key) => right[key]));
  return scale === 0 ? 0 : dot / scale;
}

/** Ranks the Crafts an option points at, best first. */
function optionPulls(vector: AxisVector): readonly CraftId[] {
  const totals = toTotals(vector);
  return [...CRAFT_ORDER]
    .map((craftId) => ({ craftId, affinity: craftAffinity(totals, craftId) }))
    .sort((left, right) => right.affinity - left.affinity)
    .map(({ craftId }) => craftId);
}

/** The Craft a respondent lands on if they always answer as themselves. */
function simulatePureRespondent(craftId: CraftId): readonly [CraftId, number] {
  const own = CRAFT_AXIS_PROFILES[craftId];
  let totals: AxisTotals = ZERO_AXIS_TOTALS;

  CRAFT_QUESTIONS.forEach((question, questionIndex) => {
    let bestIndex = 0;
    let bestAffinity = -Infinity;
    question.options.forEach((option, optionIndex) => {
      const affinity = cosineBetween(toTotals(option.axes), own);
      if (affinity > bestAffinity) {
        bestAffinity = affinity;
        bestIndex = optionIndex;
      }
    });
    totals = applyCraftQuizAnswer(totals, questionIndex, bestIndex).totals;
  });

  const [winner, runnerUp] = rankCrafts(totals);
  if (winner === undefined || runnerUp === undefined) throw new Error("ranking is empty");
  return [winner.craftId, winner.score - runnerUp.score];
}

describe("sorting geometry", () => {
  it("gives every Craft at least three options that genuinely point at it", () => {
    const pulls = new Map<CraftId, number>(CRAFT_ORDER.map((craftId) => [craftId, 0]));
    for (const question of CRAFT_QUESTIONS) {
      for (const option of question.options) {
        for (const craftId of optionPulls(option.axes).slice(0, 2)) {
          pulls.set(craftId, (pulls.get(craftId) ?? 0) + 1);
        }
      }
    }

    const starved = [...pulls.entries()].filter(([, count]) => count < 3);
    expect(starved, `these Crafts are unreachable: ${JSON.stringify(starved)}`).toEqual([]);
  });

  it("sorts every pure respondent to their own Craft", () => {
    const misSorted = CRAFT_ORDER
      .map((craftId) => ({ craftId, landed: simulatePureRespondent(craftId)[0] }))
      .filter(({ craftId, landed }) => craftId !== landed);

    expect(misSorted, `mis-sorted: ${JSON.stringify(misSorted)}`).toEqual([]);
  });

  it("wins each pure respondent by a real margin, not a rounding error", () => {
    for (const craftId of CRAFT_ORDER) {
      const [, margin] = simulatePureRespondent(craftId);
      expect(margin, `${craftId} wins by only ${margin.toFixed(4)}`).toBeGreaterThan(0.01);
    }
  });

  it("keeps the four options in every scene pointing different ways", () => {
    const collinear: string[] = [];
    CRAFT_QUESTIONS.forEach((question, questionIndex) => {
      question.options.forEach((left, leftIndex) => {
        question.options.slice(leftIndex + 1).forEach((right, offset) => {
          const cosine = cosineBetween(toTotals(left.axes), toTotals(right.axes));
          if (cosine > 0.7) {
            collinear.push(`Q${String(questionIndex + 1)} options ${String(leftIndex + 1)}/${String(leftIndex + offset + 2)} = ${cosine.toFixed(2)}`);
          }
        });
      });
    });

    expect(collinear).toEqual([]);
  });

  it("gives no option a null vector — every answer has to move the reader", () => {
    for (const question of CRAFT_QUESTIONS) {
      for (const option of question.options) {
        const axes: AxisVector = option.axes;
        const magnitude = Math.hypot(...AXIS_KEYS.map((key) => axes[key] ?? 0));
        expect(magnitude, `"${option.lead}" scores nothing`).toBeGreaterThan(0);
      }
    }
  });
});
