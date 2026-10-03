import {
  ENQUIRY_OCCASION_KEYS,
  MAX_TEMPLATE_LINES,
  MAX_TEMPLATE_NAME_LENGTH,
  occasionLabel,
  occasionPhrase,
  type ProposalTemplate,
  type ProposalTemplateLine,
} from "@omnitwin/types";
import type { PricingRule } from "../../../api/pricing.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { venueLongDate } from "../../proposal/proposal-document-format.js";
import { leftOutWords, priceEntry, priceForEvent, type PriceListEvent, type PriceListOffer, type WhyLeftOut } from "./price-list-format.js";
import { lineHasWords, type ComposerDraft, type QuoteLineDraft } from "./proposals-desk-format.js";

// ---------------------------------------------------------------------------
// Proposal templates in the composer (roadmap X1; Tier B #16). A template
// holds no price: each price-list line is priced from the list as it stands,
// for this event, exactly as Add from price list prices it; a per-head line
// takes this event's guests; a typed line asks for its price. Everything that
// could not be used as saved is said, first what concerns the whole template
// (another room, another occasion), then line by line.
// ---------------------------------------------------------------------------

/** The event a template is used for, as far as it is known. */
export interface TemplateEvent extends PriceListEvent {
  readonly roomName: string | null;
  readonly occasion: string | null;
}

export type ApplyMode = "replace" | "add";

export interface AppliedTemplate {
  readonly draft: ComposerDraft;
  /** "Started from Grand Hall wedding: the message and 5 of its 6 lines." */
  readonly summary: string;
  /** What else to say of the template, in order. */
  readonly said: readonly string[];
  /** What to say of particular lines, by number: true only until the lines
   *  change, so the composer drops them then. */
  readonly lineSaid: readonly string[];
  /** Where the booker goes next: the first line needing something, else the message. */
  readonly focus: { readonly line: number; readonly field: "quantity" | "pounds" } | "message";
}

/** Each once, in the order first met: the same entry twice in a template is
 *  one fact to say. */
function unique(items: readonly string[]): readonly string[] {
  return [...new Set(items)];
}

