import { VENUE_TIME_ZONE } from "../../../pages/diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// Words, dates and groupings for the Enquiries desk.
//
// Pure functions: the desk renders what these return, and the tests pin them.
// Dates are British and venue-local (Trades Hall is in Glasgow); a preferred
// event date is a calendar date, so it is formatted without a time zone shift.
// ---------------------------------------------------------------------------

/** The pipeline stages the desk lists, in the order an enquiry moves through them. */
export const DESK_STAGES = ["submitted", "under_review", "approved", "rejected", "withdrawn"] as const;
export type DeskStage = (typeof DESK_STAGES)[number];
export type DeskFilter = DeskStage | "all";

export type StageTone = "new" | "review" | "approved" | "declined" | "withdrawn" | "other";

interface StageWords {
  readonly label: string;
  readonly tone: StageTone;
  /** "3 new enquiries", "1 enquiry in review". */
  readonly count: readonly [singular: string, plural: string];
}

const STAGE_WORDS: Readonly<Record<string, StageWords>> = {
  submitted: { label: "New", tone: "new", count: ["new enquiry", "new enquiries"] },
  under_review: { label: "In review", tone: "review", count: ["enquiry in review", "enquiries in review"] },
  approved: { label: "Approved", tone: "approved", count: ["approved enquiry", "approved enquiries"] },
  rejected: { label: "Declined", tone: "declined", count: ["declined enquiry", "declined enquiries"] },
  withdrawn: { label: "Withdrawn", tone: "withdrawn", count: ["withdrawn enquiry", "withdrawn enquiries"] },
  draft: { label: "Draft", tone: "other", count: ["draft enquiry", "draft enquiries"] },
  archived: { label: "Archived", tone: "other", count: ["archived enquiry", "archived enquiries"] },
};

function stageWords(state: string): StageWords {
  const label = state.replace(/_/gu, " ");
  return STAGE_WORDS[state] ?? { label: label.charAt(0).toUpperCase() + label.slice(1), tone: "other", count: [`${label} enquiry`, `${label} enquiries`] };
}

export function stageLabel(state: string): string {
  return stageWords(state).label;
}

export function stageTone(state: string): StageTone {
  return stageWords(state).tone;
}

/** The singular and plural nouns a count of one stage (or of all) takes. */
export function stageNouns(filter: string): readonly [singular: string, plural: string] {
  return filter === "all" ? ["enquiry", "enquiries"] : stageWords(filter).count;
}

/** "1 new enquiry", "3 enquiries in review", "57 enquiries". */
export function countPhrase(count: number, filter: DeskFilter): string {
  const [singular, plural] = stageNouns(filter);
  return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : plural}`;
}

/** "120 guests", "1 guest". */
export function guestsPhrase(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "guest" : "guests"}`;
}

/** A client's message on one line, or null when they left none. */
export function messageExcerpt(message: string | null): string | null {
  const text = message?.replace(/\s+/gu, " ").trim() ?? "";
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// Calendar parts
//
// Intl supplies the venue-local calendar fields; names come from fixed tables
// so the date tile keeps three-letter months whatever CLDR data a browser has
// ("Sep", not "Sept").
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const RELATIVE = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

interface CalendarParts {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Days since 1970-01-01 of this calendar date. */
  readonly dayNumber: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function calendarParts(ms: number, zone: string): CalendarParts {
  let formatter = partFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
    });
    partFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return { year, month, day, hour: value("hour"), minute: value("minute"), dayNumber: Math.round(Date.UTC(year, month - 1, day) / DAY_MS) };
}

/** Monday = 0. Day 0 (1 Jan 1970) was a Thursday. */
function weekdayIndex(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

function weekdayName(dayNumber: number): string {
  return WEEKDAYS[weekdayIndex(dayNumber)] ?? "";
}

function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

// ---------------------------------------------------------------------------
// Event dates
// ---------------------------------------------------------------------------

export interface EventDateParts {
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
  readonly year: string;
  /** "Sat 6 Jun 2027" */
  readonly full: string;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly dayNumber: number;
}

/** A real calendar date from "2027-06-06" (a time part is ignored), else null. */
function parseCalendarDate(value: string | null): CalendarDate | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value.trim());
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, dayNumber: Math.round(date.getTime() / DAY_MS) };
}

