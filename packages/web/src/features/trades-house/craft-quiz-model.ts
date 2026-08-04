export const CRAFT_ORDER = [
  "hammermen",
  "wrights",
  "masons",
  "coopers",
  "tailors",
  "weavers",
  "dyers",
  "skinners",
  "cordiners",
  "bakers",
  "fleshers",
  "maltmen",
  "gardeners",
  "barbers",
] as const;

export type CraftId = (typeof CRAFT_ORDER)[number];

export interface CraftProfile {
  readonly name: string;
  readonly crest: string;
  readonly essence: string;
  readonly archetype: string;
  readonly omen: string;
  readonly motto: string;
  readonly reveal: string;
}

export type CraftScores = Partial<Record<CraftId, number>>;
export type CraftWeights = Readonly<Partial<Record<CraftId, number>>>;

export interface CraftQuizOption {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly weights: CraftWeights;
}

export interface CraftQuizQuestion {
  readonly prompt: string;
  readonly options: readonly CraftQuizOption[];
}

export interface CraftQuizAnswerResult {
  readonly scores: CraftScores;
  readonly lastWeights: CraftWeights;
}

export interface CraftRankingEntry {
  readonly craftId: CraftId;
  readonly score: number;
  readonly lastAnswerWeight: number;
  readonly profile: CraftProfile;
}

const MEDIA_ROOT = "/trades-house-media/assets";

