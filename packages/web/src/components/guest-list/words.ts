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
import type { KitNotice } from "../../stores/guest-list-store.js";

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

/**
 * Where the names are kept, and when they are removed. Removal is done by
 * this browser, when Venviewer next opens in it on or after the removal day
 * (any page of it: the boot sweep, or a guest list page as it opens), so the
 * line says that, and does not give the day as the moment the names go.
 */
export function keepingLine(list: GuestList): string {
  const { dateIso, rule } = deleteAfter(list);
  const why = rule === "event"
    ? `${String(KEEP_DAYS_AFTER_EVENT)} days after the event`
    : `${String(KEEP_DAYS_AFTER_CHANGE)} days after your last change`;
  return `These names are kept only in this browser, on this device. None of them is sent to Venviewer. They are removed ${why}: on or after ${calendarDay(dateIso)}, the next time Venviewer opens in this browser.`;
}

/** Beside the date field, when a date is refused because the list would be removed at once. */
export const DATE_REFUSED =
  `That date would remove this list straight away: a list is removed ${String(KEEP_DAYS_AFTER_EVENT)} days after its event. Check the year.`;

/** This browser cannot keep a list (it has no storage for one), or refused to write it. */
export const NOT_KEPT =
  "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave.";

/** A list may be kept here, but the read of it failed just now: the page has not seen it and does not touch it. */
export const NOT_OPENED =
  "The list kept here for this plan could not be opened just now. Reload the page to try again. Anything added here is not being kept.";

/** The paper before its first print: one wording on both pages. */
export const NOT_YET_PRINTED = "Not yet printed";

/** A save found a copy kept by another tab that this tab had not loaded, and kept this tab's over it. */
export const OTHER_TAB = "This list was also changed in another tab. This tab's version was kept.";

/**
 * The list this tab held is no longer stored, so the tab took an empty one
 * rather than write the names back. The page cannot know which of the two
 * causes it was, so it names both.
 */
export const REMOVED_ELSEWHERE =
  "This list is no longer kept in this browser. It was deleted in another tab, or this browser's stored data was cleared.";

/** The list was deleted in this tab, and a list another tab stored afterwards has been taken up. */
export const ADDED_AFTER_DELETE = "This list was changed in another tab after it was deleted here. It is kept in this browser again.";

/** The sweep this page ran as it opened removed the list, which was past its removal day. */
export const REMOVED_BY_RULE =
  `This list was removed from this browser: a list is removed ${String(KEEP_DAYS_AFTER_EVENT)} days after its event, or ${String(KEEP_DAYS_AFTER_CHANGE)} days after its last change.`;

/** A print's save found another tab's list and gave way to it: the sheet printed was of the copy before. */
export const PRINT_OF_OLDER_COPY =
  "That printout was made from an older copy of this list, which was changed in another tab. Print it again.";

/**
 * A delete asked for in this tab was refused by the device, or could not be seen to have taken.
 * The page still shows the list, so the words do not say again that it is kept.
 */
export const NOT_DELETED = "This list could not be deleted from this browser just now. Try again.";

/** Another tab is at work on this list and has not finished: the change made here waits, and is tried again. */
export const OTHER_TAB_BUSY =
  "Another tab is busy with this list, so your last change is not kept yet. It will be kept as soon as that tab has finished.";

/** The words of a notice from the page's state. Each is a fixed sentence, or a count in one. */
export function noticeWords(notice: Exclude<KitNotice, null>): string {
  switch (notice.kind) {
    case "repaired":
      return `${counted(notice.unseated, "guest was", "guests were")} sent back to seat, because their table or seat was no longer there.`;
    case "other-tab":
      return OTHER_TAB;
    case "removed-elsewhere":
      return REMOVED_ELSEWHERE;
    case "added-after-delete":
      return ADDED_AFTER_DELETE;
    case "removed-by-rule":
      return REMOVED_BY_RULE;
    case "print-of-older-copy":
      return PRINT_OF_OLDER_COPY;
    case "not-deleted":
      return NOT_DELETED;
    case "other-tab-busy":
      return OTHER_TAB_BUSY;
  }
}

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
