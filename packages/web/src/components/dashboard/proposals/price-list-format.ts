import type { PricingRule } from "../../../api/pricing.js";
import type { Space } from "../../../api/spaces.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { venueLongDate } from "../../proposal/proposal-document-format.js";
import type { QuoteLineDraft } from "./proposals-desk-format.js";

// ---------------------------------------------------------------------------
// Add from price list (roadmap X1). The venue's price list, offered in the
// composer for the event at hand, so a price is picked rather than typed.
// Each entry adds a quote line: its name, a quantity from the event (one for
// a flat rate, the guests for a price a head, the hours for a price an hour,
// which the booker gives), and its price. A day's or month's adjustment the
// entry carries applies to its own line on the event's date, and is said.
// ---------------------------------------------------------------------------

/** The quote is in pounds; an entry priced otherwise is not offered. */
const QUOTE_CURRENCY = "GBP";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DAY_WORDS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"] as const;
const MONTH_KEYS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const MONTH_WORDS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The event a price is for, as far as it is known. */
export interface PriceListEvent {
  /** The event's room: its entries come first. */
  readonly spaceId: string | null;
  /** YYYY-MM-DD. Entries not priced for it are left out, and a day's or
   *  month's adjustment applies to it. */
  readonly eventDate: string | null;
  readonly guestCount: number | null;
}

/** One entry, priced for the event, and the line it adds. */
export interface PriceListOffer {
  readonly id: string;
  readonly name: string;
  /** "£2,400", "£65 a head, at least 100", "£18 an hour, at least 4 hours". */
  readonly price: string;
  /** "Saturdays: 25% more, so £3,000", or why none is applied; null with none to say. */
  readonly adjustment: string | null;
  readonly line: QuoteLineDraft;
  /** What one of the quantity is: a head, an hour, or the whole (null). */
  readonly per: "head" | "hour" | null;
  /** The quantity is the price's minimum, above the event's guest count. */
  readonly atMinimum: boolean;
  /** What the booker gives for the quantity: the hours, or the guests when
   *  the event has no count yet. */
  readonly asks: "hours" | "guests" | null;
}

export interface PriceListGroup {
  readonly key: string;
  readonly heading: string;
  readonly offers: readonly PriceListOffer[];
}

export interface PriceListView {
  /** The event's room, then the venue-wide entries. */
  readonly first: readonly PriceListGroup[];
  /** Every other room's entries, room by room, in the venue's order; with
   *  the event's room unknown, these are all of them. */
  readonly rooms: readonly PriceListGroup[];
  /** Entries not offered, and why, in sentences. */
  readonly leftOut: readonly string[];
}

/** Pence to the pounds a quote line is typed in: "2400", "81.25". */
function poundsText(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.00$/u, "");
}

/** "£2,400", "£81.25". */
function money(minor: number): string {
  return formatMinorAsCurrency(minor, QUOTE_CURRENCY).replace(/\.00$/u, "");
}

/** Rounds to a whole penny, a tie to the even penny, as the venue's money
 *  engine does (api services/money.ts, roundToInt), so a price adjusted here
 *  is the price the venue's own estimate gives for one. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** "25%", "12.5%". */
function percentWords(multiplier: number): string {
  const percent = Math.round(Math.abs(multiplier - 1) * 1000) / 10;
  return `${String(percent)}%`;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** The weekday and month of a YYYY-MM-DD date, as the calendar has them. */
function dayAndMonth(date: string): { readonly day: number; readonly month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) return null;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== Number(match[2]) - 1) return null;
  return { day: at.getUTCDay(), month: at.getUTCMonth() };
}

/** Whether the entry is priced for the date, by its first and last day. */
function pricedOn(rule: PricingRule, date: string): boolean {
  return (rule.validFrom === null || rule.validFrom <= date) && (rule.validTo === null || rule.validTo >= date);
}

/** "from 1 January 2027", "until 31 March 2027", "1 January 2027 to 31 March 2027". */
function windowWords(rule: PricingRule): string | null {
  const from = venueLongDate(rule.validFrom);
  const to = venueLongDate(rule.validTo);
  if (from !== null && to !== null) return `${from} to ${to}`;
  if (from !== null) return `from ${from}`;
  if (to !== null) return `until ${to}`;
  return null;
}

interface Adjusted {
  readonly unitMinor: number;
  readonly words: string | null;
}

/** The entry's own adjustment for the event's day and month, applied to its
 *  price once and rounded to the penny. Null when an adjustment it carries
 *  cannot be read, so it is not priced without it. */