export const CRAFT_PROFILES = {
  hammermen: {
    name: "THE HAMMERMEN",
    crest: `${MEDIA_ROOT}/crests/hammermen.png`,
    essence:
      "Strength of hand, integrity of work. Workers of iron and silver — the smiths, engineers and makers whose hammers built the city’s strength.",
    archetype: "The Forge-Mind",
    omen: "ringing metal",
    motto: "MAKE IT WORK. MAKE IT WORTHY. MAKE IT LAST.",
    reveal:
      "The Chain heard the hammer in you — drawn to stubborn problems and the moment force becomes intelligence. Inventive, practical and quietly brave, you want to leave things stronger than you found them. Your challenge is impatience: not everything yields to pressure.",
  },
  wrights: {
    name: "THE WRIGHTS",
    crest: `${MEDIA_ROOT}/crests/wrights.png`,
    essence:
      "Masters of wood — carpenters and joiners who raised Glasgow’s roofs, ships and stages.",
    archetype: "The Shaper",
    omen: "fresh wood shavings",
    motto: "GIVE GOOD IDEAS A BODY.",
    reveal:
      "You are a maker of forms — spaces, objects, plans — useful, but never without warmth. Versatile, constructive and welcoming, you give ideas a body. Your challenge is restlessness: finish the first thing before shaping the next.",
  },
  masons: {
    name: "THE MASONS",
    crest: `${MEDIA_ROOT}/crests/masons.png`,
    essence:
      "Workers of stone — patient builders of the grand and lasting fabric of Glasgow.",
    archetype: "The Foundation-Builder",
    omen: "hewn stone",
    motto: "BUILD FOR THOSE NOT YET HERE.",
    reveal:
      "The Chain grew heavy with stone: you think beyond the moment and build what can bear weight after you are gone. Structured, patient and public-spirited, you plan for people you will never meet. Your challenge is rigidity — even good plans must sometimes move.",
  },
  coopers: {
    name: "THE COOPERS",
    crest: `${MEDIA_ROOT}/crests/coopers.png`,
    essence:
      "Benders of oak and binders of barrels — exact, honest work that holds good things safe.",
    archetype: "The Holder of Pressure",
    omen: "sealed oak",
    motto: "HOLD FAST. LET NOTHING PRECIOUS LEAK AWAY.",
    reveal:
      "You understand pressure — the seal, the join, the discipline to hold precious things safe. Dependable, organised and discreet, you are trusted with what matters most. Your challenge is control: some things need slack, not tightening.",
  },
  tailors: {
    name: "THE TAILORS",
    crest: `${MEDIA_ROOT}/crests/tailors.png`,
    essence:
      "Cutters of cloth — dressing the city with precision, style and a perfect fit.",
    archetype: "The Fitter of Forms",
    omen: "fine stitches",
    motto: "NOTHING CARELESS. NOTHING ILL-FITTING.",
    reveal:
      "The Chain noticed your eye before your words: you see the crooked seam, the idea that almost fits. You bring poise, proportion and refinement to people and plans alike. Your challenge is perfectionism — some things must breathe before they are finished.",
  },
  weavers: {
    name: "THE WEAVERS",
    crest: `${MEDIA_ROOT}/crests/weavers.png`,
    essence:
      "Keepers of the loom — pattern, patience and thread woven into Glasgow’s story.",
    archetype: "The Pattern-Keeper",
    omen: "threads drawn tight",
    motto: "FIND THE PATTERN. STRENGTHEN THE WHOLE.",
    reveal:
      "You notice the connections others miss — a community, like cloth, is many strands held in tension. Subtle, loyal and patient, you strengthen the whole. Your challenge is over-entanglement: not every loose thread is yours to carry.",
  },
  dyers: {
    name: "THE BONNETMAKERS & DYERS",
    crest: `${MEDIA_ROOT}/crests/dyers.png`,
    essence:
      "Bringers of colour and finish — flair, craft and the crowning touch.",
    archetype: "The Colour-Bringer",
    omen: "bold dye",
    motto: "SHOW THE TRUE COLOUR.",
    reveal:
      "The Chain flashed with dye and daring: you believe identity should be visible and nothing true should be dull. You bring imagination, flair and creative courage. Your challenge: ask what needs revealing before you change the colour.",
  },
  skinners: {
    name: "THE SKINNERS & GLOVERS",
    crest: `${MEDIA_ROOT}/crests/skinners.png`,
    essence:
      "Workers of leather — supple, careful craft shaped exactly to the hand.",
    archetype: "The Keeper of Trust",
    omen: "old polished leather",
    motto: "GUARD WHAT HAS BEEN ENTRUSTED.",
    reveal:
      "The Chain felt old leather polished by generations of hands: you guard standards, honour and continuity. Protective, steady and principled — people rest easier in your keeping. Your challenge is suspicion: not everyone needs testing twice.",
  },
  cordiners: {
    name: "THE CORDINERS",
    crest: `${MEDIA_ROOT}/crests/cordiners.png`,
    essence:
      "The shoemakers — carrying every step of the city, skill passed hand to hand.",
    archetype: "The Road-Protector",
    omen: "road-dust",
    motto: "NO ONE GOES UNPREPARED.",
    reveal:
      "The Chain felt the road beneath your feet: practical, loyal and built for hard journeys, you equip others to endure. You care less for spectacle than readiness. Your challenge is guardedness — prepare for joy as faithfully as you prepare for weather.",
  },
  bakers: {
    name: "THE BAKERS",
    crest: `${MEDIA_ROOT}/crests/bakers.png`,
    essence: "Keepers of the oven — bread, generosity and the staff of daily life.",
    archetype: "The Sustainer",
    omen: "warm bread",
    motto: "NO ONE IS USEFUL HUNGRY.",
    reveal:
      "You ask whether people have eaten before anything else — care, for you, is practical before it is poetic. Warm, generous and reliable, you steady every room you provision. Your challenge is self-neglect: you feed everyone else first.",
  },
  fleshers: {
    name: "THE FLESHERS",
    crest: `${MEDIA_ROOT}/crests/fleshers.png`,
    essence:
      "The market’s honest trade — providers of the table since the city’s first mornings.",
    archetype: "The Plain Dealer",
    omen: "market bells",
    motto: "FACE THE NEED. SERVE IT WELL.",
    reveal:
      "The Chain did not flinch, and neither did you: honest about necessity, fair in supply and clean in dealing. Direct, useful and unsentimental in the best sense. Your challenge is bluntness — truth still needs tenderness.",
  },
  maltmen: {
    name: "THE MALTMEN",
    crest: `${MEDIA_ROOT}/crests/maltmen.png`,
    essence:
      "Turners of grain into good cheer — brewers, distillers and raisers of the toast.",
    archetype: "The Fermenter",
    omen: "warm grain",
    motto: "LET TIME DO ITS NOBLE WORK.",
    reveal:
      "The Chain heard laughter in the old vats: you know trust, flavour and friendship cannot be rushed. A natural host and a fine judge of timing, you turn raw ingredients into fellowship. Your challenge is delay — conditions are never perfect.",
  },
  gardeners: {
    name: "THE GARDENERS",
    crest: `${MEDIA_ROOT}/crests/gardeners.png`,
    essence:
      "Growers of green places — orchards, herbs and living things tended with care.",
    archetype: "The Cultivator",
    omen: "rain on leaves",
    motto: "LET GLASGOW — AND ITS PEOPLE — FLOURISH.",
    reveal:
      "The Chain softened into leaf and root: you believe growth is real work, and you see what is neglected and imagine it flourishing. Patient, hopeful and restorative. Your challenge is over-nurture — some things need pruning, not tending.",
  },
  barbers: {
    name: "THE BARBERS",
    crest: `${MEDIA_ROOT}/crests/barbers.png`,
    essence:
      "The city’s groomers and healers of old — care, renewal and a steady hand.",
    archetype: "The Restorer",
    omen: "a steady breath",
    motto: "A STEADY HAND RESTORES MORE THAN THE SURFACE.",
    reveal:
      "The Chain lowered its voice: you have the steadiness people need when they feel exposed. Caring, precise and humane, you restore composure as much as appearance. Your challenge is burden — do not carry others’ distress too deeply.",
  },
} as const satisfies Readonly<Record<CraftId, CraftProfile>>;

