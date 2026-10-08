import type { EventBriefDraft } from "@omnitwin/types";
import type { EventBriefEvalCase, EventBriefExpectation } from "./event-brief-cases.js";

// ---------------------------------------------------------------------------
// Scoring a typed-brief reading against its expectation (T-650). Pure: the
// eval script feeds it live readings; the unit tests feed it fixtures.
// ---------------------------------------------------------------------------

export const SCORED_FIELDS = [
  "eventType",
  "guestCount",
  "layoutStyle",
  "serviceModel",
  "budgetLimitMinor",
  "preferredDate",
  "startTime",
  "endTime",
  "accessibilityRequirements",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export type FieldScore = "match" | "mismatch" | "not_scored";

export interface EventBriefCaseScore {
  readonly id: string;
  readonly fields: Readonly<Record<ScoredField, FieldScore>>;
  /** Expected unsupported words found / expected. */
  readonly unsupportedFound: number;
  readonly unsupportedExpected: number;
  readonly unsupportedMissing: readonly string[];
  readonly assumptionsFound: number;
  readonly assumptionsExpected: number;
  readonly assumptionsMissing: readonly string[];
  /** Null when the case does not check it. */
  readonly contactDetailsRemoved: boolean | null;
}

function exact<T>(expected: T | undefined, actual: T): FieldScore {
  if (expected === undefined) return "not_scored";
  return expected === actual ? "match" : "mismatch";
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A word or phrase, as a whole, in the planner's words of some unsupported item. */
function heldBackWords(draft: EventBriefDraft, needle: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped(needle)}(?![\\p{L}\\p{N}])`, "iu");
  return draft.unsupported.some((item) => pattern.test(item.words));
}

function eventTypeScore(expected: EventBriefExpectation, draft: EventBriefDraft): FieldScore {
  if (expected.eventTypeIncludes === undefined) return "not_scored";
  const type = draft.brief.eventType?.toLowerCase() ?? "";
  return expected.eventTypeIncludes.some((word) => type.includes(word)) ? "match" : "mismatch";
}

function accessibilityScore(expected: EventBriefExpectation, draft: EventBriefDraft): FieldScore {
  if (expected.accessibilityIncludes === undefined) return "not_scored";
  return expected.accessibilityIncludes.every((requirement) => draft.brief.accessibilityRequirements.includes(requirement))
    ? "match"
    : "mismatch";
}

export function scoreEventBriefCase(evalCase: EventBriefEvalCase, draft: EventBriefDraft): EventBriefCaseScore {
  const expected = evalCase.expected;
  const { brief } = draft;
  const unsupportedMissing = expected.unsupported.filter((needle) => !heldBackWords(draft, needle));
  const assumed = expected.assumed ?? [];
  const assumptionsMissing = assumed.filter((field) => !draft.assumptions.some((assumption) => assumption.field === field));
  return {
    id: evalCase.id,
    fields: {
      eventType: eventTypeScore(expected, draft),
      guestCount: exact(expected.guestCount, brief.guestCount),
      layoutStyle: exact(expected.layoutStyle, brief.layoutStyle),
      serviceModel: exact(expected.serviceModel, brief.serviceModel),
      budgetLimitMinor: exact(expected.budgetLimitMinor, brief.budgetLimitMinor),
      preferredDate: exact(expected.preferredDate, brief.preferredDate),
      startTime: exact(expected.startTime, brief.startTime),
      endTime: exact(expected.endTime, brief.endTime),
      accessibilityRequirements: accessibilityScore(expected, draft),
    },
    unsupportedFound: expected.unsupported.length - unsupportedMissing.length,
    unsupportedExpected: expected.unsupported.length,
    unsupportedMissing,
    assumptionsFound: assumed.length - assumptionsMissing.length,
    assumptionsExpected: assumed.length,
    assumptionsMissing,
    contactDetailsRemoved: expected.contactDetailsRemoved === undefined
      ? null
      : draft.contactDetailsRemoved === expected.contactDetailsRemoved,
  };
}

export interface FieldAccuracy {
  readonly field: ScoredField;
  readonly matched: number;
  readonly scored: number;
}

export interface EventBriefEvalSummary {
  readonly cases: number;
  readonly failedCases: number;
  readonly fields: readonly FieldAccuracy[];
  readonly unsupportedFound: number;
  readonly unsupportedExpected: number;
  readonly assumptionsFound: number;
  readonly assumptionsExpected: number;
  readonly contactChecksPassed: number;
  readonly contactChecks: number;
}

function expects(expected: EventBriefExpectation, field: ScoredField): boolean {
  switch (field) {
    case "eventType": return expected.eventTypeIncludes !== undefined;
    case "accessibilityRequirements": return expected.accessibilityIncludes !== undefined;
    default: return expected[field] !== undefined;
  }
}

/** Per-field accuracy over the scored cases; a case that failed to read
 *  counts against every field it would have scored. */
export function summariseEventBriefEval(
  scores: readonly EventBriefCaseScore[],
  failed: readonly EventBriefEvalCase[],
): EventBriefEvalSummary {
  const fields = SCORED_FIELDS.map((field): FieldAccuracy => {
    const scored = scores.filter((score) => score.fields[field] !== "not_scored");
    const failedScored = failed.filter((evalCase) => expects(evalCase.expected, field));
    return {
      field,
      matched: scored.filter((score) => score.fields[field] === "match").length,
      scored: scored.length + failedScored.length,
    };
  });
  const sum = (pick: (score: EventBriefCaseScore) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0);
  const contactScores = scores.filter((score) => score.contactDetailsRemoved !== null);
  return {
    cases: scores.length + failed.length,
    failedCases: failed.length,
    fields,
    unsupportedFound: sum((score) => score.unsupportedFound),
    unsupportedExpected: sum((score) => score.unsupportedExpected)
      + failed.reduce((total, evalCase) => total + evalCase.expected.unsupported.length, 0),
    assumptionsFound: sum((score) => score.assumptionsFound),
    assumptionsExpected: sum((score) => score.assumptionsExpected)
      + failed.reduce((total, evalCase) => total + (evalCase.expected.assumed?.length ?? 0), 0),
    contactChecksPassed: contactScores.filter((score) => score.contactDetailsRemoved === true).length,
    contactChecks: contactScores.length
      + failed.filter((evalCase) => evalCase.expected.contactDetailsRemoved !== undefined).length,
  };
}

function percent(matched: number, of: number): string {
  return of === 0 ? "   n/a" : `${(matched / of * 100).toFixed(1).padStart(5)}%`;
}

/** The summary as a plain-text table. */
export function formatEventBriefEval(summary: EventBriefEvalSummary): string {
  return [
    `Cases: ${String(summary.cases)} (${String(summary.failedCases)} failed to read)`,
    "",
    "Field                      Accuracy   Matched/Scored",
    ...summary.fields.map((field) =>
      `${field.field.padEnd(26)} ${percent(field.matched, field.scored)}   ${String(field.matched)}/${String(field.scored)}`),
    "",
    `Unsupported items found    ${percent(summary.unsupportedFound, summary.unsupportedExpected)}   ${String(summary.unsupportedFound)}/${String(summary.unsupportedExpected)}`,
    `Assumptions declared       ${percent(summary.assumptionsFound, summary.assumptionsExpected)}   ${String(summary.assumptionsFound)}/${String(summary.assumptionsExpected)}`,
    `Contact details removed    ${percent(summary.contactChecksPassed, summary.contactChecks)}   ${String(summary.contactChecksPassed)}/${String(summary.contactChecks)}`,
  ].join("\n");
}
