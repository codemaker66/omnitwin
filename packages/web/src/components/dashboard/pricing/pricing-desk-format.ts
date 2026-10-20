import { rateReplacements, type PricingAdvice, type PricingAdviceItem } from "@omnitwin/types";
import type { CreatePricingRuleInput, PricingRule, UpdatePricingRuleInput } from "../../../api/pricing.js";
import type { DeskRule, PriceHistoryEntry } from "../../../api/pricing-desk.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { clockFace, describeWindow, readWindowDraft } from "../pricing-rule-window.js";

// ---------------------------------------------------------------------------
// The Pricing desk's words and arithmetic, kept pure so they are tested
// apart from the screen. The desk speaks the venue's language: a rate, the
// time it is for, the dates, who changed it and when; a suggestion, the
// figure, the reasons and the records behind them.
// ---------------------------------------------------------------------------

/** The copper plane's counts; "competitors" is the competitor watch, for
 *  those who set prices. */
export type DeskFilter = "in_use" | "paused" | "suggestions" | "retired" | "competitors";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

function dateParts(date: string): { readonly year: number; readonly month: number; readonly day: number; readonly weekday: number } | null {
  const match = DATE_ONLY.exec(date);
  if (match === null) return null;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth(), day: at.getUTCDate(), weekday: at.getUTCDay() };
}