function adjust(rule: PricingRule, baseMinor: number, date: string | null): Adjusted | null {
  if (rule.dayOfWeekModifiers === undefined || rule.seasonalModifiers === undefined) return null;
  const days = rule.dayOfWeekModifiers ?? {};
  const months = rule.seasonalModifiers ?? {};
  const carries = Object.values(days).some((value) => value !== 1) || Object.values(months).some((value) => value !== 1);
  if (date === null) {
    return { unitMinor: baseMinor, words: carries ? "Some days or months cost more or less; with no date yet, none is applied." : null };
  }
  const when = dayAndMonth(date);
  if (when === null) return { unitMinor: baseMinor, words: null };
  const parts: string[] = [];
  let multiplier = 1;
  const dayFactor = days[DAY_KEYS[when.day] ?? ""];
  if (dayFactor !== undefined && dayFactor !== 1) {
    multiplier *= dayFactor;
    parts.push(`${DAY_WORDS[when.day] ?? ""}: ${percentWords(dayFactor)} ${dayFactor > 1 ? "more" : "less"}`);
  }
  const monthFactor = months[MONTH_KEYS[when.month] ?? ""];
  if (monthFactor !== undefined && monthFactor !== 1) {
    multiplier *= monthFactor;
    parts.push(`${MONTH_WORDS[when.month] ?? ""}: ${percentWords(monthFactor)} ${monthFactor > 1 ? "more" : "less"}`);
  }
  if (parts.length === 0) return { unitMinor: baseMinor, words: null };
  const unitMinor = roundHalfEven(baseMinor * multiplier);
  return { unitMinor, words: `${parts.join("; ")}, so ${money(unitMinor)}` };
}

type Priced =
  | { readonly offered: true; readonly offer: PriceListOffer }
  | { readonly offered: false; readonly why: "currency" | "unreadable" | "guests" | "no_price" };

/** The event with its date as a calendar day, or none: a date in any other
 *  form is not compared, as if there were no date yet. */
function onCalendar(event: PriceListEvent): PriceListEvent {
  return event.eventDate === null || dayAndMonth(event.eventDate) !== null ? event : { ...event, eventDate: null };
}

/** What one entry costs for the event, and the line it adds. */
export function priceEntry(rule: PricingRule, given: PriceListEvent): Priced {
  const event = onCalendar(given);
  if (rule.currency !== QUOTE_CURRENCY) return { offered: false, why: "currency" };
  const amountMinor = parsePoundsToMinor(rule.amount);
  if (amountMinor === null) return { offered: false, why: "unreadable" };
  const window = event.eventDate === null ? windowWords(rule) : null;
  const guests = event.guestCount !== null && event.guestCount > 0 ? event.guestCount : null;
  let baseMinor = amountMinor;
  let quantity: string;
  let price: string;
  let asks: PriceListOffer["asks"] = null;
  let per: PriceListOffer["per"] = null;
  let atMinimum = false;
  switch (rule.type) {
    case "flat_rate":
      quantity = "1";
      price = money(amountMinor);
      break;
    case "per_head": {
      const least = rule.minGuests !== null && rule.minGuests > 0 ? rule.minGuests : null;
      per = "head";
      price = `${money(amountMinor)} a head${least === null ? "" : `, at least ${String(least)}`}`;
      if (guests !== null) {
        atMinimum = least !== null && least > guests;
        quantity = String(Math.max(guests, least ?? 0));
      } else {
        quantity = least === null ? "" : String(least);
        asks = "guests";
      }
      break;
    }
    case "per_hour": {
      const least = rule.minHours !== null && rule.minHours > 0 ? rule.minHours : null;
      per = "hour";
      price = `${money(amountMinor)} an hour${least === null ? "" : `, at least ${String(least)} hour${least === 1 ? "" : "s"}`}`;
      // The proposal holds no times, so the booker gives the hours.
      quantity = least === null ? "" : String(least);
      asks = "hours";
      break;
    }
    case "tiered": {
      if (rule.tiers === undefined) return { offered: false, why: "unreadable" };
      if (rule.tiers === null || rule.tiers.length === 0) return { offered: false, why: "no_price" };
      if (guests === null) return { offered: false, why: "guests" };
      // As the venue's estimate does: the first tier the guests fit, else the highest.
      const tiers = [...rule.tiers].sort((a, b) => a.upTo - b.upTo);
      const fits = tiers.find((tier) => guests <= tier.upTo);
      const tier = fits ?? tiers[tiers.length - 1];
      const tierMinor = tier === undefined ? null : parsePoundsToMinor(tier.amount.toFixed(2));
      if (tier === undefined || tierMinor === null) return { offered: false, why: "no_price" };
      baseMinor = tierMinor;
      quantity = "1";
      price = fits !== undefined
        ? `${money(tierMinor)} for up to ${String(tier.upTo)} guests`
        : `${money(tierMinor)}, the price for the most guests (up to ${String(tier.upTo)})`;
      break;
    }
  }
  const adjusted = adjust(rule, baseMinor, event.eventDate);
  if (adjusted === null) return { offered: false, why: "unreadable" };
  return {
    offered: true,
    offer: {
      id: rule.id,
      name: rule.name,
      price: window === null ? price : `${price}, ${window}`,
      adjustment: adjusted.words,
      line: { description: rule.name, quantity, pounds: poundsText(adjusted.unitMinor) },
      per,
      atMinimum,
      asks,
    },
  };
}

