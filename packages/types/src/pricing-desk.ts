import { z } from "zod";

// ---------------------------------------------------------------------------
// The Pricing desk (Blake, 17 October 2026): a venue's own admins and managers
// keep its price list from the venue workspace, and are offered suggestions
// worked out from the venue's own record. Three contracts live here because
// the API and the web both read them:
//
//   1. who may set a price (PRICING_WRITE_ROLES);
//   2. which rate stands on a date when a rate for particular dates sits
//      beside the everyday rate (standingRates);
//   3. the shape of a suggestion and of its dismissal.
//
// A suggestion is advice. Nothing in this module, or anything that reads it,
// changes a price: a person accepts one by saving a rate in the ordinary form.
// ---------------------------------------------------------------------------

/**
 * Who may set a price: create, change, retire or bring back a pricing rule.
 * docs/operations/people-matrix.md: "A price change: admin; manager if Blake
 * says so". Whether manager stays is Blake's call, so it is this one line,
 * read by the API's gate (utils/query.ts) and the web's controls alike.
 */
export const PRICING_WRITE_ROLES = ["admin", "manager"] as const;
export type PricingWriteRole = (typeof PRICING_WRITE_ROLES)[number];

// ---------------------------------------------------------------------------
// 2. Rates for particular dates
//
// Rules stack: every rule that applies to a booking adds a line. A rate for
// particular dates ("Grand Hall — Evening, 13 June 2027") is not meant to be
// charged on top of the everyday "Grand Hall — Evening"; it takes its place
// on those dates. The rule is the one the price sheet already follows for
// times (the narrowest window wins): for the same room, the same time of day
// and the same way of charging, the rule naming the fewest dates stands, and
// the others give way to it on those dates. Rules naming the same dates
// still stack, as every rule did before.
// ---------------------------------------------------------------------------

export interface RateSpecificityFields {
  readonly spaceId: string | null;
  readonly type: string;
  readonly appliesFrom: string | null;
  readonly appliesUntil: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;
/** Before and after any date a rule can name. */
const OPEN_START = -1_000_000_000;
const OPEN_END = 1_000_000_000;

/** Days since 1970-01-01 for a "YYYY-MM-DD", or null for anything else. */
export function dayNumber(date: string): number | null {
  const match = DATE_ONLY.exec(date);
  if (match === null) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/** "19:00:00" as Postgres sends a time, or "19:00": the clock face. */
function clockFace(time: string | null): string {
  if (time === null) return "";
  return /^\d{2}:\d{2}/u.test(time) ? time.slice(0, 5) : time;
}

/** How many days the rule names; an open end names every day on that side. */
function datedSpan(rule: RateSpecificityFields): number {
  const from = rule.validFrom === null ? OPEN_START : dayNumber(rule.validFrom) ?? OPEN_START;
  const to = rule.validTo === null ? OPEN_END : dayNumber(rule.validTo) ?? OPEN_END;
  return to - from;
}

function alternativesKey(rule: RateSpecificityFields): string {
  return [rule.spaceId ?? "*", clockFace(rule.appliesFrom), clockFace(rule.appliesUntil), rule.type].join("|");
}

/**
 * Which rule each set-aside rule gives way to, among rules that are all
 * valid on one date. A rule absent from the map stands.
 */
export function rateReplacements<T extends RateSpecificityFields>(rules: readonly T[]): Map<T, T> {
  const groups = new Map<string, T[]>();
  for (const rule of rules) {
    const key = alternativesKey(rule);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [rule]);
    else group.push(rule);
  }
  const replaced = new Map<T, T>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const narrowest = Math.min(...group.map(datedSpan));
    const standing = group.find((rule) => datedSpan(rule) === narrowest);
    if (standing === undefined) continue;
    for (const rule of group) {
      if (datedSpan(rule) > narrowest) replaced.set(rule, standing);
    }
  }
  return replaced;
}

/** The rules that stand on a date, among rules all valid on it, in their order. */
export function standingRates<T extends RateSpecificityFields>(rules: readonly T[]): T[] {
  const replaced = rateReplacements(rules);
  return rules.filter((rule) => !replaced.has(rule));
}

// ---------------------------------------------------------------------------
// 3. Suggestions
// ---------------------------------------------------------------------------