/** The parts of a preferred event date ("2027-06-06"), or null when there is none. */
export function eventDateParts(preferredDate: string | null): EventDateParts | null {
  const date = parseCalendarDate(preferredDate);
  if (date === null) return null;
  const weekday = weekdayName(date.dayNumber);
  return {
    weekday,
    day: String(date.day),
    month: monthName(date.month),
    year: String(date.year),
    full: `${weekday} ${String(date.day)} ${monthName(date.month)} ${String(date.year)}`,
  };
}

const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "Saturday" for a preferred event date, or null. */
export function eventWeekday(preferredDate: string | null): string | null {
  const date = parseCalendarDate(preferredDate);
  return date === null ? null : WEEKDAYS_LONG[weekdayIndex(date.dayNumber)] ?? null;
}

/** How far off the event is from the venue's today: "today", "tomorrow",
 *  "in 5 days", "in 3 weeks", "in 8 months", "in 2 years", or
 *  "date has passed". Null when there is no date. */
export function eventLead(preferredDate: string | null, nowMs: number, zone: string = VENUE_TIME_ZONE): string | null {
  const event = parseCalendarDate(preferredDate);
  if (event === null) return null;
  const today = calendarParts(nowMs, zone);
  const days = event.dayNumber - today.dayNumber;
  if (days < 0) return "date has passed";
  if (days < 14) return RELATIVE.format(days, "day");
  const months = (event.year - today.year) * 12 + (event.month - today.month) - (event.day < today.day ? 1 : 0);
  if (months < 2) return RELATIVE.format(Math.floor(days / 7), "week");
  if (months < 24) return RELATIVE.format(months, "month");
  return RELATIVE.format(Math.floor(months / 12), "year");
}

/** The venue's current year, for leaving it off dates that fall within it. */
export function venueYear(nowMs: number, zone: string = VENUE_TIME_ZONE): number {
  return calendarParts(nowMs, zone).year;
}

// ---------------------------------------------------------------------------
// Moments: received, updated
// ---------------------------------------------------------------------------

const pad = (value: number): string => String(value).padStart(2, "0");

/** "Tue 22 Sep, 09:14" in the venue's time zone. */
export function venueMoment(iso: string, zone: string = VENUE_TIME_ZONE): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const at = calendarParts(ms, zone);
  return `${weekdayName(at.dayNumber)} ${String(at.day)} ${monthName(at.month)}, ${pad(at.hour)}:${pad(at.minute)}`;
}

/** "12 Aug 2026" in the venue's time zone. */
export function venueDate(iso: string, zone: string = VENUE_TIME_ZONE): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const at = calendarParts(ms, zone);
  return `${String(at.day)} ${monthName(at.month)} ${String(at.year)}`;
}

/** "just now", "12 minutes ago", "3 hours ago", "yesterday", "5 days ago", "2 weeks ago", then the date. */
export function relativeAge(iso: string, nowMs: number, zone: string = VENUE_TIME_ZONE): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const elapsed = Math.max(0, nowMs - ms);
  if (elapsed < MINUTE_MS) return "just now";
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 60) return RELATIVE.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const days = calendarDaysBetween(ms, nowMs, zone);
  if (days === 0) return RELATIVE.format(-hours, "hour");
  if (days < 14) return RELATIVE.format(-days, "day");
  if (days < 45) return RELATIVE.format(-Math.floor(days / 7), "week");
  return `on ${venueDate(iso, zone) ?? ""}`;
}

// ---------------------------------------------------------------------------
// Received groups
// ---------------------------------------------------------------------------

function calendarDaysBetween(fromMs: number, toMs: number, zone: string): number {
  return Math.max(0, calendarParts(toMs, zone).dayNumber - calendarParts(fromMs, zone).dayNumber);
}

export interface ReceivedGroup {
  readonly key: string;
  readonly label: string;
}

