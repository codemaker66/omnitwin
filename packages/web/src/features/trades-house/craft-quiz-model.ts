import rawContent from "./craft-quiz.content.json";

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

/*
 * Authored copy and scoring weights live in craft-quiz.content.json so the quiz
 * can be rewritten, and previewed through projects/trades-house, without
 * touching this module. Structure stays here: which Crafts exist, the order
 * that breaks ranking ties, and how an answer scores. The interfaces below are
 * the contract tsc holds the JSON to on every build; the rules it cannot
 * express — every weight naming a real Craft, every icon being drawable, every
 * Craft still reachable — are enforced by craft-quiz-content.test.ts and by
 * projects/trades-house/tools/check.mjs.
 */
interface AuthoredCraft {
  readonly name: string;
  readonly archetype: string;
  readonly omen: string;
  readonly motto: string;
  readonly essence: string;
  readonly reveal: string;
}

interface AuthoredOption {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  /*
   * Each option names only the Crafts it rewards, so tsc infers the absent ones
   * as optional-undefined. Admitting undefined here is what lets the authored
   * JSON assign to this contract without a cast.
   */
  readonly weights: Readonly<Record<string, number | undefined>>;
}

interface AuthoredQuestion {
  readonly prompt: string;
  readonly options: readonly AuthoredOption[];
}

interface AuthoredContent {
  readonly crafts: Readonly<Record<string, AuthoredCraft>>;
  readonly questions: readonly AuthoredQuestion[];
}

const authoredContent: AuthoredContent = rawContent;

function craftWeightsFrom(authored: Readonly<Record<string, number | undefined>>): CraftWeights {
  const weights: CraftScores = {};

  for (const craftId of CRAFT_ORDER) {
    const weight = authored[craftId];
    if (weight !== undefined) {
      weights[craftId] = weight;
    }
  }

  return weights;
}

function hasEveryCraft(
  profiles: Partial<Record<CraftId, CraftProfile>>,
): profiles is Record<CraftId, CraftProfile> {
  return CRAFT_ORDER.every((craftId) => profiles[craftId] !== undefined);
}

function buildCraftProfiles(): Readonly<Record<CraftId, CraftProfile>> {
  const profiles: Partial<Record<CraftId, CraftProfile>> = {};

  for (const craftId of CRAFT_ORDER) {
    const authored = authoredContent.crafts[craftId];
    if (authored === undefined) {
      continue;
    }

    profiles[craftId] = {
      name: authored.name,
      crest: `${MEDIA_ROOT}/crests/${craftId}.png`,
      essence: authored.essence,
      archetype: authored.archetype,
      omen: authored.omen,
      motto: authored.motto,
      reveal: authored.reveal,
    };
  }

  if (!hasEveryCraft(profiles)) {
    const missing = CRAFT_ORDER.filter((craftId) => profiles[craftId] === undefined);
    throw new Error(`craft-quiz.content.json is missing these Crafts: ${missing.join(", ")}.`);
  }

  return profiles;
}

export const CRAFT_PROFILES: Readonly<Record<CraftId, CraftProfile>> = buildCraftProfiles();

export const CRAFT_QUESTIONS: readonly CraftQuizQuestion[] = authoredContent.questions.map(
  (question) => ({
    prompt: question.prompt,
    options: question.options.map((option) => ({
      title: option.title,
      subtitle: option.subtitle,
      icon: option.icon,
      weights: craftWeightsFrom(option.weights),
    })),
  }),
);

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