function isCalendarDate(date: string): boolean {
  return dateParts(date) !== null && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

/** "12 Jun 2027". */
export function dateWords(date: string): string {
  const parts = dateParts(date);
  return parts === null ? date : `${String(parts.day)} ${MONTHS[parts.month] ?? ""} ${String(parts.year)}`;
}

/** "Sat 12 Jun 2027". */
export function dayWords(date: string): string {
  const parts = dateParts(date);
  return parts === null ? date : `${WEEKDAYS[parts.weekday] ?? ""} ${dateWords(date)}`;
}

/** The date tile: "Sat", "12", "Jun". */
export function dateTile(date: string): { readonly weekday: string; readonly day: string; readonly month: string } | null {
  const parts = dateParts(date);
  return parts === null ? null : { weekday: WEEKDAYS[parts.weekday] ?? "", day: String(parts.day), month: MONTHS[parts.month] ?? "" };
}

/** "June 2027": the month a suggestion falls in. */
export function monthHeading(date: string): string {
  const parts = dateParts(date);
  return parts === null ? date : `${MONTHS_LONG[parts.month] ?? ""} ${String(parts.year)}`;
}

/** "17 Oct 2026, 14:32" on the venue's clock. */
export function momentWords(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${date}, ${time}`;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Pence from a rule's "2800.00", exactly. */
export function amountMinor(amount: string): number | null {
  return parsePoundsToMinor(amount);
}

/** "£2,800", "£45.50". */
export function moneyWords(minor: number, currency = "GBP"): string {
  return formatMinorAsCurrency(minor, currency).replace(/\.00$/u, "");
}

/** What one of the price is: "a booking", "a head", "an hour". */
export function perWords(type: PricingRule["type"] | PricingAdviceItem["per"]): string {
  if (type === "per_head" || type === "head") return "a head";
  if (type === "per_hour" || type === "hour") return "an hour";
  if (type === "tiered") return "by guest numbers";
  return "a booking";
}

/** "£2,800", "£45 a head, at least 100 guests", "Tiered by guest numbers". */
export function priceWords(rule: Pick<PricingRule, "amount" | "currency" | "type" | "minGuests" | "minHours">): string {
  if (rule.type === "tiered") return "Tiered by guest numbers";
  const minor = amountMinor(rule.amount);
  const figure = minor === null ? rule.amount : moneyWords(minor, rule.currency);
  if (rule.type === "per_head") return `${figure} a head${rule.minGuests === null ? "" : `, at least ${String(rule.minGuests)} guests`}`;
  if (rule.type === "per_hour") return `${figure} an hour${rule.minHours === null ? "" : `, at least ${String(rule.minHours)} hours`}`;
  return figure;
}

// ---------------------------------------------------------------------------
// When a rate applies
// ---------------------------------------------------------------------------

/** "Every date", "12 Jun 2027 only", "1 Jun 2027 to 30 Jun 2027", "From 1 Jan 2027". */
export function datesWords(rule: Pick<PricingRule, "validFrom" | "validTo">): string {
  const { validFrom, validTo } = rule;
  if (validFrom === null && validTo === null) return "Every date";
  if (validFrom !== null && validTo !== null) {
    return validFrom === validTo ? `${dateWords(validFrom)} only` : `${dateWords(validFrom)} to ${dateWords(validTo)}`;
  }
  return validFrom !== null ? `From ${dateWords(validFrom)}` : `Until ${dateWords(validTo ?? "")}`;
}

/** "19:00–00:30 (past midnight)", "Any time". */
export function timeWords(rule: Pick<PricingRule, "appliesFrom" | "appliesUntil">): string {
  const words = describeWindow(rule);
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

/** The tile on a rate's row: the time it starts and ends, or "Any time". */
export function timeTile(rule: Pick<PricingRule, "appliesFrom" | "appliesUntil">): { readonly from: string; readonly until: string | null } {
  const from = rule.appliesFrom ?? null;
  const until = rule.appliesUntil ?? null;
  if (from === null || until === null) return { from: "Any", until: null };
  return { from: clockFace(from), until: clockFace(until) };
}

// ---------------------------------------------------------------------------
// The list, room by room
// ---------------------------------------------------------------------------

export interface RateGroup {
  readonly key: string;
  readonly heading: string;
  readonly rules: readonly DeskRule[];
}

function startMinute(rule: DeskRule): number {
  const from = rule.appliesFrom ?? null;
  if (from === null) return -1;
  const face = clockFace(from);
  return Number.parseInt(face.slice(0, 2), 10) * 60 + Number.parseInt(face.slice(3, 5), 10);
}

/** The venue's rooms in its own order, then rates for every room; within a
 *  room, by the time of day, then by name. A rate whose room has gone is
 *  listed under "Rooms no longer listed", not hidden. */
export function groupRates(rules: readonly DeskRule[], rooms: readonly { readonly id: string; readonly name: string }[]): RateGroup[] {
  const byTime = (a: DeskRule, b: DeskRule): number => startMinute(a) - startMinute(b) || a.name.localeCompare(b.name, "en-GB");
  const known = new Set(rooms.map((room) => room.id));
  const groups: RateGroup[] = rooms.map((room) => ({
    key: room.id, heading: room.name, rules: rules.filter((rule) => rule.spaceId === room.id).sort(byTime),
  }));
  groups.push({ key: "every-room", heading: "Every room", rules: rules.filter((rule) => rule.spaceId === null).sort(byTime) });
  groups.push({
    key: "gone", heading: "Rooms no longer listed",
    rules: rules.filter((rule) => rule.spaceId !== null && !known.has(rule.spaceId)).sort(byTime),
  });
  return groups.filter((group) => group.rules.length > 0);
}

export function roomName(spaceId: string | null, rooms: readonly { readonly id: string; readonly name: string }[]): string {
  if (spaceId === null) return "Every room";
  return rooms.find((room) => room.id === spaceId)?.name ?? "A room no longer listed";
}

// ---------------------------------------------------------------------------
// Who changed it, and when
// ---------------------------------------------------------------------------

const VERB: Readonly<Record<PriceHistoryEntry["action"], string>> = {
  created: "Added", updated: "Changed", deleted: "Retired", restored: "Brought back",
};

/** One history entry as a line: "Changed by Callum Reid, 17 Oct 2026, 14:32". */
export function changeLine(entry: PriceHistoryEntry, timeZone: string): string {
  const who = entry.by === null ? "by someone no longer on the team" : `by ${entry.by}`;
  return `${VERB[entry.action]} ${who}, ${momentWords(entry.at, timeZone)}`;
}

/** The line under every rate: its latest change, or, for a rate entered
 *  before changes were recorded, that plainly. */
export function lastChangeLine(rule: Pick<DeskRule, "history" | "createdAt">, timeZone: string): string {
  const latest = rule.history[0];
  if (latest !== undefined) return changeLine(latest, timeZone);
  return `Entered ${momentWords(rule.createdAt, timeZone)}; who entered it was not recorded`;
}

/** "Callum Reid or Moira Stewart", or the roles when no one is named. */
export function settersWords(setters: readonly string[]): string {
  if (setters.length === 0) return "an administrator or a manager at the venue";
  if (setters.length === 1) return setters[0] ?? "";
  return `${setters.slice(0, -1).join(", ")} or ${setters[setters.length - 1] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Day and month adjustments
//
// A rate may carry multipliers for days of the week and months ("saturday":
// 1.2), which the estimate and the proposals price list apply on top of its
// price. The desk does not edit them, but it says they are there, because
// the price shown is the price before them.
// ---------------------------------------------------------------------------

export type Adjustments = Readonly<Record<string, number>>;

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_PLURALS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"] as const;
const MONTH_KEYS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;

function adjustedBy(label: string, factor: number): string {
  const percent = Math.round(Math.abs(factor - 1) * 1000) / 10;
  return `${label} ${String(percent)}% ${factor > 1 ? "more" : "less"}`;
}

/** "Saturdays 20% more, December 10% more"; null when the rate carries none. */
export function adjustmentWords(rule: {
  readonly dayOfWeekModifiers?: Adjustments | null;
  readonly seasonalModifiers?: Adjustments | null;
}): string | null {
  const days = rule.dayOfWeekModifiers ?? {};
  const months = rule.seasonalModifiers ?? {};
  const parts: string[] = [];
  DAY_KEYS.forEach((key, index) => {
    const factor = days[key];
    if (factor !== undefined && factor !== 1) parts.push(adjustedBy(DAY_PLURALS[index] ?? key, factor));
  });
  MONTH_KEYS.forEach((key, index) => {
    const factor = months[key];
    if (factor !== undefined && factor !== 1) parts.push(adjustedBy(MONTHS_LONG[index] ?? key, factor));
  });
  return parts.length === 0 ? null : parts.join(", ");
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export type EditableType = PricingRule["type"];

export interface RateDraft {
  /** The day and month adjustments the rate carries, as the rule holds
   *  them. The form does not edit them: a change leaves them as they are,
   *  and a rate added from a suggestion keeps those of the rate it is
   *  based on, so the suggested price moves the same way on every day. */
  readonly dayAdjustments: Adjustments | null;
  readonly monthAdjustments: Adjustments | null;
  readonly name: string;
  readonly type: EditableType;
  /** Pounds as typed: "2800", "45.50". */
  readonly amount: string;
  /** "" for every room. */
  readonly spaceId: string;
  readonly from: string;
  readonly until: string;
  /** "YYYY-MM-DD" or "". */
  readonly validFrom: string;
  readonly validTo: string;
  /** At least this many guests (a price a head) or hours (an hour); "" for none. */
  readonly minimum: string;
  readonly isActive: boolean;
}

export const EMPTY_DRAFT: RateDraft = {
  dayAdjustments: null, monthAdjustments: null,
  name: "", type: "flat_rate", amount: "", spaceId: "", from: "", until: "", validFrom: "", validTo: "", minimum: "", isActive: true,
};

/** "2800.00" as the form shows it: "2800"; "45.50" stays. */
function poundsText(amount: string): string {
  return amount.replace(/\.00$/u, "");
}

export function draftOf(rule: PricingRule): RateDraft {
  const minimum = rule.type === "per_head" ? rule.minGuests : rule.type === "per_hour" ? rule.minHours : null;
  return {
    // The rule's own objects, so two drafts of one rule compare as unchanged.
    dayAdjustments: rule.dayOfWeekModifiers ?? null,
    monthAdjustments: rule.seasonalModifiers ?? null,
    name: rule.name,
    type: rule.type,
    amount: poundsText(rule.amount),
    spaceId: rule.spaceId ?? "",
    from: rule.appliesFrom === null || rule.appliesFrom === undefined ? "" : clockFace(rule.appliesFrom),
    until: rule.appliesUntil === null || rule.appliesUntil === undefined ? "" : clockFace(rule.appliesUntil),
    validFrom: rule.validFrom ?? "",
    validTo: rule.validTo ?? "",
    minimum: minimum === null ? "" : String(minimum),
    isActive: rule.isActive,
  };
}

export type DraftField = "name" | "amount" | "time" | "dates" | "minimum";

export type DraftReading =
  | { readonly ok: true; readonly body: CreatePricingRuleInput }
  | { readonly ok: false; readonly problem: string; readonly field: DraftField };

const WHOLE = /^\d{1,5}$/u;

/** The draft read the way the API will read it, with the first problem in
 *  plain words where there is one. */
export function readDraft(draft: RateDraft): DraftReading {
  const name = draft.name.trim();
  if (name === "") return { ok: false, field: "name", problem: "Give the rate a name, as the price list shows it." };
  if (name.length > 200) return { ok: false, field: "name", problem: "Keep the name to 200 characters." };
  const minor = parsePoundsToMinor(draft.amount);
  if (minor === null) return { ok: false, field: "amount", problem: "Enter the price in pounds, as 2800 or 45.50." };
  const window = readWindowDraft({ from: draft.from, until: draft.until });
  if (window.kind === "half" || window.kind === "invalid") return { ok: false, field: "time", problem: window.message };
  const validFrom = draft.validFrom.trim() === "" ? null : draft.validFrom.trim();
  const validTo = draft.validTo.trim() === "" ? null : draft.validTo.trim();
  for (const date of [validFrom, validTo]) {
    if (date !== null && !isCalendarDate(date)) {
      return { ok: false, field: "dates", problem: "Dates are days on the calendar, as 2027-06-12." };
    }
  }
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    return { ok: false, field: "dates", problem: "The first date comes on or before the last." };
  }
  const minimumText = draft.minimum.trim();
  const counted = draft.type === "per_hour" || draft.type === "per_head";
  if (counted && minimumText !== "" && (!WHOLE.test(minimumText) || Number(minimumText) < 1)) {
    return { ok: false, field: "minimum", problem: draft.type === "per_hour" ? "Enter the fewest hours as a whole number." : "Enter the fewest guests as a whole number." };
  }
  const minimum = !counted || minimumText === "" ? null : Number(minimumText);
  return {
    ok: true,
    body: {
      name,
      type: draft.type,
      amount: minor / 100,
      spaceId: draft.spaceId === "" ? null : draft.spaceId,
      appliesFrom: window.appliesFrom,
      appliesUntil: window.appliesUntil,
      validFrom,
      validTo,
      minHours: draft.type === "per_hour" ? minimum : null,
      minGuests: draft.type === "per_head" ? minimum : null,
      isActive: draft.isActive,
      // Carried, never edited here; a change (changeOf) does not send them.
      ...(draft.dayAdjustments === null ? {} : { dayOfWeekModifiers: draft.dayAdjustments }),
      ...(draft.monthAdjustments === null ? {} : { seasonalModifiers: draft.monthAdjustments }),
    },
  };
}

/** Only what changed goes in a change, so a field left alone is not re-sent. */
export function changeOf(original: RateDraft, body: CreatePricingRuleInput, draft: RateDraft): UpdatePricingRuleInput {
  const windowChanged = draft.from !== original.from || draft.until !== original.until;
  const datesChanged = draft.validFrom !== original.validFrom || draft.validTo !== original.validTo;
  const minimumChanged = draft.minimum !== original.minimum || draft.type !== original.type;
  return {
    ...(draft.name !== original.name ? { name: body.name } : {}),
    ...(draft.type !== original.type ? { type: body.type } : {}),
    ...(draft.amount !== original.amount ? { amount: body.amount } : {}),
    ...(draft.spaceId !== original.spaceId ? { spaceId: body.spaceId ?? null } : {}),
    ...(windowChanged ? { appliesFrom: body.appliesFrom ?? null, appliesUntil: body.appliesUntil ?? null } : {}),
    ...(datesChanged ? { validFrom: body.validFrom ?? null, validTo: body.validTo ?? null } : {}),
    ...(minimumChanged ? { minHours: body.minHours ?? null, minGuests: body.minGuests ?? null } : {}),
    ...(draft.isActive !== original.isActive ? { isActive: body.isActive ?? true } : {}),
  };
}

export function draftChanged(original: RateDraft, draft: RateDraft): boolean {
  return (Object.keys(original) as (keyof RateDraft)[]).some((key) => original[key] !== draft[key]);
}

/** The everyday rate a dated rate would take the place of, on its first date. */
export function replacedBy(body: CreatePricingRuleInput, others: readonly DeskRule[]): DeskRule | null {
  const firstDate = body.validFrom ?? body.validTo ?? null;
  if (firstDate === null || body.isActive === false) return null;
  const candidate = {
    spaceId: body.spaceId ?? null, type: body.type, appliesFrom: body.appliesFrom ?? null, appliesUntil: body.appliesUntil ?? null,
    validFrom: body.validFrom ?? null, validTo: body.validTo ?? null,
  };
  const valid = others
    .filter((rule) => rule.isActive && (rule.validFrom === null || rule.validFrom <= firstDate) && (rule.validTo === null || rule.validTo >= firstDate))
    .map((rule) => ({
      rule,
      fields: {
        spaceId: rule.spaceId, type: rule.type, appliesFrom: rule.appliesFrom ?? null, appliesUntil: rule.appliesUntil ?? null,
        validFrom: rule.validFrom, validTo: rule.validTo,
      },
    }));
  const replacements = rateReplacements([candidate, ...valid.map((entry) => entry.fields)]);
  return valid.find((entry) => replacements.get(entry.fields) === candidate)?.rule ?? null;
}

/** "On Sat 12 Jun 2027", "From 1 Jun 2027 to 30 Jun 2027", "From 1 Jan 2027". */
function whenWords(validFrom: string | null, validTo: string | null): string {
  if (validFrom !== null && validFrom === validTo) return `On ${dayWords(validFrom)}`;
  if (validFrom !== null && validTo !== null) return `From ${dateWords(validFrom)} to ${dateWords(validTo)}`;
  return validFrom !== null ? `From ${dateWords(validFrom)}` : `Until ${dateWords(validTo ?? "")}`;
}

/** What saving does, said before Save. Every sentence is true of the code
 *  that reads rates: a quote copies a rate's figure into its own lines when
 *  it is made (the proposals price list), and enquiry estimates read the
 *  rates as they stand. */
export function consequenceWords(input: {
  readonly mode: "create" | "edit";
  readonly original: RateDraft | null;
  readonly body: CreatePricingRuleInput;
  readonly currency: string;
  /** The venue's other rates on the list, to say which one a dated rate replaces. */
  readonly others: readonly DeskRule[];
}): readonly string[] {
  const { mode, original, body, currency, others } = input;
  const lines: string[] = [];
  const newMinor = Math.round(body.amount * 100);
  if (mode === "edit" && original !== null) {
    const was = parsePoundsToMinor(original.amount);
    if (was !== null && was !== newMinor) lines.push(`${moneyWords(was, currency)} becomes ${moneyWords(newMinor, currency)}.`);
  }
  if (body.isActive === false) {
    lines.push("It stays on the list but is not offered: quotes and estimates do not use it until it is in use again.");
  } else {
    lines.push(mode === "create"
      ? "Quotes made from now, and enquiry estimates, can use this rate. Quotes already made are unchanged."
      : "Quotes made from now, and enquiry estimates, use this rate. Quotes already made keep theirs.");
  }
  const replaced = replacedBy(body, others);
  if (replaced !== null) {
    lines.push(`${whenWords(body.validFrom ?? null, body.validTo ?? null)} it takes the place of “${replaced.name}” (${priceWords(replaced)}).`);
    // The replaced rate's adjustments go with it unless this rate carries them.
    const theirs = adjustmentWords(replaced);
    const ours = adjustmentWords(body);
    if (theirs !== null && ours === theirs) {
      lines.push(`It keeps the same adjustments: ${theirs}.`);
    } else if (theirs !== null) {
      lines.push(`This rate does not carry “${replaced.name}”'s adjustments (${theirs}).`);
    }
  }
  return lines;
}

/** What retiring a rate does, said before it is done. */
export function retireWords(rule: Pick<PricingRule, "name">): string {
  return `“${rule.name}” leaves the price list. Quotes made from now cannot use it; quotes already made keep it. You can bring it back from Retired.`;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** "£3,000–£3,350". */
export function rangeWords(item: PricingAdviceItem): string | null {
  if (item.lowMinor === null || item.highMinor === null) return null;
  return `${moneyWords(item.lowMinor, item.currency)}–${moneyWords(item.highMinor, item.currency)}`;
}

/** The suggestion in the phrase a revenue manager would use. */
export function adviceHeadline(item: PricingAdviceItem): string {
  if (item.kind === "too_little_history" || item.suggestedMinor === null) return "Too little history to suggest a change";
  const figure = moneyWords(item.suggestedMinor, item.currency);
  return item.kind === "raise" ? `Raise to about ${figure}` : `Lower to about ${figure}`;
}

export function adviceKindWords(item: PricingAdviceItem): string {
  return item.kind === "raise" ? "Raise" : item.kind === "lower" ? "Lower" : "Too little history";
}

/** "in 8 months", "in 3 weeks", "tomorrow". */
export function leadWords(days: number): string {
  if (days <= 1) return "tomorrow";
  if (days < 14) return `in ${String(days)} days`;
  if (days < 61) return `in ${String(Math.round(days / 7))} weeks`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `in ${String(months)} months` : `in ${String(Math.round(months / 12))} years`;
}

/** "Rests on 10 records from the venue's own book." */
export function recordsWords(records: number): string {
  return records === 1 ? "Rests on 1 record from the venue's own book." : `Rests on ${records.toLocaleString("en-GB")} records from the venue's own book.`;
}

function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

/** What the venue's record holds, said above the suggestions. */
export function basisWords(advice: PricingAdvice): string {
  const { bookings, enquiries, acceptedQuoteLines } = advice.basis;
  if (advice.recordsBegin === null) {
    return "The venue's book holds no bookings yet, so there is no history to suggest from. Suggestions begin as the book fills.";
  }
  return `Worked out from ${counted(bookings, "booking", "bookings")}, ${counted(enquiries, "enquiry", "enquiries")} and ${counted(acceptedQuoteLines, "accepted quote line", "accepted quote lines")} in the venue's own record, which begins on ${dateWords(advice.recordsBegin)}. Competitors' prices are not used.`;
}

/** The form a suggestion opens, for a person to check and save. */
export function draftFromAdvice(item: PricingAdviceItem, rule: DeskRule): { readonly mode: "create" | "edit"; readonly draft: RateDraft } {
  const base = draftOf(rule);
  const amount = item.suggestedMinor === null ? base.amount : (item.suggestedMinor / 100).toFixed(2).replace(/\.00$/u, "");
  if (item.accept === "edit") return { mode: "edit", draft: { ...base, amount } };
  return {
    mode: "create",
    draft: { ...base, name: `${rule.name}, ${dateWords(item.date)}`, amount, validFrom: item.date, validTo: item.date, isActive: true },
  };
}

/** Suggestions grouped by month, soonest first, as the list shows them. */
export function groupAdvice(items: readonly PricingAdviceItem[]): readonly { readonly key: string; readonly heading: string; readonly items: readonly PricingAdviceItem[] }[] {
  const groups = new Map<string, PricingAdviceItem[]>();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, heading: monthHeading(`${key}-01`), items: list }));
}
