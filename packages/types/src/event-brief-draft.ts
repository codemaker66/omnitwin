import { z } from "zod";
import { safePlanningLanguage } from "./evidence-runtime.js";
import {
  EventArchitectAccessibilityRequirementSchema,
  EventArchitectBriefSchema,
  EventArchitectLayoutStyleSchema,
  EventArchitectServiceModelSchema,
  type EventArchitectAccessibilityRequirement,
} from "./event-architect.js";
import { SpaceIdSchema } from "./space.js";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Typed event briefs (T-650): the language half of the Event Architect.
//
// A planner describes an event in their own words. A language model reads it
// into the fields the deterministic engine can represent, says which values it
// inferred rather than read, and lists every requested thing the engine cannot
// represent in the planner's own words. Values outside the engine's bounds are
// never clamped: they leave the field unset and become an unsupported item.
// The result is an unchecked draft; nothing runs until a person fills the
// request form and generates the options themselves.
//
// The model's raw answer (EventBriefExtraction) is untrusted. It is parsed
// here, checked against the engine's own bounds, and only then becomes an
// EventBriefDraft, whose every value already satisfies EventArchitectBriefSchema.
// ---------------------------------------------------------------------------

export const EVENT_BRIEF_DRAFT_SCHEMA_VERSION = "venviewer.event-brief-draft.v0";

/** The longest description read: a generous email's worth of words. */
export const EVENT_BRIEF_DESCRIPTION_MAX_LENGTH = 4000;

/** The guest bounds the engine plans for (EventArchitectBriefSchema.guestCount). */
export const EVENT_BRIEF_MIN_GUESTS = 1;
export const EVENT_BRIEF_MAX_GUESTS = 300;

const BRIEF = EventArchitectBriefSchema.shape;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const QUOTE_MAX_LENGTH = 500;
const NOTE_MAX_LENGTH = 500;

export const CreateEventBriefDraftInputSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  description: z.string().trim().min(1).max(EVENT_BRIEF_DESCRIPTION_MAX_LENGTH),
}).strict();
export type CreateEventBriefDraftInput = z.infer<typeof CreateEventBriefDraftInputSchema>;

export const EVENT_BRIEF_DRAFT_FIELDS = [
  "eventName",
  "eventType",
  "guestCount",
  "layoutStyle",
  "budgetLimitMinor",
  "preferredDate",
  "startTime",
  "endTime",
  "serviceModel",
  "accessibilityRequirements",
  "planningPrompt",
] as const;
export const EventBriefDraftFieldSchema = z.enum(EVENT_BRIEF_DRAFT_FIELDS);
export type EventBriefDraftField = z.infer<typeof EventBriefDraftFieldSchema>;

/** A real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A 24-hour clock time written HH:MM. */
export function isClockTime(text: string): boolean {
  return CLOCK_TIME.test(text);
}

/** The brief as read: every value within the engine's own bounds, or unset
 *  (null) where nothing was read or what was asked for cannot be held. */
export const EventBriefDraftValuesSchema = z.object({
  eventName: BRIEF.eventName.nullable(),
  eventType: BRIEF.eventType.nullable(),
  guestCount: BRIEF.guestCount.nullable(),
  layoutStyle: BRIEF.layoutStyle.nullable(),
  budgetLimitMinor: BRIEF.budgetLimitMinor,
  preferredDate: z.string().refine(isCalendarDate, "Expected a calendar date written YYYY-MM-DD").nullable(),
  startTime: z.string().refine(isClockTime, "Expected a 24-hour time written HH:MM").nullable(),
  endTime: z.string().refine(isClockTime, "Expected a 24-hour time written HH:MM").nullable(),
  serviceModel: BRIEF.serviceModel.nullable(),
  accessibilityRequirements: z.array(EventArchitectAccessibilityRequirementSchema).max(3).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each accessibility requirement appears once." });
    }
  }),
  planningPrompt: BRIEF.planningPrompt,
}).strict();
export type EventBriefDraftValues = z.infer<typeof EventBriefDraftValuesSchema>;