export const CRAFT_QUESTIONS = [
  {
    prompt: "The Hall wakes at midnight and asks what you will mend first.",
    options: [
      {
        title: "THE BROKEN MECHANISM",
        subtitle: "the one no one else understands",
        icon: "key",
        weights: { hammermen: 2, wrights: 1 },
      },
      {
        title: "THE TORN ROBE",
        subtitle: "before anyone must wear it",
        icon: "needle",
        weights: { tailors: 2, weavers: 1 },
      },
      {
        title: "THE CRACKED BOOTS",
        subtitle: "of the one with miles still to walk",
        icon: "boot",
        weights: { cordiners: 2, skinners: 1 },
      },
      {
        title: "THE EMPTY TABLE",
        subtitle: "so strangers may sit together again",
        icon: "table",
        weights: { maltmen: 2, bakers: 1 },
      },
    ],
  },
  {
    prompt: "When your hands are idle, what do they itch to do?",
    options: [
      {
        title: "THE WORKBENCH",
        subtitle: "shape something solid — wood, stone or metal",
        icon: "anvil",
        weights: { wrights: 2, masons: 2, hammermen: 2, coopers: 1 },
      },
      {
        title: "THE NEEDLE",
        subtitle: "stitch, cut or mend something fine",
        icon: "needle",
        weights: { tailors: 2, weavers: 2, cordiners: 1, skinners: 1 },
      },
      {
        title: "THE OVEN",
        subtitle: "bake, brew or carve — feed people well",
        icon: "oven",
        weights: { bakers: 2, maltmen: 2, fleshers: 2 },
      },
      {
        title: "THE GARDEN",
        subtitle: "tend something living and growing",
        icon: "leaf",
        weights: { gardeners: 3, barbers: 1 },
      },
    ],
  },
  {
    prompt: "Which compliment would please you most?",
    options: [
      {
        title: "BUILT TO LAST",
        subtitle: "“that will outlast us all”",
        icon: "rook",
        weights: { masons: 2, wrights: 2, coopers: 2 },
      },
      {
        title: "A PERFECT FIT",
        subtitle: "“made exactly for me”",
        icon: "boot",
        weights: { tailors: 2, cordiners: 2, skinners: 2 },
      },
      {
        title: "THE FINEST TABLE",
        subtitle: "“the best I’ve ever tasted”",
        icon: "cloche",
        weights: { bakers: 2, fleshers: 2, maltmen: 1 },
      },
      {
        title: "A FRESH TRIM",
        subtitle: "“you look brand new”",
        icon: "comb",
        weights: { barbers: 3, dyers: 1 },
      },
    ],
  },
  {
    prompt: "Choose your favourite corner of the Trades Hall:",
    options: [
      {
        title: "THE STAIRCASE",
        subtitle: "stone steps and the pillared front",
        icon: "stairs",
        weights: { masons: 3, wrights: 1 },
      },
      {
        title: "THE GRAND HALL",
        subtitle: "laid for a feast of 250",
        icon: "candelabra",
        weights: { bakers: 2, maltmen: 2, fleshers: 1 },
      },
      {
        title: "THE BANNERS",
        subtitle: "silk, thread and old tapestries",
        icon: "drape",
        weights: { weavers: 2, tailors: 1, dyers: 2 },
      },
      {
        title: "THE GREEN DOME",
        subtitle: "and the gardens beyond",
        icon: "dome",
        weights: { gardeners: 3 },
      },
    ],
  },
  {
    prompt: "A great feast is planned at the Hall. Your role?",
    options: [
      {
        title: "RAISE THE HALL",
        subtitle: "build the stage, set the scene",
        icon: "ladder",
        weights: { wrights: 2, masons: 1, coopers: 1, hammermen: 1 },
      },
      {
        title: "DRESS THE GUESTS",
        subtitle: "in their finest attire",
        icon: "shears",
        weights: { tailors: 2, dyers: 2, skinners: 1, cordiners: 1 },
      },
      {
        title: "COMMAND THE KITCHEN",
        subtitle: "from first loaf to final course",
        icon: "pot",
        weights: { bakers: 2, fleshers: 2 },
      },
      {
        title: "RAISE THE TOAST",
        subtitle: "fill every glass in the room",
        icon: "goblet",
        weights: { maltmen: 3 },
      },
    ],
  },
  {
    prompt: "Which virtue do you prize above the others?",
    options: [
      {
        title: "PRECISION",
        subtitle: "measured twice, struck once",
        icon: "compass",
        weights: { hammermen: 2, cordiners: 1, tailors: 1 },
      },
      {
        title: "PATIENCE",
        subtitle: "slow work, lasting worth",
        icon: "hourglass",
        weights: { weavers: 2, gardeners: 2, masons: 1 },
      },
      {
        title: "GENEROSITY",
        subtitle: "no one leaves hungry",
        icon: "loaf",
        weights: { bakers: 2, maltmen: 1, fleshers: 1 },
      },
      {
        title: "CARE",
        subtitle: "a steady, gentle hand",
        icon: "candle",
        weights: { barbers: 2, skinners: 2 },
      },
    ],
  },
  {
    prompt: "You must work one material for a whole year. Choose:",
    options: [
      {
        title: "IRON & SILVER",
        subtitle: "the forge and the fine bench",
        icon: "hammer",
        weights: { hammermen: 3 },
      },
      {
        title: "OAK & STONE",
        subtitle: "the saw, the chisel and the square",
        icon: "portico",
        weights: { wrights: 2, masons: 2, coopers: 1 },
      },
      {
        title: "WOOL, LINEN & LEATHER",
        subtitle: "the loom, the needle and the last",
        icon: "spool",
        weights: { weavers: 2, tailors: 1, skinners: 1, cordiners: 1 },
      },
      {
        title: "GRAIN & GREEN THINGS",
        subtitle: "the field, the orchard and the still",
        icon: "barley",
        weights: { gardeners: 2, bakers: 1, maltmen: 1, fleshers: 1 },
      },
    ],
  },
  {
    prompt: "Tradition, to you, is…",
    options: [
      {
        title: "A STANDARD",
        subtitle: "to uphold, exactly",
        icon: "banner",
        weights: { masons: 1, hammermen: 1, coopers: 1 },
      },
      {
        title: "A PATTERN",
        subtitle: "to reweave for today",
        icon: "shuttle",
        weights: { weavers: 1, dyers: 2, tailors: 1 },
      },
      {
        title: "A TABLE",
        subtitle: "with room for everyone",
        icon: "table",
        weights: { maltmen: 1, bakers: 1, fleshers: 1, barbers: 1 },
      },
      {
        title: "A SKILL",
        subtitle: "passed hand to hand",
        icon: "key",
        weights: { cordiners: 2, skinners: 1, wrights: 1, gardeners: 1 },
      },
    ],
  },
  {
    prompt: "Your perfect Saturday:",
    options: [
      {
        title: "IN THE WORKSHOP",
        subtitle: "till dusk, lost in the work",
        icon: "vice",
        weights: { hammermen: 2, wrights: 2, coopers: 2 },
      },
      {
        title: "AT THE MARKET",
        subtitle: "early, before the best is gone",
        icon: "scales",
        weights: { fleshers: 2, bakers: 1, gardeners: 1 },
      },
      {
        title: "TRIMMED & TAILORED",
        subtitle: "fresh cut, sharp outfit, out by noon",
        icon: "hat",
        weights: { barbers: 2, dyers: 2, tailors: 1, cordiners: 1 },
      },
      {
        title: "HANDS IN THE EARTH",
        subtitle: "in the garden till the light goes",
        icon: "spade",
        weights: { gardeners: 3 },
      },
    ],
  },
] as const satisfies readonly CraftQuizQuestion[];

