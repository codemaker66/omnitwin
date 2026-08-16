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
  ZERO_CRAFT_QUIZ_PROGRESS,
  applyCraftQuizAnswer,
  craftAffinity,
  rankCrafts,
  type AxisTotals,
  type AxisVector,
  type CraftId,
  type CraftQuizProgress,
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
  let progress: CraftQuizProgress = ZERO_CRAFT_QUIZ_PROGRESS;

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
    progress = applyCraftQuizAnswer(progress, questionIndex, bestIndex);
  });

  const [winner, runnerUp] = rankCrafts(progress);
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

// ---------------------------------------------------------------------------
// Fairness, and the two invariants of the world channel.
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the fairness gate is the same bar on every machine. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** How every home option must be recognisable to a reader who knows nothing
 *  of the Incorporations but can make the obvious guess. One hit is enough;
 *  the point is that there IS one, in the answer's own words. */
const WORLD_LEXICON: Readonly<Record<CraftId, readonly RegExp[]>> = {
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

describe("the world channel — every answer legibly lives in a Craft's world", () => {
  it("never points a home answer away from its own Craft — the two channels may not contradict", () => {
    const disagreements: string[] = [];
    CRAFT_QUESTIONS.forEach((question, qi) => {
      question.options.forEach((option, oi) => {
        const agreement = cosineBetween(toTotals(option.axes), CRAFT_AXIS_PROFILES[option.world]);
        if (agreement < 0.55) {
          disagreements.push(`Q${String(qi + 1)}.${String(oi + 1)} "${option.lead}" vs ${option.world} = ${agreement.toFixed(2)}`);
        }
      });
    });
    expect(disagreements).toEqual([]);
  });

  it("puts at least one word of the Craft's own world in every home answer — a lay reader can make the guess", () => {
    const mute: string[] = [];
    CRAFT_QUESTIONS.forEach((question, qi) => {
      question.options.forEach((option, oi) => {
        const text = `${option.lead} ${option.body}`;
        if (!WORLD_LEXICON[option.world].some((pattern) => pattern.test(text))) {
          mute.push(`Q${String(qi + 1)}.${String(oi + 1)} "${option.lead}" says nothing of the ${option.world}`);
        }
      });
    });
    expect(mute).toEqual([]);
  });

  it("names no Craft in any answer — the world may be shown, the name never", () => {
    const names = /\b(hammermen|wrights|masons|coopers|tailors|weavers|dyers|bonnetmakers|skinners|furriers|cordiners|bakers|fleshers|maltmen|gardeners|barbers)\b/i;
    const leaks: string[] = [];
    CRAFT_QUESTIONS.forEach((question, qi) => {
      if (names.test(question.scene)) leaks.push(`Q${String(qi + 1)} scene`);
      question.options.forEach((option, oi) => {
        if (names.test(`${option.lead} ${option.body} ${option.cost}`)) leaks.push(`Q${String(qi + 1)}.${String(oi + 1)}`);
      });
    });
    expect(leaks).toEqual([]);
  });
});

describe("fairness — the instrument itself favours no Craft", () => {
  // Uniform random answers are the population that isolates the INSTRUMENT
  // from the people: whatever share a Craft takes here it takes because of how
  // the questions and directions are built, not because of who turned up.
  // Uniform would be 7.1% each. The band is deliberately wide enough to be
  // achievable and narrow enough that a hub or a starved corner fails it.
  it("keeps every Craft between 4% and 11% of uniformly random respondents", () => {
    const random = lcg(20260816);
    const trials = 20000;
    const tally = new Map<CraftId, number>(CRAFT_ORDER.map((craftId) => [craftId, 0]));
    for (let trial = 0; trial < trials; trial += 1) {
      let progress: CraftQuizProgress = ZERO_CRAFT_QUIZ_PROGRESS;
      for (let questionIndex = 0; questionIndex < CRAFT_QUESTIONS.length; questionIndex += 1) {
        progress = applyCraftQuizAnswer(progress, questionIndex, Math.floor(random() * 4));
      }
      const [winner] = rankCrafts(progress);
      if (winner !== undefined) tally.set(winner.craftId, (tally.get(winner.craftId) ?? 0) + 1);
    }
    const shares = [...tally.entries()].map(([craftId, count]) => [craftId, count / trials] as const);
    const outside = shares.filter(([, share]) => share < 0.04 || share > 0.11)
      .map(([craftId, share]) => `${craftId} ${(share * 100).toFixed(1)}%`);
    expect(outside, `outside the 4–11% band: ${outside.join(", ")}`).toEqual([]);
  });
});