function listNames(given: readonly string[]): string {
  const names = unique(given);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/**
 * The occasion as templates are matched: an occasion the venue names, by its
 * key ("reception"), whether typed as the key or as its label ("Drinks
 * reception"); any other as typed, trimmed and lower-cased; null for none.
 */
export function occasionKeyOf(text: string | null | undefined): string | null {
  const typed = text?.trim().toLowerCase() ?? "";
  if (typed === "") return null;
  if (ENQUIRY_OCCASION_KEYS.includes(typed)) return typed;
  return ENQUIRY_OCCASION_KEYS.find((key) => occasionLabel(key)?.toLowerCase() === typed) ?? typed;
}

/** The occasion to say: one the venue names by its key, so it is said in the
 *  venue's words; any other as typed. */
function occasionToSay(text: string | null | undefined): string | null {
  const key = occasionKeyOf(text);
  if (key === null) return null;
  return ENQUIRY_OCCASION_KEYS.includes(key) ? key : text?.trim() ?? key;
}

/** "the Grand Hall"; a name that already begins with "The" as it is. */
export function theRoom(name: string): string {
  return /^the\s/iu.test(name) ? name : `the ${name}`;
}

function lineCount(count: number): string {
  return `${String(count)} line${count === 1 ? "" : "s"}`;
}

function hoursWords(hours: number): string {
  return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
}

/** What concerns the whole template: made for another room or occasion. */
function scopeWords(template: ProposalTemplate, event: TemplateEvent): readonly string[] {
  const said: string[] = [];
  if (template.spaceId !== null && template.spaceId !== event.spaceId) {
    const room = template.roomName === null ? "a room no longer listed" : theRoom(template.roomName);
    const eventRoom = event.roomName === null ? "The event has no room yet." : `The event is in ${theRoom(event.roomName)}.`;
    said.push(`This template is for ${room}. ${eventRoom}`);
  }
  const templateOccasion = occasionKeyOf(template.occasion);
  const eventOccasion = occasionKeyOf(event.occasion);
  if (templateOccasion !== null && templateOccasion !== eventOccasion) {
    const theirs = eventOccasion === null ? "The event has no occasion yet."
      : `The event is ${occasionPhrase(occasionToSay(event.occasion)) ?? eventOccasion}.`;
    said.push(`This template is for ${occasionPhrase(occasionToSay(template.occasion)) ?? templateOccasion}. ${theirs}`);
  }
  return said;
}

const NO_DATE_ADJUSTMENT = "Some days or months cost more or less; with no date yet, none is applied.";

interface LinePlan {
  readonly line: QuoteLineDraft;
  /** What to say of this line once its number is known. */
  readonly say: ((lineNumber: number) => string) | null;
  readonly focus: "quantity" | "pounds" | null;
  /** What a quote line already holding it would be called, trimmed and
   *  lower-cased: a typed line's words, or its entry's name now and as the
   *  template saved it. */
  readonly known: readonly string[];
  /** Its entry and the list's offer of it for the event; none for a typed line. */
  readonly entry?: { readonly rule: PricingRule; readonly offer: PriceListOffer };
}

function comparable(words: string): string {
  return words.trim().toLowerCase();
}

/**
 * What the list says beside an entry's price that its line does not show:
 * the dates it is priced for, while the event has none, and that the guests
 * are more than its tiers go up to. Said in the list's own words.
 */
function listQualifiers(rule: PricingRule, offer: PriceListOffer, event: PriceListEvent): readonly string[] {
  // The list's price for the entry as if priced all year: what follows it in
  // the list's price for the event is the dates it is priced for.
  const allYear = rule.validFrom === null && rule.validTo === null ? null : priceEntry({ ...rule, validFrom: null, validTo: null }, event);
  const price = allYear?.offered === true ? allYear.offer.price : offer.price;
  const dates = offer.price.startsWith(`${price}, `) ? offer.price.slice(price.length + 2) : null;
  const guests = event.guestCount ?? 0;
  const beyondTiers = rule.type === "tiered" && rule.tiers !== null && rule.tiers !== undefined && rule.tiers.every((tier) => tier.upTo < guests);
  return [
    ...(dates === null ? [] : [`${rule.name} is priced ${dates}, and the event has no date yet.`]),
    ...(beyondTiers ? [`${rule.name} is ${price}, and the event has ${String(guests)} guests.`] : []),
  ];
}

/** "Grand Hall — Evening Event is priced for the Grand Hall.": entries
 *  priced for a room other than the event's, room by room. */
function otherRoomWords(rules: readonly PricingRule[], event: PriceListEvent, roomName: (spaceId: string) => string | null): readonly string[] {
  const byRoom = new Map<string, string[]>();
  for (const rule of rules) {
    if (rule.spaceId === null || rule.spaceId === event.spaceId) continue;
    byRoom.set(rule.spaceId, [...(byRoom.get(rule.spaceId) ?? []), rule.name]);
  }
  return [...byRoom].map(([spaceId, given]) => {
    const names = unique(given);
    const name = roomName(spaceId);
    return `${listNames(names)} ${names.length === 1 ? "is" : "are"} priced for ${name === null ? "another room" : theRoom(name)}.`;
  });
}

/**
 * Starts the composer from a template, or adds its lines, with the price list
 * as it stands. Replacing takes the template's message, when it has one, and
 * its lines; adding keeps the message and adds the lines not already in the
 * quote: a line there already holds one when it carries its words (for an
 * entry, its name now or as saved), or was added from its entry and its words
 * not changed since. The capacity note is never touched. `roomName` names the
 * room an entry is priced for, when not the event's.
 */
export function applyTemplate(
  template: ProposalTemplate,
  rules: readonly PricingRule[],
  event: TemplateEvent,
  current: ComposerDraft,
  mode: ApplyMode,
  roomName: (spaceId: string) => string | null,
): AppliedTemplate {
  const byId = new Map(rules.map((rule) => [rule.id.toLowerCase(), rule]));
  const gone: string[] = [];
  const notOnDate: string[] = [];
  const leftOut = new Map<WhyLeftOut, string[]>();

  function planLine(saved: ProposalTemplateLine): LinePlan | null {
    if (saved.kind === "typed") {
      return {
        line: { description: saved.description, quantity: String(saved.quantity), pounds: "" },
        say: (n) => `Enter the price for ${saved.description} (line ${String(n)}).`,
        focus: "pounds",
        known: [comparable(saved.description)],
      };
    }
    const rule = byId.get(saved.pricingRuleId);
    if (rule === undefined || !rule.isActive) {
      gone.push(saved.name);
      return null;
    }
    const priced = priceForEvent(rule, event);
    if (!priced.offered) {
      if (priced.why === "not_on_date") notOnDate.push(rule.name);
      else leftOut.set(priced.why, [...(leftOut.get(priced.why) ?? []), rule.name]);
      return null;
    }
    const offer = priced.offer;
    // The offer's line names its entry (listed), so it can be kept as the entry.
    const line = (quantity: string): QuoteLineDraft => ({ ...offer.line, quantity });
    const known = unique([comparable(rule.name), comparable(saved.name)]);
    const plan = (quantity: string, say: LinePlan["say"], focus: LinePlan["focus"]): LinePlan => ({
      line: line(quantity), say, focus, known, entry: { rule, offer },
    });

    if (rule.type !== saved.ruleType) {
      return plan(offer.line.quantity, (n) => `${rule.name} is priced differently since the template was saved. Check line ${String(n)}.`, "quantity");
    }
    switch (rule.type) {
      case "flat_rate":
        return plan(String(saved.quantity ?? 1), null, null);
      case "per_hour": {
        if (saved.quantity === null) {
          return plan(offer.line.quantity, (n) => `Enter the hours for ${rule.name} (line ${String(n)}).`, "quantity");
        }
        const least = rule.minHours !== null && rule.minHours > 0 ? rule.minHours : 0;
        if (saved.quantity >= least) return plan(String(saved.quantity), null, null);
        // Said as it stands: the template may have been saved below it.
        return plan(String(least), (n) => `${rule.name} is at least ${hoursWords(least)}, so line ${String(n)} is ${String(least)}.`, null);
      }
      case "per_head":
      case "tiered":
        if (offer.asks === "guests") {
          return plan(offer.line.quantity, (n) => `Enter the guests for ${rule.name} (line ${String(n)}).`, "quantity");
        }
        if (offer.atMinimum) {
          return plan(offer.line.quantity, (n) => `${rule.name} is for the minimum of ${offer.line.quantity} (line ${String(n)}).`, null);
        }
        return plan(offer.line.quantity, null, null);
    }
  }

  /** The quote line already holding what the plan would add: one carrying its
   *  words, or one added from its entry whose words are unchanged since. */
  function inQuote(plan: LinePlan): QuoteLineDraft | undefined {
    const ruleId = plan.entry?.rule.id.toLowerCase();
    return current.lines.find((line) => plan.known.includes(comparable(line.description))
      || (ruleId !== undefined && line.listed !== undefined && line.listed.description === line.description
        && line.listed.pricingRuleId.toLowerCase() === ruleId));
  }

  const already: string[] = [];
  const plans: LinePlan[] = [];
  for (const saved of template.lines) {
    const plan = planLine(saved);
    if (plan === null) continue;
    const quoted = mode === "add" ? inQuote(plan) : undefined;
    if (quoted !== undefined) {
      already.push(quoted.description.trim());
      continue;
    }
    plans.push(plan);
  }

  const first = mode === "replace" ? 1 : current.lines.length + 1;
  const lineWords = plans.flatMap((plan, index) => (plan.say === null ? [] : [plan.say(first + index)]));
  const focusIndex = plans.findIndex((plan) => plan.focus !== null);
  const focusField = focusIndex === -1 ? null : plans[focusIndex]?.focus ?? null;
  // Only what is added is priced, so only its entries are spoken of: the room
  // each is priced for, what the list says beside its price, its adjustment.
  const entries = plans.flatMap(({ entry }) => (entry === undefined ? [] : [entry]));
  const undated = entries.some(({ offer }) => offer.adjustment === NO_DATE_ADJUSTMENT);
  const entryWords = entries.flatMap(({ rule, offer }) => [
    ...listQualifiers(rule, offer, event),
    ...(offer.adjustment === null || offer.adjustment === NO_DATE_ADJUSTMENT ? [] : [`${rule.name}, ${offer.adjustment}.`]),
  ]);
  // A template whose lines could none of them be used leaves the quote as it
  // was, as one without a message leaves the message.
  const linesKept = mode === "replace" && plans.length === 0;

  const said = unique([
    ...scopeWords(template, event),
    ...(gone.length > 0 ? [`No longer on the price list: ${listNames(gone)}.`] : []),
    ...(notOnDate.length > 0 && event.eventDate !== null
      ? [`Not priced for ${venueLongDate(event.eventDate) ?? event.eventDate}: ${listNames(notOnDate)}.`] : []),
    ...(["guests", "currency", "no_price", "unreadable"] as const).flatMap((why) => {
      const names = leftOut.get(why);
      return names === undefined ? [] : [leftOutWords(why, unique(names))];
    }),
    ...otherRoomWords(entries.map(({ rule }) => rule), event, roomName),
    ...(undated ? ["With no date yet, no day or month adjustments are applied."] : []),
    ...entryWords,
    ...(already.length > 0 ? [`Already in the quote, so not added again: ${listNames(already)}.`] : []),
    ...(linesKept && template.lines.length > 0 && current.lines.length > 0 ? ["None of its lines could be used, so the quote is as it was."] : []),
  ]);

  const newLines = plans.map((plan) => plan.line);
  const usesMessage = mode === "replace" && template.message !== "";
  const draft: ComposerDraft = mode === "replace"
    ? { message: usesMessage ? template.message : current.message, capacityNote: current.capacityNote, lines: linesKept ? current.lines : newLines }
    : { ...current, lines: [...current.lines, ...newLines] };

  return {
    draft,
    summary: summaryWords(template, mode, usesMessage, newLines.length),
    said,
    lineSaid: unique(lineWords),
    focus: focusField === null ? "message" : { line: first - 1 + focusIndex, field: focusField },
  };
}

function summaryWords(template: ProposalTemplate, mode: ApplyMode, usesMessage: boolean, used: number): string {
  const total = template.lines.length;
  if (mode === "add") {
    if (used === 0) return `Nothing was added from ${template.name}.`;
    return used === total ? `Added ${template.name}'s ${lineCount(total)}.` : `Added ${String(used)} of ${template.name}'s ${lineCount(total)}.`;
  }
  const lines = used === total ? `its ${lineCount(total)}` : `${String(used)} of its ${lineCount(total)}`;
  const parts = [...(usesMessage ? ["the message"] : []), ...(used > 0 ? [lines] : [])];
  if (parts.length === 0) return `Nothing from ${template.name} could be used.`;
  return `Started from ${template.name}: ${parts.join(" and ")}.`;
}

// ---------------------------------------------------------------------------
// Save as template
// ---------------------------------------------------------------------------

export interface KeptTemplate {
  readonly lines: readonly ProposalTemplateLine[];
  /** What the template keeps and what it does not, as the form says it. */
  readonly said: readonly string[];
  /** A reason it cannot be kept as it stands, or null. */
  readonly refusal: string | null;
}

/** The name a template is offered under, "Grand Hall wedding", within the
 *  length a name may have. */
export function suggestedTemplateName(roomName: string | null, occasion: string | null): string {
  const label = occasionLabel(occasionToSay(occasion));
  // The venue's own occasions read in lower case after a room ("Grand Hall
  // wedding"); one typed in free keeps its own capitals ("Grand Hall AGM").
  const venues = ENQUIRY_OCCASION_KEYS.includes(occasionKeyOf(occasion) ?? "");
  const occasionWords = label === null ? null : roomName === null || !venues ? label : label.charAt(0).toLowerCase() + label.slice(1);
  const words = [roomName, occasionWords].filter((part): part is string => part !== null && part.trim() !== "");
  const cut = words.join(" ").slice(0, MAX_TEMPLATE_NAME_LENGTH);
  // A cut between the two halves of a character (an emoji) would leave half of it.
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trim();
}

function money(minor: number): string {
  return formatMinorAsCurrency(minor, "GBP").replace(/\.00$/u, "");
}

/** " (it is at least 3 when used)": hours kept below the entry's least,
 *  which using the template raises to it. */
function belowMinimum(rule: PricingRule, hours: number): string {
  const least = rule.minHours !== null && rule.minHours > 0 ? rule.minHours : 0;
  return hours < least ? ` (it is at least ${String(least)} when used)` : "";
}

/**
 * The entry a line carried from a saved version came from, which keeps no
 * such record: the one live entry with its name, the event's room's before
 * the venue-wide ones, that prices it for this event at the line's own
 * price. Two entries of that name, or another price, and it is none.
 */
function carriedEntry(line: QuoteLineDraft, rules: readonly PricingRule[], event: PriceListEvent): PricingRule | undefined {
  const named = rules.filter((rule) => rule.isActive && rule.name === line.description.trim());
  const tiers = [named.filter((rule) => rule.spaceId !== null && rule.spaceId === event.spaceId), named.filter((rule) => rule.spaceId === null)];
  const tier = tiers.find((candidates) => candidates.length > 0);
  if (tier === undefined || tier.length !== 1) return undefined;
  const rule = tier[0];
  if (rule === undefined) return undefined;
  const priced = priceForEvent(rule, event);
  const yours = parsePoundsToMinor(line.pounds);
  return priced.offered && yours !== null && parsePoundsToMinor(priced.offer.line.pounds) === yours ? rule : undefined;
}

/**
 * What a template made from the composer keeps. A line added from the price
 * list, its words unchanged, is kept as the entry, and so is a line carried
 * from a saved version that one entry prices exactly so; a line the booker
 * typed, or one whose words were changed, is kept as typed, its price asked
 * for each time. A quantity is kept only where the event cannot give one.
 */
export function templateFromDraft(
  draft: ComposerDraft,
  rules: readonly PricingRule[],
  event: PriceListEvent,
  spaceId: string | null,
  roomName: (spaceId: string) => string | null,
): KeptTemplate {
  const byId = new Map(rules.map((rule) => [rule.id.toLowerCase(), rule]));
  const listed: string[] = [];
  const typed: string[] = [];
  const differs: string[] = [];
  const roomPrices: PricingRule[] = [];
  const lines: ProposalTemplateLine[] = [];
  for (const line of draft.lines) {
    const description = line.description.trim();
    if (description === "") continue;
    const quantity = Number(line.quantity);
    const whole = Number.isInteger(quantity) && quantity >= 1 ? quantity : null;
    const rule = line.listed === undefined ? carriedEntry(line, rules, event)
      : line.listed.description === line.description ? byId.get(line.listed.pricingRuleId) : undefined;
    if (rule === undefined || !rule.isActive) {
      lines.push({ kind: "typed", description, quantity: whole ?? 1 });
      typed.push(description);
      continue;
    }
    // A line added under one way of pricing whose entry is now priced another
    // way (a head became a flat rate) has a quantity meaning something else:
    // it is not kept, so the template asks for it or takes it from the event.
    const repriced = line.listed !== undefined && line.listed.ruleType !== rule.type;
    const keepsQuantity = (rule.type === "per_hour" || rule.type === "flat_rate") && !repriced;
    const kept = keepsQuantity ? whole : null;
    lines.push({ kind: "price_list", pricingRuleId: rule.id.toLowerCase(), name: rule.name, ruleType: rule.type, quantity: kept });
    listed.push(rule.type === "per_head" || rule.type === "tiered"
      ? `${rule.name}, for the event's guests`
      : rule.type === "per_hour" && kept !== null ? `${rule.name}, ${hoursWords(kept)}${belowMinimum(rule, kept)}` : rule.name);
    if (repriced) differs.push(`${rule.name} is priced differently since it was added, so its quantity is not kept.`);
    if (rule.spaceId !== null && spaceId === null) roomPrices.push(rule);
    const priced = priceForEvent(rule, event);
    const yours = parsePoundsToMinor(line.pounds);
    const theirs = priced.offered ? parsePoundsToMinor(priced.offer.line.pounds) : null;
    if (yours !== null && theirs !== null && yours !== theirs) {
      differs.push(`Your price for ${rule.name}, ${money(yours)}, differs from the list's ${money(theirs)}. The template takes the list's price each time.`);
    }
  }
  const said = unique([
    ...(draft.message.trim() === "" ? [] : ["The message."]),
    ...(listed.length > 0 ? [`From the price list, priced each time it is used: ${unique(listed).join("; ")}.`] : []),
    ...(typed.length > 0 ? [`Typed, with the price entered each time: ${listNames(typed)}.`] : []),
    ...differs,
    ...(draft.capacityNote.trim() === "" ? [] : ["The capacity note is not kept."]),
  ]);
  const firstRoomPrice = roomPrices[0];
  const refusal = lines.length === 0 && draft.message.trim() === ""
    ? "There is nothing to keep yet. Write the message or add a line first."
    : lines.length > MAX_TEMPLATE_LINES
      ? `A template keeps up to ${String(MAX_TEMPLATE_LINES)} lines; this quote has ${String(lines.length)}.`
      : firstRoomPrice !== undefined
        ? `${firstRoomPrice.name} is priced for ${roomPriceWords(firstRoomPrice, roomName)}, so this template needs a room.`
        : null;
  return { lines, said, refusal };
}

function roomPriceWords(rule: PricingRule, roomName: (spaceId: string) => string | null): string {
  const name = rule.spaceId === null ? null : roomName(rule.spaceId);
  return name === null ? "one room" : theRoom(name);
}

// ---------------------------------------------------------------------------
// The list of templates
// ---------------------------------------------------------------------------

/** Whether the composer holds words a template would replace: a message or
 *  any line written in (words, a price or a quantity), carried from the last
 *  version or typed here. */
export function hasWords(draft: ComposerDraft): boolean {
  return draft.message.trim() !== "" || draft.lines.some(lineHasWords);
}

/** What a template would replace: "The composer already has a message and
 *  3 lines." Said before asking, so Replace sets aside nothing unnamed. */
export function wordsInComposer(draft: ComposerDraft): string {
  const lines = draft.lines.filter(lineHasWords).length;
  const parts = [...(draft.message.trim() === "" ? [] : ["a message"]), ...(lines > 0 ? [lineCount(lines)] : [])];
  return `The composer already has ${parts.length === 0 ? "nothing" : parts.join(" and ")}.`;
}

/** "Grand Hall · Wedding", "Any room · Any occasion". */
export function templateScope(template: ProposalTemplate): string {
  const room = template.spaceId === null ? "Any room" : template.roomName ?? "A room no longer listed";
  return `${room} · ${occasionLabel(occasionToSay(template.occasion)) ?? "Any occasion"}`;
}

/** "The message and 6 lines", "3 lines", "The message"; one that cannot be read, said. */
export function templateContents(template: ProposalTemplate): string {
  if (!template.readable) return "It can no longer be read, so it can only be removed";
  const lines = template.lines.length;
  if (template.message !== "" && lines > 0) return `The message and ${lineCount(lines)}`;
  return template.message !== "" ? "The message" : lineCount(lines).charAt(0).toUpperCase() + lineCount(lines).slice(1);
}

export interface TemplateGroup {
  readonly key: "event" | "other";
  readonly heading: string;
  readonly rows: readonly { readonly template: ProposalTemplate; readonly reason: string | null }[];
}

/** How closely a template fits the event: its room and occasion, its room,
 *  its occasion, then any room and any occasion. Null when it is for another
 *  room or occasion, or cannot be read. */
function fit(template: ProposalTemplate, event: TemplateEvent | null): number | null {
  if (!template.readable || event === null) return null;
  const occasion = occasionKeyOf(template.occasion);
  const room = template.spaceId === null ? "any" : template.spaceId === event.spaceId ? "same" : "other";
  const kind = occasion === null ? "any" : occasion === occasionKeyOf(event.occasion) ? "same" : "other";
  if (room === "other" || kind === "other") return null;
  if (room === "same" && kind === "same") return 0;
  if (room === "same") return 1;
  if (kind === "same") return 2;
  return 3;
}

/** Why a template is not among this event's: for another room or occasion. */
function otherReason(template: ProposalTemplate, event: TemplateEvent | null): string | null {
  if (!template.readable) return null;
  if (template.spaceId !== null && !template.roomListed) return "Its room is no longer listed";
  if (event === null) return null;
  if (template.spaceId !== null && template.spaceId !== event.spaceId) {
    return `For ${template.roomName === null ? "another room" : theRoom(template.roomName)}`;
  }
  const occasion = occasionKeyOf(template.occasion);
  if (occasion !== null && occasion !== occasionKeyOf(event.occasion)) return `For ${occasionPhrase(occasionToSay(template.occasion)) ?? occasion}`;
  return null;
}

/** "For this event", closest first and then by name, and "Other templates",
 *  each with why it is not this event's. */
export function templateGroups(templates: readonly ProposalTemplate[], event: TemplateEvent | null): readonly TemplateGroup[] {
  const byName = (a: ProposalTemplate, b: ProposalTemplate): number => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
  const fitting = templates.flatMap((template) => {
    const rank = fit(template, event);
    return rank === null ? [] : [{ template, rank }];
  }).sort((a, b) => a.rank - b.rank || byName(a.template, b.template));
  const others = templates.filter((template) => fit(template, event) === null).sort(byName);
  const groups: TemplateGroup[] = [];
  if (fitting.length > 0) groups.push({ key: "event", heading: "For this event", rows: fitting.map(({ template }) => ({ template, reason: null })) });
  if (others.length > 0) {
    groups.push({
      key: "other",
      heading: fitting.length > 0 ? "Other templates" : "Templates",
      rows: others.map((template) => ({ template, reason: otherReason(template, event) })),
    });
  }
  return groups;
}
