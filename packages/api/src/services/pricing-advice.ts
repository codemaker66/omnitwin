import {
  dayNumber,
  pricingAdviceKey,
  standingRates,
  type PricingAdvice,
  type PricingAdviceItem,
  type PricingAdviceKind,
  type PricingAdviceReason,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Pricing suggestions (Blake, 17 October 2026): "suggestions to pricing like
// hotels and airways do as their prices change based on demand".
//
// ADVICE, NEVER AUTOMATIC. This module only reads; it returns suggestions and
// writes nothing. A person accepts one by saving a rate in the Pricing desk's
// ordinary form, or dismisses it. Nothing here, and nothing that calls it,
// changes a price by itself.
//
// THE VENUE'S OWN RECORD ONLY. Its inputs are the venue's bookings, enquiries
// and accepted quotes. Competitor prices are deliberately not an input: see
// competitor-prices.ts, and UK CMA guidance on algorithmic pricing.
//
// The method is the established one for function space
// (docs/research/r6-revenue-management.md): demand is judged per room, date
// and day-part (Kimes & McGuire's space-time unit); demand bands follow the
// Cornell case (hot when 80% or more of comparable dates sold, warm from 65%,
// cold below 20%); provisional holds are discounted by the venue's own
// hold-to-confirmed rate (the "wash"); and a 2nd option on a date is read as
// demand the 1st option is displacing. Every signal names the records it
// rests on. Where the record is too thin to size a change the answer is
// "Too little history to suggest a change", never a guess.
//
// Pure: no database, no clock (now is an input), no network.
// ---------------------------------------------------------------------------

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** Venue-local minutes of a day: the evening runs past midnight to 06:00. */
const PART_MINUTES: Readonly<Record<DayPart, readonly [number, number]>> = {
  morning: [6 * 60, 13 * 60],
  afternoon: [13 * 60, 18 * 60],
  evening: [18 * 60, 30 * 60],
};
const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

// --- Thresholds, kept in one place so the tests can name them -------------

/** Comparable past dates needed before a season can be called hot or cold. */
export const MIN_COMPARABLE_DATES = 6;
/** Records (bookings, enquiries, quote lines) a figure must rest on. */
export const MIN_RECORDS = 5;
/** Decided holds needed before the venue's own hold-to-confirmed rate is used. */
export const MIN_DECIDED_HOLDS = 5;
/** A net change smaller than this leaves the rate as it is. */
const NET_FLOOR_PERCENT = 3;
/** Advice never moves a rate further than this. r6 warns against discounting
 *  below about three quarters of the base; lowering stops well short of it. */
const MAX_RAISE_PERCENT = 25;
const MAX_LOWER_PERCENT = 10;
/** How far back the record is read for seasons and the hold-to-confirmed rate. */
const HISTORY_DAYS = 3 * 366;
const CONVERSION_DAYS = 2 * 366;
/** Close-in pickup is judged only this near the date. */
const PICKUP_LEAD_DAYS = 90;
const YEAR_DAYS = 365;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AdviceRoom {
  readonly id: string;
  readonly name: string;
}

export interface AdviceRule {
  readonly id: string;
  readonly name: string;
  readonly spaceId: string | null;
  readonly type: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly appliesFrom: string | null;
  readonly appliesUntil: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly isActive: boolean;
  /** A retired rule still names the room and time of a sale made with it. */
  readonly retired: boolean;
}

export type AdviceBookingKind = "prospect" | "hold" | "ink" | "internal_block";
export type AdviceBookingStatus = "active" | "released" | "expired" | "cancelled" | "lost";

export interface AdviceBooking {
  readonly id: string;
  readonly spaceId: string;
  readonly kind: AdviceBookingKind;
  readonly status: AdviceBookingStatus;
  readonly jointFlag: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  /** It was a provisional hold at some point (now, or before it was
   *  confirmed or let go). */
  readonly wasHold: boolean;
  /** When it stopped being a hold: confirmed or let go. Null while a hold. */
  readonly decidedAt: Date | null;
  /** When it left the book (released, expired, cancelled, lost); set for
   *  every booking that is not active. */
  readonly exitedAt: Date | null;
  readonly enquiryId: string | null;
}

export interface AdviceEnquiry {
  readonly id: string;
  /** Null when the guest named no room. */
  readonly spaceId: string | null;
  readonly preferredDate: string;
  readonly createdAt: Date;
}

/** A line of an accepted quote that came from one of the venue's room rates. */
export interface AdviceSale {
  readonly id: string;
  readonly ruleId: string;
  /** The event's date. */
  readonly date: string;
  readonly unitMinor: number;
}

export interface AdviceInput {
  readonly now: Date;
  readonly timeZone: string;
  /** Days ahead to look at, from tomorrow. */
  readonly horizonDays: number;
  readonly rooms: readonly AdviceRoom[];
  readonly rules: readonly AdviceRule[];
  readonly bookings: readonly AdviceBooking[];
  readonly enquiries: readonly AdviceEnquiry[];
  readonly sales: readonly AdviceSale[];
  /** Keys a person has dismissed. */
  readonly dismissed: ReadonlySet<string>;
  /** The most suggestions returned. */
  readonly limit: number;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic, venue-local
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  formatters.set(timeZone, made);
  return made;
}

export interface LocalStamp {
  /** Days since 1970-01-01 of the venue-local calendar date. */
  readonly day: number;
  /** Minutes since that local midnight. */
  readonly minute: number;
}

/** An instant as the venue's clock and calendar read it. */
export function localStamp(instant: Date, timeZone: string): LocalStamp {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "00";
  const day = dayNumber(`${value("year")}-${value("month")}-${value("day")}`);
  if (day === null) throw new Error("Unreadable local date");
  return { day, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 is Sunday, as Date#getUTCDay counts. 1970-01-01 was a Thursday. */
export function weekdayOfDay(day: number): number {
  return (((day % 7) + 7) + 4) % 7;
}

function monthOfDay(day: number): { readonly year: number; readonly month: number } {
  const date = new Date(day * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function firstOfMonth(year: number, month: number): number | null {
  return dayNumber(`${String(year)}-${String(month + 1).padStart(2, "0")}-01`);
}

/** Meteorological seasons, as a venue talks about them: 0 winter (Dec–Feb),
 *  1 spring, 2 summer, 3 autumn. */
function seasonOfMonth(month: number): number {
  return Math.floor(((month + 1) % 12) / 3);
}

/** The last day before today that falls on this weekday. */
function lastWeekdayBefore(today: number, weekday: number): number {
  return today - 1 - ((weekdayOfDay(today - 1) - weekday + 7) % 7);
}

// ---------------------------------------------------------------------------
// Day-parts
// ---------------------------------------------------------------------------

function minutesOfClock(time: string): number | null {
  const match = /^(\d{2}):(\d{2})/u.exec(time);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** The day-parts a rule's time of day covers; a rule with none covers all. */
export function partsOfWindow(appliesFrom: string | null, appliesUntil: string | null): readonly DayPart[] {
  if (appliesFrom === null || appliesUntil === null) return DAY_PARTS;
  const fromFace = minutesOfClock(appliesFrom);
  const untilFace = minutesOfClock(appliesUntil);
  if (fromFace === null || untilFace === null) return DAY_PARTS;
  // A window starting in the small hours belongs to the evening before, as
  // the evening runs to 06:00.
  const shift = fromFace < PART_MINUTES.morning[0] ? MINUTES_PER_DAY : 0;
  const from = fromFace + shift;
  const until = (untilFace > fromFace ? untilFace : untilFace + MINUTES_PER_DAY) + shift;
  const parts = DAY_PARTS.filter((part) => {
    const [a, b] = PART_MINUTES[part];
    return Math.min(until, b) - Math.max(from, a) > 0;
  });
  return parts.length === 0 ? DAY_PARTS : parts;
}

/** The (day, day-part) slots an occupation of the room covers. */
export function occupiedSlots(start: LocalStamp, end: LocalStamp): readonly { readonly day: number; readonly part: DayPart }[] {
  const startAbs = start.day * MINUTES_PER_DAY + start.minute;
  const endAbs = end.day * MINUTES_PER_DAY + end.minute;
  if (endAbs <= startAbs) return [];
  const slots: { day: number; part: DayPart }[] = [];
  // A booking mistakenly spanning weeks would otherwise fill the calendar.
  const lastDay = Math.min(end.day, start.day + 7);
  for (let day = start.day - 1; day <= lastDay; day += 1) {
    for (const part of DAY_PARTS) {
      const [a, b] = PART_MINUTES[part];
      const overlap = Math.min(endAbs, day * MINUTES_PER_DAY + b) - Math.max(startAbs, day * MINUTES_PER_DAY + a);
      if (overlap > 0) slots.push({ day, part });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const SEASONS = ["winter", "spring", "summer", "autumn"] as const;

function partsKey(parts: readonly DayPart[]): string {
  return parts.join("+");
}

/** "evenings", "daytimes"; empty for a whole date. */
function partsNoun(parts: readonly DayPart[]): string {
  const key = partsKey(parts);
  if (key === "evening") return "evenings";
  if (key === "morning") return "mornings";
  if (key === "afternoon") return "afternoons";
  if (key === "morning+afternoon") return "daytimes";
  if (key === "afternoon+evening") return "afternoons and evenings";
  return "";
}

/** "Saturday evenings", "Saturdays". */
function weekdayPhrase(weekday: number, parts: readonly DayPart[]): string {
  const noun = partsNoun(parts);
  const name = WEEKDAYS[weekday] ?? "";
  return noun === "" ? `${name}s` : `${name} ${noun}`;
}

function capitalised(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

/** "Evening, 19:00–00:30", "Any time". */
function dayPartLabel(rule: AdviceRule, parts: readonly DayPart[]): string {
  if (rule.appliesFrom === null || rule.appliesUntil === null) return "Any time";
  const key = partsKey(parts);
  const word = key === "evening" ? "Evening" : key === "morning" ? "Morning" : key === "afternoon" ? "Afternoon"
    : key === "morning+afternoon" ? "Daytime" : "Day and evening";
  return `${word}, ${rule.appliesFrom.slice(0, 5)}–${rule.appliesUntil.slice(0, 5)}`;
}

export function moneyWords(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

function figure(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Rounding: the steps a rate card is written in
// ---------------------------------------------------------------------------

export function roundingStep(minor: number): number {
  if (minor >= 100_000) return 5_000;
  if (minor >= 20_000) return 1_000;
  if (minor >= 2_000) return 100;
  return 50;
}

function toStep(minor: number, step: number): number {
  return Math.max(0, Math.round(minor / step) * step);
}

// ---------------------------------------------------------------------------
// The record, indexed once
// ---------------------------------------------------------------------------

interface SeasonReading {
  readonly comparable: number;
  readonly sold: number;
  readonly ids: readonly string[];
  readonly phrase: string;
}

interface PaceReading {
  readonly now: number;
  readonly lastYear: number;
  readonly lastYearFinal: number;
  readonly ids: readonly string[];
  readonly monthName: string;
  readonly year: number;
}

interface VenueRecord {
  readonly today: number;
  /** The first event date the venue's book holds. */
  readonly recordsBegin: number | null;
  /** The first day anything was entered: the book was kept from then. */
  readonly keptSince: number | null;
  /** The first day an enquiry arrived through the product. */
  readonly enquiriesSince: number | null;
  readonly slots: ReadonlyMap<string, readonly AdviceBooking[]>;
  readonly enquiriesByDay: ReadonlyMap<number, readonly AdviceEnquiry[]>;
  readonly enquiriesByRoomMonth: ReadonlyMap<string, readonly AdviceEnquiry[]>;
  readonly salesByRoomParts: ReadonlyMap<string, readonly { readonly sale: AdviceSale; readonly rule: AdviceRule; readonly day: number }[]>;
  readonly conversion: { readonly confirmed: number; readonly decided: number } | null;
  readonly bookedEnquiries: ReadonlySet<string>;
  /** Readings shared by every date they describe. */
  readonly seasonMemo: Map<string, SeasonReading | null>;
  readonly paceMemo: Map<string, PaceReading | null>;
  readonly pickupMemo: Map<string, Signal | null>;
  readonly enquiryPaceMemo: Map<string, Signal | null>;
}

function slotKey(spaceId: string, day: number, part: DayPart): string {
  return `${spaceId}|${String(day)}|${part}`;
}

function roomMonthKey(spaceId: string, year: number, month: number): string {
  return `${spaceId}|${String(year)}|${String(month)}`;
}

function earliest(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

function indexRecord(input: AdviceInput): VenueRecord {
  const today = localStamp(input.now, input.timeZone).day;
  const slots = new Map<string, AdviceBooking[]>();
  let recordsBegin: number | null = null;
  let keptSince: number | null = null;
  const bookedEnquiries = new Set<string>();
  for (const booking of input.bookings) {
    if (booking.kind === "prospect") continue;
    const start = localStamp(booking.startsAt, input.timeZone);
    const end = localStamp(booking.endsAt, input.timeZone);
    if (booking.kind !== "internal_block") {
      recordsBegin = earliest(recordsBegin, start.day);
      keptSince = earliest(keptSince, localStamp(booking.createdAt, input.timeZone).day);
    }
    if (booking.enquiryId !== null && booking.status === "active") bookedEnquiries.add(booking.enquiryId);
    for (const slot of occupiedSlots(start, end)) {
      const key = slotKey(booking.spaceId, slot.day, slot.part);
      const list = slots.get(key);
      if (list === undefined) slots.set(key, [booking]);
      else if (!list.includes(booking)) list.push(booking);
    }
  }

  const enquiriesByDay = new Map<number, AdviceEnquiry[]>();
  const enquiriesByRoomMonth = new Map<string, AdviceEnquiry[]>();
  let enquiriesSince: number | null = null;
  for (const enquiry of input.enquiries) {
    const day = dayNumber(enquiry.preferredDate);
    if (day === null) continue;
    enquiriesSince = earliest(enquiriesSince, localStamp(enquiry.createdAt, input.timeZone).day);
    const byDay = enquiriesByDay.get(day);
    if (byDay === undefined) enquiriesByDay.set(day, [enquiry]);
    else byDay.push(enquiry);
    if (enquiry.spaceId === null) continue;
    const { year, month } = monthOfDay(day);
    const key = roomMonthKey(enquiry.spaceId, year, month);
    const byMonth = enquiriesByRoomMonth.get(key);
    if (byMonth === undefined) enquiriesByRoomMonth.set(key, [enquiry]);
    else byMonth.push(enquiry);
  }

  const rulesById = new Map(input.rules.map((rule) => [rule.id, rule] as const));
  const salesByRoomParts = new Map<string, { sale: AdviceSale; rule: AdviceRule; day: number }[]>();
  for (const sale of input.sales) {
    const rule = rulesById.get(sale.ruleId);
    const day = dayNumber(sale.date);
    if (rule === undefined || rule.spaceId === null || day === null) continue;
    const key = `${rule.spaceId}|${partsKey(partsOfWindow(rule.appliesFrom, rule.appliesUntil))}|${rule.type}`;
    const list = salesByRoomParts.get(key);
    if (list === undefined) salesByRoomParts.set(key, [{ sale, rule, day }]);
    else list.push({ sale, rule, day });
  }

  // The venue's own hold-to-confirmed rate over the last two years.
  const since = input.now.getTime() - CONVERSION_DAYS * DAY_MS;
  let confirmed = 0;
  let decided = 0;
  for (const booking of input.bookings) {
    if (!booking.wasHold || booking.decidedAt === null) continue;
    const at = booking.decidedAt.getTime();
    if (at < since || at > input.now.getTime()) continue;
    decided += 1;
    if (booking.kind === "ink") confirmed += 1;
  }

  return {
    today, recordsBegin, keptSince, enquiriesSince, slots, enquiriesByDay, enquiriesByRoomMonth, salesByRoomParts, bookedEnquiries,
    conversion: decided >= MIN_DECIDED_HOLDS ? { confirmed, decided } : null,
    seasonMemo: new Map(), paceMemo: new Map(), pickupMemo: new Map(), enquiryPaceMemo: new Map(),
  };
}

function bookingsOn(record: VenueRecord, spaceId: string, day: number, parts: readonly DayPart[]): AdviceBooking[] {
  const found = new Set<AdviceBooking>();
  for (const part of parts) {
    for (const booking of record.slots.get(slotKey(spaceId, day, part)) ?? []) found.add(booking);
  }
  return [...found];
}

function aliveAt(booking: AdviceBooking, at: number): boolean {
  return booking.createdAt.getTime() <= at && (booking.exitedAt === null || booking.exitedAt.getTime() > at);
}

/** Still undecided at that moment. */
function heldAt(booking: AdviceBooking, at: number): boolean {
  return booking.wasHold && (booking.decidedAt === null || booking.decidedAt.getTime() > at);
}

function confirmedSold(booking: AdviceBooking): boolean {
  return booking.kind === "ink" && booking.status === "active";
}

// ---------------------------------------------------------------------------
// Signals. Each gives a reason with the records it rests on and a weight in
// percent, or nothing when it has nothing to say.
// ---------------------------------------------------------------------------

interface Signal {
  readonly reason: PricingAdviceReason;
  readonly weight: number;
  readonly ids: readonly string[];
  /** A reading of the venue's own past for this kind of date, which a
   *  figure needs before it can be sized. */
  readonly baseline: boolean;
}

function directionOf(weight: number): PricingAdviceReason["direction"] {
  return weight > 0 ? "up" : weight < 0 ? "down" : "none";
}

/** Holds count for less where the venue lets many of them go. */
function conversionFactor(record: VenueRecord): number {
  if (record.conversion === null) return 1;
  return 0.5 + 0.5 * (record.conversion.confirmed / record.conversion.decided);
}

/** A 2nd option (or a joint 1st) is demand the 1st option is displacing. */
function contentionSignal(record: VenueRecord, holds: readonly AdviceBooking[]): Signal | null {
  if (holds.length === 0) return null;
  const ids = holds.map((hold) => hold.id);
  if (holds.length === 1) {
    return { reason: { text: "A 1st option is pencilled on this date.", direction: "none", records: 1 }, weight: 0, ids, baseline: false };
  }
  const joint = holds.some((hold) => hold.jointFlag);
  const text = joint && holds.length === 2
    ? "Joint 1st options: two parties hold this date."
    : holds.length === 2
      ? "A 2nd option is pencilled: two parties want this date."
      : `${String(holds.length)} parties hold options on this date.`;
  const weight = Math.min(16, 8 + 4 * (holds.length - 2)) * conversionFactor(record);
  return { reason: { text, direction: "up", records: holds.length }, weight, ids, baseline: false };
}

/** Enquiries naming this date that have not become a booking yet. */
function enquirySignal(record: VenueRecord, room: AdviceRoom, day: number): Signal | null {
  const asking = (record.enquiriesByDay.get(day) ?? []).filter((enquiry) => !record.bookedEnquiries.has(enquiry.id));
  if (asking.length === 0) return null;
  const forRoom = asking.filter((enquiry) => enquiry.spaceId === room.id).length;
  const asks = counted(asking.length, "enquiry asks", "enquiries ask");
  const text = forRoom === asking.length
    ? `${asks} for this date in the ${room.name}.`
    : forRoom === 0
      ? `${asks} for this date, none of them for the ${room.name}.`
      : `${asks} for this date, ${String(forRoom)} of them for the ${room.name}.`;
  const weight = forRoom >= 2 ? 5 : asking.length >= 3 ? 3 : 0;
  return { reason: { text, direction: directionOf(weight), records: asking.length }, weight, ids: asking.map((enquiry) => enquiry.id), baseline: false };
}

/** Comparable past dates (the same weekday in the same month, else in the
 *  same season) for this room and time, and how many sold. */
function seasonReading(record: VenueRecord, spaceId: string, parts: readonly DayPart[], day: number): SeasonReading | null {
  const weekday = weekdayOfDay(day);
  const { month } = monthOfDay(day);
  const memoKey = `${spaceId}|${partsKey(parts)}|${String(weekday)}|${String(month)}`;
  if (record.seasonMemo.has(memoKey)) return record.seasonMemo.get(memoKey) ?? null;
  const begins = record.recordsBegin;
  const read = (sameMonth: boolean): SeasonReading | null => {
    if (begins === null) return null;
    let comparable = 0;
    let sold = 0;
    const ids: string[] = [];
    const first = Math.max(begins, record.today - HISTORY_DAYS);
    for (let past = lastWeekdayBefore(record.today, weekday); past >= first; past -= 7) {
      const pastMonth = monthOfDay(past).month;
      if (sameMonth ? pastMonth !== month : seasonOfMonth(pastMonth) !== seasonOfMonth(month)) continue;
      comparable += 1;
      const ink = bookingsOn(record, spaceId, past, parts).find(confirmedSold);
      if (ink !== undefined) {
        sold += 1;
        ids.push(ink.id);
      }
    }
    const where = sameMonth ? `in ${MONTHS[month] ?? ""}` : `in ${SEASONS[seasonOfMonth(month)] ?? ""}`;
    return comparable >= MIN_COMPARABLE_DATES ? { comparable, sold, ids, phrase: `${weekdayPhrase(weekday, parts)} ${where}` } : null;
  };
  const reading = read(true) ?? read(false);
  record.seasonMemo.set(memoKey, reading);
  return reading;
}

/** Cornell's bands, read from the venue's own past. */
function seasonSignal(reading: SeasonReading | null): Signal | null {
  if (reading === null) return null;
  const share = reading.sold / reading.comparable;
  const weight = share >= 0.8 ? 10 : share >= 0.65 ? 5 : share < 0.2 ? -5 : 0;
  return {
    reason: {
      text: `${capitalised(reading.phrase)}: ${String(reading.sold)} of ${String(reading.comparable)} booked in the venue's record.`,
      direction: directionOf(weight), records: reading.sold,
    },
    weight, ids: reading.ids, baseline: true,
  };
}

/** What is on the book for this room and time in the date's month, against
 *  what was on it for the same month a year ago at the same distance out,
 *  and how that month ended. Holds count by the venue's hold-to-confirmed
 *  rate (half, until the venue has its own). */
function paceReading(record: VenueRecord, input: AdviceInput, spaceId: string, parts: readonly DayPart[], day: number): PaceReading | null {
  const { year, month } = monthOfDay(day);
  const memoKey = `${spaceId}|${partsKey(parts)}|${String(year)}|${String(month)}`;
  if (record.paceMemo.has(memoKey)) return record.paceMemo.get(memoKey) ?? null;
  const cutoff = input.now.getTime() - YEAR_DAYS * DAY_MS;
  const lastYearFirst = firstOfMonth(year - 1, month);
  const thisYearFirst = firstOfMonth(year, month);
  let reading: PaceReading | null = null;
  // The book must have been kept a year ago, and hold last year's month.
  if (record.keptSince !== null && record.keptSince <= record.today - YEAR_DAYS
    && lastYearFirst !== null && thisYearFirst !== null
    && record.recordsBegin !== null && record.recordsBegin <= lastYearFirst) {
    const share = record.conversion === null ? 0.5 : record.conversion.confirmed / record.conversion.decided;
    const ids = new Set<string>();
    const count = (first: number, at: number | null): number => {
      let total = 0;
      for (let d = first; monthOfDay(d).month === month; d += 1) {
        const on = bookingsOn(record, spaceId, d, parts).filter((booking) => booking.kind !== "internal_block"
          && (at === null ? booking.status === "active" : aliveAt(booking, at)));
        if (on.length === 0) continue;
        const sure = on.some((booking) => booking.kind === "ink" && (at === null || !heldAt(booking, at)));
        total += sure ? 1 : share;
        for (const booking of on) ids.add(booking.id);
      }
      return total;
    };
    const now = count(thisYearFirst, null);
    const lastYear = count(lastYearFirst, cutoff);
    const lastYearFinal = count(lastYearFirst, null);
    reading = { now, lastYear, lastYearFinal, ids: [...ids], monthName: MONTHS[month] ?? "", year };
  }
  record.paceMemo.set(memoKey, reading);
  return reading;
}

function paceSignal(reading: PaceReading | null, roomName: string, parts: readonly DayPart[]): Signal | null {
  if (reading === null) return null;
  const { now, lastYear, lastYearFinal } = reading;
  if (lastYear < 2 && now < 3) return null;
  const noun = partsNoun(parts) === "" ? "dates" : partsNoun(parts);
  const text = `${reading.monthName} ${String(reading.year)}: ${figure(now)} ${noun} in the ${roomName} held or confirmed, against ${figure(lastYear)} at this point last year (${figure(lastYearFinal)} by the end).`;
  let weight = 0;
  if (lastYear >= 2) {
    const ratio = now / lastYear;
    weight = ratio >= 1.3 ? 5 : ratio <= 0.7 ? -5 : 0;
  } else {
    weight = 3;
  }
  return { reason: { text, direction: directionOf(weight), records: reading.ids.length }, weight, ids: reading.ids, baseline: true };
}

/** Enquiries for this room in the date's month, against the same month a
 *  year ago at the same point. */
function enquiryPaceSignal(record: VenueRecord, input: AdviceInput, room: AdviceRoom, day: number): Signal | null {
  const { year, month } = monthOfDay(day);
  const memoKey = roomMonthKey(room.id, year, month);
  if (record.enquiryPaceMemo.has(memoKey)) return record.enquiryPaceMemo.get(memoKey) ?? null;
  let signal: Signal | null = null;
  if (record.enquiriesSince !== null && record.enquiriesSince <= record.today - YEAR_DAYS) {
    const cutoff = input.now.getTime() - YEAR_DAYS * DAY_MS;
    const thisYear = record.enquiriesByRoomMonth.get(roomMonthKey(room.id, year, month)) ?? [];
    const lastYear = (record.enquiriesByRoomMonth.get(roomMonthKey(room.id, year - 1, month)) ?? [])
      .filter((enquiry) => enquiry.createdAt.getTime() <= cutoff);
    if (lastYear.length >= 3 || thisYear.length >= 4) {
      const ratio = lastYear.length === 0 ? Number.POSITIVE_INFINITY : thisYear.length / lastYear.length;
      const weight = lastYear.length >= 3 ? (ratio >= 1.3 ? 3 : ratio <= 0.7 ? -3 : 0) : 3;
      signal = {
        reason: {
          text: `Enquiries for ${MONTHS[month] ?? ""} ${String(year)} in the ${room.name}: ${String(thisYear.length)} so far, against ${String(lastYear.length)} at this point last year.`,
          direction: directionOf(weight), records: thisYear.length + lastYear.length,
        },
        weight, ids: [...thisYear, ...lastYear].map((enquiry) => enquiry.id), baseline: true,
      };
    }
  }
  record.enquiryPaceMemo.set(memoKey, signal);
  return signal;
}

/** Close to the date with nothing pencilled: how often comparable dates,
 *  still free this far out, were then booked. */
function pickupSignal(record: VenueRecord, input: AdviceInput, spaceId: string, parts: readonly DayPart[], day: number, lead: number): Signal | null {
  if (lead > PICKUP_LEAD_DAYS || record.keptSince === null || record.recordsBegin === null) return null;
  const weekday = weekdayOfDay(day);
  const memoKey = `${spaceId}|${partsKey(parts)}|${String(weekday)}|${String(lead)}`;
  if (record.pickupMemo.has(memoKey)) return record.pickupMemo.get(memoKey) ?? null;
  const first = Math.max(record.recordsBegin, record.keptSince + lead, record.today - 2 * 366);
  let free = 0;
  let booked = 0;
  const ids: string[] = [];
  for (let past = lastWeekdayBefore(record.today, weekday); past >= first; past -= 7) {
    const at = input.now.getTime() - (record.today - past + lead) * DAY_MS;
    const on = bookingsOn(record, spaceId, past, parts).filter((booking) => booking.kind !== "internal_block");
    if (on.some((booking) => aliveAt(booking, at))) continue;
    free += 1;
    const ink = on.find(confirmedSold);
    if (ink !== undefined) {
      booked += 1;
      ids.push(ink.id);
    }
  }
  let signal: Signal | null = null;
  if (free >= MIN_COMPARABLE_DATES) {
    const share = booked / free;
    const weight = share < 0.2 ? -5 : share >= 0.6 ? 3 : 0;
    signal = {
      reason: {
        text: `Of ${String(free)} ${weekdayPhrase(weekday, parts)} still free ${counted(lead, "day", "days")} out, ${String(booked)} ${booked === 1 ? "was" : "were"} then booked.`,
        direction: directionOf(weight), records: booked,
      },
      weight, ids, baseline: true,
    };
  }
  record.pickupMemo.set(memoKey, signal);
  return signal;
}

/** What clients accepted for this room and time in the same month last year. */
function lastYearRateSignal(record: VenueRecord, rule: AdviceRule, parts: readonly DayPart[], day: number): Signal | null {
  if (rule.spaceId === null) return null;
  const { year, month } = monthOfDay(day);
  const lines = (record.salesByRoomParts.get(`${rule.spaceId}|${partsKey(parts)}|${rule.type}`) ?? [])
    .filter((entry) => {
      const when = monthOfDay(entry.day);
      return when.year === year - 1 && when.month === month && entry.rule.currency === rule.currency;
    });
  if (lines.length < 2) return null;
  const mean = Math.round(lines.reduce((sum, entry) => sum + entry.sale.unitMinor, 0) / lines.length);
  const above = mean >= rule.amountMinor * 1.05;
  const said = `In ${MONTHS[month] ?? ""} last year it sold at ${moneyWords(mean, rule.currency)} on average (${counted(lines.length, "accepted quote", "accepted quotes")})`;
  return {
    reason: { text: above ? `${said}, above the ${moneyWords(rule.amountMinor, rule.currency)} asked now.` : `${said}.`, direction: above ? "up" : "none", records: lines.length },
    weight: above ? 4 : 0, ids: lines.map((entry) => entry.sale.id), baseline: true,
  };
}

/** Said beside a 2nd option, where it shaped how much the holds count. */
function conversionReason(record: VenueRecord): Signal | null {
  if (record.conversion === null) return null;
  const { confirmed, decided } = record.conversion;
  return {
    reason: {
      text: `${String(Math.round((confirmed / decided) * 10))} in 10 provisional holds here have gone on to be confirmed (${String(decided)} decided in the last two years).`,
      direction: "none", records: decided,
    },
    weight: 0, ids: [], baseline: false,
  };
}

// ---------------------------------------------------------------------------
// One room, date and rate
// ---------------------------------------------------------------------------

type CellOutcome =
  | { readonly kind: "sold" }
  | { readonly kind: "holds" }
  | { readonly kind: "quiet" }
  | { readonly kind: "item"; readonly item: PricingAdviceItem; readonly demand: number };

const PER: Readonly<Record<string, PricingAdviceItem["per"]>> = { flat_rate: "booking", per_hour: "hour", per_head: "head" };

function judgeCell(record: VenueRecord, input: AdviceInput, room: AdviceRoom, rule: AdviceRule, day: number): CellOutcome {
  const parts = partsOfWindow(rule.appliesFrom, rule.appliesUntil);
  const live = bookingsOn(record, room.id, day, parts).filter((booking) => booking.status === "active");
  if (live.some((booking) => booking.kind === "ink" || booking.kind === "internal_block")) return { kind: "sold" };
  const holds = live.filter((booking) => booking.kind === "hold");
  const lead = day - record.today;

  const enquiries = enquirySignal(record, room, day);
  const signals = [
    contentionSignal(record, holds),
    enquiries,
    seasonSignal(seasonReading(record, room.id, parts, day)),
    paceSignal(paceReading(record, input, room.id, parts, day), room.name, parts),
    enquiryPaceSignal(record, input, room, day),
    holds.length === 0 && enquiries === null ? pickupSignal(record, input, room.id, parts, day, lead) : null,
    lastYearRateSignal(record, rule, parts, day),
  ].filter((signal): signal is Signal => signal !== null);
  if (holds.length >= 2) {
    const wash = conversionReason(record);
    if (wash !== null) signals.push(wash);
  }

  const records = new Set(signals.flatMap((signal) => signal.ids)).size;
  const hasBaseline = signals.some((signal) => signal.baseline);
  const moved = signals.some((signal) => signal.weight !== 0);
  const net = Math.max(-MAX_LOWER_PERCENT, Math.min(MAX_RAISE_PERCENT, signals.reduce((sum, signal) => sum + signal.weight, 0)));
  const demand = (holds.length >= 2 ? holds.length : 0) + (enquiries?.reason.records ?? 0);
  const date = dateOfDay(day);
  const base = {
    ruleId: rule.id,
    ruleName: rule.name,
    spaceId: room.id,
    roomName: room.name,
    date,
    dayPart: dayPartLabel(rule, parts),
    per: PER[rule.type] ?? "booking",
    currency: rule.currency,
    currentMinor: rule.amountMinor,
    reasons: signals.map((signal) => signal.reason),
    records,
    leadDays: Math.max(0, lead),
    accept: rule.validFrom === date && rule.validTo === date ? "edit" as const : "add_dated" as const,
  };

  if (!hasBaseline || records < MIN_RECORDS) {
    // Facts without a figure, where a figure would have been asked for: two
    // parties on the date, or enquiries pressing for it.
    const pressing = holds.length >= 2 || (enquiries !== null && enquiries.weight > 0);
    if (!pressing) return { kind: "quiet" };
    return {
      kind: "item", demand,
      item: { ...base, key: pricingAdviceKey(rule.id, date, "too_little_history"), kind: "too_little_history", lowMinor: null, highMinor: null, suggestedMinor: null },
    };
  }
  if (!moved || Math.abs(net) < NET_FLOOR_PERCENT) return { kind: "holds" };

  // The range narrows as the record grows: about ±8% on a thin record,
  // ±2% on thirty records or more. A change inside it is no clear change.
  const halfWidth = 2 + 6 * (1 - Math.min(1, records / 30));
  if (Math.abs(net) <= halfWidth) return { kind: "holds" };
  const step = roundingStep(rule.amountMinor);
  const low = toStep(rule.amountMinor * (1 + (net - halfWidth) / 100), step);
  const high = toStep(rule.amountMinor * (1 + (net + halfWidth) / 100), step);
  const middle = Math.min(high, Math.max(low, toStep(rule.amountMinor * (1 + net / 100), step)));
  const kind: PricingAdviceKind = net > 0 ? "raise" : "lower";
  if (low >= high || (kind === "raise" ? low <= rule.amountMinor : high >= rule.amountMinor)) return { kind: "holds" };
  return {
    kind: "item", demand,
    item: { ...base, key: pricingAdviceKey(rule.id, date, kind), kind, lowMinor: low, highMinor: high, suggestedMinor: middle },
  };
}

// ---------------------------------------------------------------------------
// The whole venue
// ---------------------------------------------------------------------------

const ADVISED_TYPES = new Set(["flat_rate", "per_hour", "per_head"]);

function ruleValidOn(rule: AdviceRule, date: string): boolean {
  if (rule.validFrom !== null && date < rule.validFrom) return false;
  if (rule.validTo !== null && date > rule.validTo) return false;
  return true;
}

/** Suggestions for every priced room, date and time in the horizon. */
export function computePricingAdvice(input: AdviceInput): PricingAdvice {
  const record = indexRecord(input);
  const from = record.today + 1;
  const through = record.today + Math.max(1, input.horizonDays);
  const liveRules = input.rules.filter((rule) => rule.isActive && !rule.retired && rule.spaceId !== null && ADVISED_TYPES.has(rule.type));

  let checked = 0;
  let rateHolds = 0;
  let tooLittleHistory = 0;
  let dismissed = 0;
  const found: PricingAdviceItem[] = [];
  /** Facts-only items: one per room and date, the most pressed. */
  const thin = new Map<string, { readonly item: PricingAdviceItem; readonly demand: number }>();

  for (const room of input.rooms) {
    const roomRules = liveRules.filter((rule) => rule.spaceId === room.id);
    if (roomRules.length === 0) continue;
    for (let day = from; day <= through; day += 1) {
      const date = dateOfDay(day);
      for (const rule of standingRates(roomRules.filter((candidate) => ruleValidOn(candidate, date)))) {
        const outcome = judgeCell(record, input, room, rule, day);
        if (outcome.kind === "sold") continue;
        checked += 1;
        if (outcome.kind === "holds") {
          rateHolds += 1;
        } else if (outcome.kind === "quiet") {
          tooLittleHistory += 1;
        } else if (outcome.item.kind === "too_little_history") {
          tooLittleHistory += 1;
          const key = `${room.id}|${date}`;
          const held = thin.get(key);
          if (held === undefined || outcome.demand > held.demand) thin.set(key, { item: outcome.item, demand: outcome.demand });
        } else {
          found.push(outcome.item);
        }
      }
    }
  }

  const roomOrder = new Map(input.rooms.map((room, index) => [room.id, index] as const));
  const shown = [...found, ...[...thin.values()].map((entry) => entry.item)]
    .filter((item) => {
      if (!input.dismissed.has(item.key)) return true;
      dismissed += 1;
      return false;
    })
    .sort((a, b) => a.date.localeCompare(b.date)
      || (roomOrder.get(a.spaceId) ?? 0) - (roomOrder.get(b.spaceId) ?? 0)
      || a.dayPart.localeCompare(b.dayPart));

  return {
    computedAt: input.now.toISOString(),
    timezone: input.timeZone,
    from: dateOfDay(from),
    through: dateOfDay(through),
    recordsBegin: record.recordsBegin === null ? null : dateOfDay(record.recordsBegin),
    basis: {
      bookings: input.bookings.filter((booking) => booking.kind === "hold" || booking.kind === "ink").length,
      enquiries: input.enquiries.length,
      acceptedQuoteLines: input.sales.length,
    },
    conversion: record.conversion,
    checked,
    rateHolds,
    tooLittleHistory,
    dismissed,
    total: shown.length,
    items: shown.slice(0, Math.max(0, input.limit)),
  };
}