/** A value the model chose rather than read: from context, by rounding an
 *  approximate figure, by picking a year, or by translating the planner's
 *  words into one of the engine's values. */
export const EventBriefAssumptionSchema = z.object({
  field: EventBriefDraftFieldSchema,
  accessibilityRequirement: EventArchitectAccessibilityRequirementSchema.nullable(),
  /** The planner's words it came from, when there are any. */
  words: z.string().trim().min(1).max(QUOTE_MAX_LENGTH).nullable(),
  basis: z.string().trim().min(1).max(NOTE_MAX_LENGTH),
}).strict();
export type EventBriefAssumption = z.infer<typeof EventBriefAssumptionSchema>;

export const EVENT_BRIEF_UNSUPPORTED_KINDS = [
  "not_modelled",
  "layout_style",
  "service_style",
  "beyond_limits",
  "needs_exact_value",
  "other_room",
  "other",
] as const;
export const EventBriefUnsupportedKindSchema = z.enum(EVENT_BRIEF_UNSUPPORTED_KINDS);
export type EventBriefUnsupportedKind = z.infer<typeof EventBriefUnsupportedKindSchema>;

/** Kinds that concern a field's own value: that field is left unset. The
 *  others (a dance floor, another room) name a field only for context. */
const VALUE_KINDS: ReadonlySet<EventBriefUnsupportedKind> = new Set([
  "beyond_limits",
  "layout_style",
  "service_style",
  "needs_exact_value",
]);

/** Whether an unsupported item leaves its field unset. */
export function holdsBackField(item: { readonly kind: EventBriefUnsupportedKind; readonly field: EventBriefDraftField | null }): boolean {
  return item.field !== null && item.field !== "accessibilityRequirements" && VALUE_KINDS.has(item.kind);
}

/** Something asked for that the engine cannot represent, in the planner's
 *  own words. `verbatim` says the words were found in the description as
 *  written; otherwise they are the model's description of the request. */
export const EventBriefUnsupportedSchema = z.object({
  words: z.string().trim().min(1).max(QUOTE_MAX_LENGTH),
  verbatim: z.boolean(),
  kind: EventBriefUnsupportedKindSchema,
  explanation: z.string().trim().min(1).max(NOTE_MAX_LENGTH),
  field: EventBriefDraftFieldSchema.nullable(),
}).strict();
export type EventBriefUnsupported = z.infer<typeof EventBriefUnsupportedSchema>;

export const EventBriefDraftSchema = z.object({
  schemaVersion: z.literal(EVENT_BRIEF_DRAFT_SCHEMA_VERSION),
  brief: EventBriefDraftValuesSchema,
  assumptions: z.array(EventBriefAssumptionSchema).max(40),
  unsupported: z.array(EventBriefUnsupportedSchema).max(60),
  /** Email addresses or phone numbers were taken out before it was read. */
  contactDetailsRemoved: z.boolean(),
  humanReviewRequired: z.literal(true),
  provenance: z.literal("ai_generated"),
  evidenceStatus: z.literal("unverified"),
  /** Nothing runs automatically: a person fills the form and generates. */
  runState: z.literal("not_run"),
  generatedAt: z.string().datetime(),
}).strict().superRefine((draft, ctx) => {
  // A value held back as unsupported is left unset, never kept as a clamped
  // or substituted value beside it.
  for (const item of draft.unsupported) {
    if (!holdsBackField(item)) continue;
    if (item.field !== null && item.field !== "accessibilityRequirements" && draft.brief[item.field] !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["brief", item.field],
        message: `A field listed as unsupported (${item.field}) must be left unset.`,
      });
    }
  }
});
export type EventBriefDraft = z.infer<typeof EventBriefDraftSchema>;

// ---------------------------------------------------------------------------
// The model's raw answer. Types are deliberately looser than the engine's
// (a guest count is any number, a date any text) so that an out-of-range or
// loosely written value reaches the bounds check below and becomes an
// unsupported item, instead of failing the whole answer.
// ---------------------------------------------------------------------------