const LEFT_OUT_WORDS: Readonly<Record<"currency" | "unreadable" | "guests" | "no_price", (names: string) => string>> = {
  currency: (names) => `Priced in another currency, and the quote is in pounds: ${names}.`,
  unreadable: (names) => `Could not be read: ${names}.`,
  guests: (names) => `Priced by the guest count, which the event does not have yet: ${names}.`,
  no_price: (names) => `No price set: ${names}.`,
};

/**
 * The venue's price list for the event: its room's entries and the
 * venue-wide ones first, then every other room's, each room under its name.
 * Entries not priced for the event's date, and those that cannot be offered,
 * are said under the list rather than dropped silently.
 */
export function priceListView(rules: readonly PricingRule[], rooms: readonly Space[], given: PriceListEvent): PriceListView {
  const event = onCalendar(given);
  const notOnDate: string[] = [];
  const leftOut = new Map<"currency" | "unreadable" | "guests" | "no_price", string[]>();
  const byRoom = new Map<string | null, PriceListOffer[]>();
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (event.eventDate !== null && !pricedOn(rule, event.eventDate)) {
      notOnDate.push(rule.name);
      continue;
    }
    const priced = priceEntry(rule, event);
    if (!priced.offered) {
      leftOut.set(priced.why, [...(leftOut.get(priced.why) ?? []), rule.name]);
      continue;
    }
    byRoom.set(rule.spaceId, [...(byRoom.get(rule.spaceId) ?? []), priced.offer]);
  }

  const roomName = new Map(rooms.map((room) => [room.id, room.name]));
  const first: PriceListGroup[] = [];
  const own = event.spaceId === null ? undefined : byRoom.get(event.spaceId);
  if (event.spaceId !== null && own !== undefined) {
    first.push({ key: event.spaceId, heading: roomName.get(event.spaceId) ?? "This event's room", offers: own });
  }
  const venueWide = byRoom.get(null);
  if (venueWide !== undefined) first.push({ key: "venue", heading: "Venue-wide", offers: venueWide });

  const others: PriceListGroup[] = [];
  for (const room of rooms) {
    if (room.id === event.spaceId) continue;
    const offers = byRoom.get(room.id);
    if (offers !== undefined) others.push({ key: room.id, heading: room.name, offers });
  }
  // A room the venue no longer lists, or rooms not read: its entries are kept together.
  const unlisted = [...byRoom.entries()]
    .filter(([spaceId]) => spaceId !== null && spaceId !== event.spaceId && !roomName.has(spaceId))
    .flatMap(([, offers]) => offers);
  if (unlisted.length > 0) others.push({ key: "unlisted", heading: "Other rooms", offers: unlisted });

  const said: string[] = [];
  if (notOnDate.length > 0 && event.eventDate !== null) {
    said.push(`Not priced for ${venueLongDate(event.eventDate) ?? event.eventDate}: ${listNames(notOnDate)}.`);
  }
  for (const why of ["guests", "currency", "no_price", "unreadable"] as const) {
    const names = leftOut.get(why);
    if (names !== undefined) said.push(LEFT_OUT_WORDS[why](listNames(names)));
  }
  return { first, rooms: others, leftOut: said };
}

/** What is said as a line is added: "Added Grand Hall hire at £2,400 as
 *  line 3.", "Added Dinner at £65 a head for 120 guests as line 2." and, when
 *  the quantity is the booker's to give, what to enter. The line's number
 *  changes with each, so adding one price twice is said twice. */
export function addedWords(offer: PriceListOffer, lineNumber: number): string {
  const unit = parsePoundsToMinor(offer.line.pounds);
  const at = `${unit === null ? "" : ` at ${money(unit)}`}${offer.per === "head" ? " a head" : offer.per === "hour" ? " an hour" : ""}`;
  const line = ` as line ${String(lineNumber)}`;
  if (offer.asks === "hours") return `Added ${offer.name}${at}${line}. Enter the hours.`;
  if (offer.asks === "guests") return `Added ${offer.name}${at}${line}. Enter the guests.`;
  if (offer.per === "head" && offer.atMinimum) return `Added ${offer.name}${at} for the minimum of ${offer.line.quantity}${line}.`;
  if (offer.per === "head") return `Added ${offer.name}${at} for ${offer.line.quantity} guests${line}.`;
  return `Added ${offer.name}${at}${line}.`;
}
