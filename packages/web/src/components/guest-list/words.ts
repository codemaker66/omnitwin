/**
 * The planner's kit: the page's words that carry numbers and dates. Counts are
 * put into fixed sentences here so every part of the page says them the same
 * way. Nothing here takes a guest's name.
 */

import type { Taken } from "../../lib/guest-list/parse-paste.js";
import {
  deleteAfter,
  GUEST_NAME_MAX,
  GUESTS_MAX,
  KEEP_DAYS_AFTER_CHANGE,
  KEEP_DAYS_AFTER_EVENT,
  type GuestList,
} from "../../lib/guest-list/model.js";

/** "1 guest", "2 guests". */
export function counted(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

// Calendar days ("YYYY-MM-DD") are UTC days, as the model keeps them.
const CALENDAR_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
// A moment (the print) is told in the planner's own time.
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

function utcDay(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00.000Z`);
}

/** "12 July 2027". */
export function calendarDay(dateIso: string): string {
  return CALENDAR_DAY.format(utcDay(dateIso));
}

/** "12 Jun 2027". */
export function shortDay(dateIso: string): string {
  return SHORT_DAY.format(utcDay(dateIso));
}

/** "Saturday". */
export function weekday(dateIso: string): string {
  return WEEKDAY.format(utcDay(dateIso));
}

/** "Printed 10 November". */
export function printedOn(momentIso: string): string {
  return `Printed ${DAY_MONTH.format(Date.parse(momentIso))}`;
}

/** "172 of 180 guests have a seat." */
export function seatedSentence(seated: number, guests: number): string {
  const verb = seated === 1 || guests === 1 ? "has" : "have";
  return `${String(seated)} of ${counted(guests, "guest", "guests")} ${verb} a seat.`;
}

/** "8 are still to seat." */
export function toSeatSentence(toSeat: number): string {
  return `${String(toSeat)} ${toSeat === 1 ? "is" : "are"} still to seat.`;
}

/** Where the names are kept, and the day they are removed. */
export function keepingLine(list: GuestList): string {
  const { dateIso, rule } = deleteAfter(list);
  const why = rule === "event"
    ? `${String(KEEP_DAYS_AFTER_EVENT)} days after the event`
    : `${String(KEEP_DAYS_AFTER_CHANGE)} days after your last change`;
  return `These names are kept only in this browser, on this device. Nothing is sent to Venviewer. They are removed on ${calendarDay(dateIso)}, ${why}.`;
}

/** Beside the date field, when a date is refused because the list would be removed at once. */
export const DATE_REFUSED =
  `That date would remove this list straight away: a list is removed ${String(KEEP_DAYS_AFTER_EVENT)} days after its event. Check the year.`;

export const NOT_KEPT =
  "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave.";

/** "180 names found. Only names and parties are taken. 1 other column is left on your computer." */
export function foundWords(found: number, droppedColumns: number): string {
  if (found === 0) return "No names were found in what was pasted.";
  const head = `${counted(found, "name", "names")} found. Only names and parties are taken.`;
  if (droppedColumns === 0) return head;
  return `${head} ${counted(droppedColumns, "other column is", "other columns are")} left on your computer.`;
}

/** "3 rows were left out: 1 name over 80 characters, 2 beyond the 600 a list can hold.", or null. */
export function leftOutWords(skipped: Taken["skipped"]): string | null {
  const parts: string[] = [];
  if (skipped.tooLong > 0) {
    parts.push(counted(skipped.tooLong, `name over ${String(GUEST_NAME_MAX)} characters`, `names over ${String(GUEST_NAME_MAX)} characters`));
  }
  if (skipped.overLimit > 0) parts.push(`${String(skipped.overLimit)} beyond the ${String(GUESTS_MAX)} a list can hold`);
  if (skipped.blank > 0) parts.push(`${String(skipped.blank)} with no name`);
  const total = skipped.tooLong + skipped.overLimit + skipped.blank;
  if (total === 0) return null;
  return `${counted(total, "row was", "rows were")} left out: ${parts.join(", ")}.`;
}

/** After a table change: how many guests it sent back to seat. */
export function sentBackWords(sentBack: number): string {
  return `${counted(sentBack, "guest is", "guests are")} now to seat.`;
}