export const EventBriefExtractionSourceSchema = z.enum(["stated", "inferred", "absent"]);
export type EventBriefExtractionSource = z.infer<typeof EventBriefExtractionSourceSchema>;

const ExtractedText = z.string().max(4000).nullable();

function extractedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    source: EventBriefExtractionSourceSchema,
    words: ExtractedText,
    basis: ExtractedText,
  }).strict();
}

export const EXTRACTED_LAYOUT_STYLES = ["dinner-rounds", "theatre", "other"] as const;
export const EXTRACTED_SERVICE_MODELS = ["none", "plated", "buffet", "reception", "other"] as const;

export const EventBriefExtractionSchema = z.object({
  fields: z.object({
    eventName: extractedField(z.string()),
    eventType: extractedField(z.string()),
    guestCount: extractedField(z.number()),
    layoutStyle: extractedField(z.enum(EXTRACTED_LAYOUT_STYLES)),
    budgetGbp: extractedField(z.number()),
    preferredDate: extractedField(z.string()),
    startTime: extractedField(z.string()),
    endTime: extractedField(z.string()),
    serviceModel: extractedField(z.enum(EXTRACTED_SERVICE_MODELS)),
    planningEmphasis: extractedField(z.string()),
  }).strict(),
  accessibility: z.array(z.object({
    requirement: EventArchitectAccessibilityRequirementSchema,
    source: z.enum(["stated", "inferred"]),
    words: ExtractedText,
    basis: ExtractedText,
  }).strict()).max(12),
  unsupported: z.array(z.object({
    words: z.string().min(1).max(4000),
    kind: EventBriefUnsupportedKindSchema,
    explanation: z.string().min(1).max(4000),
    field: EventBriefDraftFieldSchema.nullable(),
  }).strict()).max(40),
}).strict();
export type EventBriefExtraction = z.infer<typeof EventBriefExtractionSchema>;

/** The model's answer did not match the contract. Carries issue paths only,
 *  never the values, so logging it cannot leak what the planner wrote. */
export class EventBriefExtractionError extends Error {
  readonly issuePaths: readonly string[];

  constructor(issuePaths: readonly string[]) {
    super(`The brief reading did not match its contract at ${issuePaths.slice(0, 5).join(", ") || "the root"}.`);
    this.name = "EventBriefExtractionError";
    this.issuePaths = issuePaths;
  }
}

// ---------------------------------------------------------------------------
// The description is sent to the model inside <description> … </description>
// as data. A closing tag typed into it (any case, any spacing:
// "</ DESCRIPTION >") could end that data block early and let the rest read
// as instructions, so that sequence alone is neutralised before sending: a
// zero-width space after its "<" stops it being the tag and is invisible
// where the words are shown. Nothing else is escaped ("bride & groom" stays
// as written), and quotes are still checked against the original words.
// ---------------------------------------------------------------------------

const DESCRIPTION_CLOSING_TAG = "<\\s*\\/\\s*description\\s*>";

/** What is inserted into a typed closing tag: a zero-width space. */
export const DESCRIPTION_TAG_NEUTRALISER = String.fromCodePoint(0x200b);