function requireQuestion(questionIndex: number): CraftQuizQuestion {
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= CRAFT_QUESTIONS.length) {
    throw new RangeError(`Question index ${String(questionIndex)} is outside the quiz.`);
  }

  const question = CRAFT_QUESTIONS[questionIndex];
  if (question === undefined) {
    throw new RangeError(`Question index ${String(questionIndex)} is outside the quiz.`);
  }

  return question;
}

export function applyCraftQuizAnswer(
  scores: Readonly<CraftScores>,
  questionIndex: number,
  optionIndex: number,
): CraftQuizAnswerResult {
  const question = requireQuestion(questionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const option = question.options[optionIndex];
  if (option === undefined) {
    throw new RangeError(`Option index ${String(optionIndex)} is outside question ${String(questionIndex)}.`);
  }

  const nextScores: CraftScores = { ...scores };

  for (const craftId of CRAFT_ORDER) {
    const weight = option.weights[craftId];
    if (weight !== undefined) {
      nextScores[craftId] = (nextScores[craftId] ?? 0) + weight;
    }
  }

  return {
    scores: nextScores,
    lastWeights: { ...option.weights },
  };
}

export function rankCrafts(
  scores: Readonly<CraftScores>,
  lastWeights: CraftWeights = {},
): readonly CraftRankingEntry[] {
  return CRAFT_ORDER
    .map((craftId, stableOrder) => ({
      craftId,
      score: scores[craftId] ?? 0,
      lastAnswerWeight: lastWeights[craftId] ?? 0,
      profile: CRAFT_PROFILES[craftId],
      stableOrder,
    }))
    .sort((left, right) =>
      right.score - left.score ||
      right.lastAnswerWeight - left.lastAnswerWeight ||
      left.stableOrder - right.stableOrder,
    )
    .map(({ craftId, score, lastAnswerWeight, profile }) => ({
      craftId,
      score,
      lastAnswerWeight,
      profile,
    }));
}

export function buildCraftIntroductionMailto(craftId: CraftId): string {
  const craftName = CRAFT_PROFILES[craftId].name;
  const subject = `Craft introduction — ${craftName}`;
  const body = [
    "Hello,",
    "",
    `I took the Discover Your Craft quiz and my affinity was ${craftName}. I would like to learn more about the Craft and request an introduction.`,
    "",
    "My name:",
    "My trade or profession:",
    "",
  ].join("\n");

  return `mailto:info@tradeshallglasgow.co.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