/** Today, Yesterday, Earlier this week, Last week, then the month it arrived. */
export function receivedGroup(iso: string, nowMs: number, zone: string = VENUE_TIME_ZONE): ReceivedGroup {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { key: "unknown", label: "Date not recorded" };
  const today = calendarParts(nowMs, zone).dayNumber;
  const at = calendarParts(ms, zone);
  const day = at.dayNumber;
  const thisWeekStart = today - weekdayIndex(today);
  if (day >= today) return { key: "today", label: "Today" };
  if (day === today - 1) return { key: "yesterday", label: "Yesterday" };
  if (day >= thisWeekStart) return { key: "this-week", label: "Earlier this week" };
  if (day >= thisWeekStart - 7) return { key: "last-week", label: "Last week" };
  const month = `${MONTHS_LONG[at.month - 1] ?? ""} ${String(at.year)}`;
  return { key: `month-${month}`, label: month };
}

export interface GroupedRows<T> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly T[];
}

/** Consecutive rows that share a received group; the list is newest first, so groups come out in order. */
export function groupByReceived<T extends { readonly createdAt: string }>(rows: readonly T[], nowMs: number, zone: string = VENUE_TIME_ZONE): GroupedRows<T>[] {
  const groups: { key: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const group = receivedGroup(row.createdAt, nowMs, zone);
    const last = groups.at(-1);
    if (last !== undefined && last.key === group.key) last.rows.push(row);
    else groups.push({ key: group.key, label: group.label, rows: [row] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The desk's greeting and opening sentence
// ---------------------------------------------------------------------------

export interface DeskGreeting {
  /** "Thursday 24 September" */
  readonly date: string;
  /** "Good evening, Elaine" */
  readonly greeting: string;
}

/** The venue's date and a greeting for its time of day. */
export function deskGreeting(nowMs: number, fullName: string | null, zone: string = VENUE_TIME_ZONE): DeskGreeting {
  const at = calendarParts(nowMs, zone);
  const date = `${WEEKDAYS_LONG[weekdayIndex(at.dayNumber)] ?? ""} ${String(at.day)} ${MONTHS_LONG[at.month - 1] ?? ""}`;
  const greeting = at.hour < 12 ? "Good morning" : at.hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = fullName?.trim().split(/\s+/u)[0] ?? "";
  return { date, greeting: `${greeting}${firstName === "" ? "" : `, ${firstName}`}` };
}

/** A run of the opening sentence; the counts and the wait are set in bold. */
export type SummaryPart = string | { readonly strong: string; readonly tone?: "new" };

export function summaryText(parts: readonly SummaryPart[]): string {
  return parts.map((part) => typeof part === "string" ? part : part.strong).join("");
}

/** What needs attention now, from the real stage counts. Null until they are known. */
export function deskSummary(input: {
  readonly newCount: number | null;
  readonly reviewCount: number | null;
  readonly longestWaitingCreatedAt: string | null;
  readonly nowMs: number;
}): readonly SummaryPart[] | null {
  const { newCount, reviewCount, longestWaitingCreatedAt, nowMs } = input;
  if (newCount === null || reviewCount === null) return null;
  const review: SummaryPart[] = reviewCount === 0 ? [] : [
    " ", { strong: countPhrase(reviewCount, "under_review") }, ` ${reviewCount === 1 ? "is" : "are"} waiting for a decision.`,
  ];
  if (newCount === 0 && reviewCount === 0) return ["All caught up: nothing is waiting for a first look or a decision."];
  if (newCount === 0) return ["No new enquiries are waiting.", ...review];
  const age = longestWaitingCreatedAt === null ? null : relativeAge(longestWaitingCreatedAt, nowMs);
  return [
    { strong: countPhrase(newCount, "submitted"), tone: "new" },
    ` ${newCount === 1 ? "is" : "are"} waiting for a first look`,
    ...(age === null ? [] : [newCount === 1 ? "; it arrived " : "; the longest-waiting arrived ", { strong: age }]),
    ".",
    ...review,
  ];
}