/** Characters with no width, ignored when words are compared. */
const ZERO_WIDTH = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((code) => String.fromCodePoint(code)).join("")}]`, "gu");

/** The description as it may sit inside <description> … </description>:
 *  every closing tag typed into it neutralised, nothing else changed. */
export function neutraliseDescriptionTag(text: string): string {
  return text.replace(new RegExp(DESCRIPTION_CLOSING_TAG, "giu"), (tag) => `<${DESCRIPTION_TAG_NEUTRALISER}${tag.slice(1)}`);
}

// ---------------------------------------------------------------------------
// From the model's answer to a draft brief.
// ---------------------------------------------------------------------------

/** Text compared for "the planner's own words": case, width, curly quotes,
 *  dash variants, zero-width characters and runs of space do not matter. */
export function normaliseWords(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/[‘’‚‛′]/gu, "'")
    .replace(/[“”„‟″]/gu, "\"")
    .replace(/[‐-―−]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^["'(]+|["'.,;:!?)]+$/gu, "")
    .trim();
}

/** Where closing description tags sit in normalised text, as [start, end). */
function closingTagSpans(normalised: string): (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = [];
  const tag = new RegExp(DESCRIPTION_CLOSING_TAG, "giu");
  for (let match = tag.exec(normalised); match !== null; match = tag.exec(normalised)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** Whether the words are the planner's own, as written in the description.
 *  Words that take in any part of a closing description tag never are, with
 *  or without the neutraliser, so such a quote is treated the same whether
 *  or not the model copied the invisible character. */
function foundIn(description: string, words: string | null): boolean {
  if (words === null) return false;
  const needle = normaliseWords(words);
  if (needle.length === 0) return false;
  const haystack = normaliseWords(description);
  const tags = closingTagSpans(haystack);
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    if (!tags.some(([start, stop]) => at < stop && end > start)) return true;
  }
  return false;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function cleanText(text: string | null): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Model-authored wording, with any certainty the venue cannot back taken out. */
function modelNote(text: string | null, fallback: string): string {
  return clip(safePlanningLanguage(cleanText(text) ?? fallback), NOTE_MAX_LENGTH);
}

const FIELD_WORDS: Readonly<Record<EventBriefDraftField, string>> = {
  eventName: "event name",
  eventType: "event type",
  guestCount: "guest count",
  layoutStyle: "layout style",
  budgetLimitMinor: "budget",
  preferredDate: "date",
  startTime: "start time",
  endTime: "end time",
  serviceModel: "service",
  accessibilityRequirements: "accessibility requirement",
  planningPrompt: "planning emphasis",
};

interface Reading<T> {
  readonly value: T | null;
  readonly source: EventBriefExtractionSource;
  readonly words: string | null;
  readonly basis: string | null;
}

interface Builder {
  readonly description: string;
  readonly assumptions: EventBriefAssumption[];
  readonly unsupported: EventBriefUnsupported[];
  /** Fields an unsupported item names: they are left unset. */
  readonly heldBack: Set<EventBriefDraftField>;
}

function addUnsupported(builder: Builder, item: {
  readonly words: string;
  readonly kind: EventBriefUnsupportedKind;
  readonly explanation: string;
  readonly field: EventBriefDraftField | null;
}, from: "model" | "bounds"): void {
  const words = clip(item.words, QUOTE_MAX_LENGTH);
  const key = normaliseWords(words);
  if (holdsBackField(item) && item.field !== null) builder.heldBack.add(item.field);
  // The same words are listed once. A bounds check adds nothing for a field
  // the model already held back; two of the model's own items about one
  // field (two layouts asked for) are both kept.
  const duplicate = builder.unsupported.some((existing) =>
    normaliseWords(existing.words) === key
    || (from === "bounds" && existing.field === item.field && holdsBackField(existing)));
  if (duplicate) return;
  builder.unsupported.push({
    words,
    verbatim: words === item.words.trim() && foundIn(builder.description, words),
    kind: item.kind,
    explanation: modelNote(item.explanation, "The Event Architect cannot represent this."),
    field: item.field,
  });
}

/** Accepts a read value: an assumption is recorded when it was inferred, or
 *  said to be stated in words that are not in the description. */
function accept<T>(builder: Builder, field: EventBriefDraftField, reading: Reading<unknown>, value: T): T {
  const statedAsWritten = reading.source === "stated" && foundIn(builder.description, reading.words);
  if (!statedAsWritten) {
    const words = cleanText(reading.words);
    builder.assumptions.push({
      field,
      accessibilityRequirement: null,
      words: words === null ? null : clip(words, QUOTE_MAX_LENGTH),
      basis: reading.source === "stated"
        ? modelNote(null, "Read from the description, but the words could not be found as written.")
        : modelNote(reading.basis, `The ${FIELD_WORDS[field]} was not stated; this value was inferred.`),
    });
  }
  return value;
}

function heldBack(
  builder: Builder,
  field: EventBriefDraftField,
  reading: Reading<unknown>,
  kind: EventBriefUnsupportedKind,
  explanation: string,
  fallbackWords: string,
): null {
  addUnsupported(builder, {
    words: cleanText(reading.words) ?? fallbackWords,
    kind,
    explanation,
    field,
  }, "bounds");
  return null;
}

function readText(builder: Builder, field: "eventName" | "eventType" | "planningPrompt", reading: Reading<string>, max: number): string | null {
  const text = cleanText(reading.value);
  if (text === null) return null;
  if (text.length > max) {
    return heldBack(builder, field, reading, "beyond_limits",
      `The ${FIELD_WORDS[field]} can hold up to ${String(max)} characters.`, clip(text, 120));
  }
  return accept(builder, field, reading, safePlanningLanguage(text));
}

function readGuests(builder: Builder, reading: Reading<number>): number | null {
  const count = reading.value;
  if (count === null) return null;
  if (!Number.isInteger(count)) {
    return heldBack(builder, "guestCount", reading, "needs_exact_value",
      "The guest count needs a whole number.", `${String(count)} guests`);
  }
  if (count < EVENT_BRIEF_MIN_GUESTS || count > EVENT_BRIEF_MAX_GUESTS) {
    return heldBack(builder, "guestCount", reading, "beyond_limits",
      `The Event Architect plans for ${String(EVENT_BRIEF_MIN_GUESTS)} to ${String(EVENT_BRIEF_MAX_GUESTS)} guests; this asks for ${String(count)}.`,
      `${String(count)} guests`);
  }
  return accept(builder, "guestCount", reading, count);
}

function readBudget(builder: Builder, reading: Reading<number>): number | null {
  const pounds = reading.value;
  if (pounds === null) return null;
  const minor = Math.round(pounds * 100);
  if (!Number.isFinite(pounds) || pounds < 0 || !Number.isSafeInteger(minor)) {
    return heldBack(builder, "budgetLimitMinor", reading, "beyond_limits",
      "The budget must be a positive amount in pounds.", `a budget of ${String(pounds)}`);
  }
  return accept(builder, "budgetLimitMinor", reading, minor);
}

function readFormatted(
  builder: Builder,
  field: "preferredDate" | "startTime" | "endTime",
  reading: Reading<string>,
  valid: (text: string) => boolean,
  needs: string,
): string | null {
  const text = cleanText(reading.value);
  if (text === null) return null;
  if (!valid(text)) return heldBack(builder, field, reading, "needs_exact_value", needs, text);
  return accept(builder, field, reading, text);
}

function readChoice<T extends string>(
  builder: Builder,
  field: "layoutStyle" | "serviceModel",
  reading: Reading<string>,
  allowed: z.ZodType<T>,
  kind: EventBriefUnsupportedKind,
  explanation: string,
): T | null {
  if (reading.value === null) return null;
  const choice = allowed.safeParse(reading.value);
  if (!choice.success) {
    return heldBack(builder, field, reading, kind, explanation, `another ${FIELD_WORDS[field]}`);
  }
  return accept(builder, field, reading, choice.data);
}

/**
 * Turns the model's raw answer into a draft brief. Every value is checked
 * against the engine's bounds: out of range, it is left unset and listed as
 * unsupported with the planner's words, never clamped. Every value the model
 * inferred, or claimed to read in words that are not in the description, is
 * listed as an assumption. Throws EventBriefExtractionError when the answer
 * does not match its contract.
 */
export function interpretEventBriefExtraction(input: {
  readonly extraction: unknown;
  /** The description exactly as the model read it (after scrubbing). */
  readonly description: string;
  readonly contactDetailsRemoved: boolean;
  readonly generatedAt: string;
}): EventBriefDraft {
  const parsed = EventBriefExtractionSchema.safeParse(input.extraction);
  if (!parsed.success) {
    throw new EventBriefExtractionError(parsed.error.issues.map((issue) => issue.path.join(".")));
  }
  const { fields, accessibility, unsupported } = parsed.data;
  const builder: Builder = {
    description: input.description,
    assumptions: [],
    unsupported: [],
    heldBack: new Set(),
  };

  // The model's own list first, so its explanation is kept for a field it
  // already named; the bounds checks then add only what it missed.
  for (const item of unsupported) {
    addUnsupported(builder, {
      words: item.words,
      kind: item.kind,
      explanation: item.explanation,
      field: item.field,
    }, "model");
  }

  // A value given with source "absent" was still chosen by the model.
  const read = <T>(reading: Reading<T>): Reading<T> =>
    reading.value !== null && reading.source === "absent" ? { ...reading, source: "inferred" } : reading;

  const brief: EventBriefDraftValues = {
    eventName: readText(builder, "eventName", read(fields.eventName), 200),
    eventType: readText(builder, "eventType", read(fields.eventType), 120),
    guestCount: readGuests(builder, read(fields.guestCount)),
    layoutStyle: readChoice(builder, "layoutStyle", read(fields.layoutStyle), EventArchitectLayoutStyleSchema, "layout_style",
      "The Event Architect sets out dinner rounds or theatre rows only."),
    budgetLimitMinor: readBudget(builder, read(fields.budgetGbp)),
    preferredDate: readFormatted(builder, "preferredDate", read(fields.preferredDate), isCalendarDate,
      "The brief takes one exact date."),
    startTime: readFormatted(builder, "startTime", read(fields.startTime), isClockTime,
      "The brief takes an exact start time."),
    endTime: readFormatted(builder, "endTime", read(fields.endTime), isClockTime,
      "The brief takes an exact end time."),
    serviceModel: readChoice(builder, "serviceModel", read(fields.serviceModel), EventArchitectServiceModelSchema, "service_style",
      "The Event Architect records plated, buffet, reception or no catering service only."),
    accessibilityRequirements: [],
    planningPrompt: readText(builder, "planningPrompt", read(fields.planningEmphasis), 2000),
  };

  const requirements: EventArchitectAccessibilityRequirement[] = [];
  for (const entry of accessibility) {
    if (requirements.includes(entry.requirement)) continue;
    requirements.push(entry.requirement);
    if (entry.source === "stated" && foundIn(input.description, entry.words)) continue;
    const words = cleanText(entry.words);
    builder.assumptions.push({
      field: "accessibilityRequirements",
      accessibilityRequirement: entry.requirement,
      words: words === null ? null : clip(words, QUOTE_MAX_LENGTH),
      basis: entry.source === "stated"
        ? modelNote(null, "Read from the description, but the words could not be found as written.")
        : modelNote(entry.basis, "This accessibility requirement was inferred."),
    });
  }

  // A field an unsupported item names is left unset, with any assumption
  // about it withdrawn: the unsupported item says what was asked for.
  const withheld: Record<EventBriefDraftField, unknown> = { ...brief, accessibilityRequirements: requirements };
  for (const field of builder.heldBack) {
    if (field !== "accessibilityRequirements") withheld[field] = null;
  }
  const assumptions = builder.assumptions.filter((assumption) =>
    assumption.field === "accessibilityRequirements" || !builder.heldBack.has(assumption.field));

  const draft = EventBriefDraftSchema.safeParse({
    schemaVersion: EVENT_BRIEF_DRAFT_SCHEMA_VERSION,
    brief: withheld,
    assumptions,
    unsupported: builder.unsupported,
    contactDetailsRemoved: input.contactDetailsRemoved,
    humanReviewRequired: true,
    provenance: "ai_generated",
    evidenceStatus: "unverified",
    runState: "not_run",
    generatedAt: input.generatedAt,
  });
  // Parsed safely so a failure reports where, never the values read.
  if (!draft.success) {
    throw new EventBriefExtractionError(draft.error.issues.map((issue) => issue.path.join(".")));
  }
  return draft.data;
}