const DateOnlySchema = z.string().regex(DATE_ONLY);

/** raise and lower carry a range; too_little_history carries the facts only. */
export const PRICING_ADVICE_KINDS = ["raise", "lower", "too_little_history"] as const;
export const PricingAdviceKindSchema = z.enum(PRICING_ADVICE_KINDS);
export type PricingAdviceKind = z.infer<typeof PricingAdviceKindSchema>;

export const PRICING_ADVICE_DIRECTIONS = ["up", "down", "none"] as const;

/** One reason, in the venue's words, with the records it rests on. */
export const PricingAdviceReasonSchema = z.object({
  text: z.string().min(1).max(400),
  direction: z.enum(PRICING_ADVICE_DIRECTIONS),
  records: z.number().int().nonnegative(),
});
export type PricingAdviceReason = z.infer<typeof PricingAdviceReasonSchema>;

/** A suggestion's key: the rate, the date and what is suggested. Dismissing
 *  it holds while the suggestion says the same; a change of kind shows again. */
export const PRICING_ADVICE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}:(raise|lower|too_little_history)$/u;
export const PricingAdviceKeySchema = z.string().regex(PRICING_ADVICE_KEY);

export function pricingAdviceKey(ruleId: string, date: string, kind: PricingAdviceKind): string {
  return `${ruleId.toLowerCase()}:${date}:${kind}`;
}

export const PricingAdviceItemSchema = z.object({
  key: PricingAdviceKeySchema,
  kind: PricingAdviceKindSchema,
  /** The rate that prices this room, date and time now. */
  ruleId: z.string().uuid(),
  ruleName: z.string(),
  spaceId: z.string().uuid(),
  roomName: z.string(),
  date: DateOnlySchema,
  /** "Evening, 19:00–00:30", "Any time". */
  dayPart: z.string(),
  per: z.enum(["booking", "hour", "head"]),
  currency: z.string().length(3),
  currentMinor: z.number().int().nonnegative(),
  /** The suggested range and its middle, in pence; null when there is too
   *  little history to suggest a figure. */
  lowMinor: z.number().int().nonnegative().nullable(),
  highMinor: z.number().int().nonnegative().nullable(),
  suggestedMinor: z.number().int().nonnegative().nullable(),
  reasons: z.array(PricingAdviceReasonSchema),
  /** Every record the suggestion rests on: bookings, enquiries, accepted
   *  quote lines. */
  records: z.number().int().nonnegative(),
  leadDays: z.number().int().nonnegative(),
  /** Accepting edits the rate itself when it is already this date's own
   *  rate; otherwise a rate for this date is added beside the everyday one. */
  accept: z.enum(["edit", "add_dated"]),
});
export type PricingAdviceItem = z.infer<typeof PricingAdviceItemSchema>;

export const PricingAdviceSchema = z.object({
  computedAt: z.string().datetime({ offset: true }),
  timezone: z.string(),
  from: DateOnlySchema,
  through: DateOnlySchema,
  /** The first date the venue's own book holds anything; null for none. */
  recordsBegin: DateOnlySchema.nullable(),
  basis: z.object({
    bookings: z.number().int().nonnegative(),
    enquiries: z.number().int().nonnegative(),
    acceptedQuoteLines: z.number().int().nonnegative(),
  }),
  /** Provisional holds that went on to be confirmed, of those decided. */
  conversion: z.object({ confirmed: z.number().int().nonnegative(), decided: z.number().int().nonnegative() }).nullable(),
  /** Room, date and time combinations looked at. */
  checked: z.number().int().nonnegative(),
  /** Of those, how many the current rate suits. */
  rateHolds: z.number().int().nonnegative(),
  /** Of those, how many the venue's record is too thin to judge. */
  tooLittleHistory: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  /** Suggestions found, before the list is cut to its first page. */
  total: z.number().int().nonnegative(),
  items: z.array(PricingAdviceItemSchema),
});
export type PricingAdvice = z.infer<typeof PricingAdviceSchema>;

export const PricingAdviceDismissalSchema = z.object({ key: PricingAdviceKeySchema }).strict();
export type PricingAdviceDismissal = z.infer<typeof PricingAdviceDismissalSchema>;
