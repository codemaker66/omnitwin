/**
 * The planner's kit: the guest list model and the rules every other part of
 * the kit relies on. A guest is a name, a party, a table and a seat, and
 * nothing else. The list lives in the planner's own browser and is never sent
 * anywhere, so nothing here talks to a server.
 *
 * Schemas are strict objects: a record carrying any other field is refused.
 * No message or thrown value here carries a guest's text.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const GUEST_NAME_MAX = 80;
export const PARTY_MAX = 60;
export const GUESTS_MAX = 600;
export const TABLES_MAX = 80;

export const SEATS_MIN = 1;
export const SEATS_MAX = 24;
export const SEATS_DEFAULT = 10;

export const LIST_VERSION = 1;

/** A list is removed this many days after its event date. */
export const KEEP_DAYS_AFTER_EVENT = 30;
/** With no event date, a list is removed this many days after its last change. */
export const KEEP_DAYS_AFTER_CHANGE = 90;

const TABLE_NUMBER_MAX = 999;
const TABLE_NAME_MAX = 60;
const TITLE_MAX = 120;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const GuestSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(GUEST_NAME_MAX),
  party: z.string().max(PARTY_MAX),
  tableId: z.uuid().nullable(),
  seat: z.number().int().min(SEATS_MIN).max(SEATS_MAX).nullable(),
});

export const KitTableSchema = z.strictObject({
  id: z.uuid(),
  number: z.number().int().min(1).max(TABLE_NUMBER_MAX),
  name: z.string().max(TABLE_NAME_MAX),
  seats: z.number().int().min(SEATS_MIN).max(SEATS_MAX),
});

/** "YYYY-MM-DD" that names a real calendar day (2027-02-30 is refused). */
const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  });

export const GuestListSchema = z.strictObject({
  version: z.literal(LIST_VERSION),
  planId: z.uuid(),
  title: z.string().max(TITLE_MAX),
  eventDate: CalendarDateSchema.nullable(),
  sortBy: z.enum(["last-word", "first-word"]),
  guests: z.array(GuestSchema).max(GUESTS_MAX),
  tables: z.array(KitTableSchema).max(TABLES_MAX),
  paperVersion: z.number().int().min(0),
  changedSincePrint: z.boolean(),
  printedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type Guest = z.infer<typeof GuestSchema>;
export type KitTable = z.infer<typeof KitTableSchema>;
export type GuestList = z.infer<typeof GuestListSchema>;

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function emptyGuestList(planId: string, nowIso: string): GuestList {
  return {
    version: LIST_VERSION,
    planId,
    title: "",
    eventDate: null,
    sortBy: "last-word",
    guests: [],
    tables: [],
    paperVersion: 0,
    changedSincePrint: false,
    printedAt: null,
    updatedAt: nowIso,
  };
}

/**
 * Put right any guest whose seating cannot stand: the table is gone, the table
 * is held with no seat, the seat is beyond the table's seats, or the seat is
 * already held by an earlier guest in list order. Such a guest goes back to
 * "to seat" (no table, no seat) and is counted; repair never invents a seat.
 * A seat on a guest with no table is cleared without being counted, as that
 * guest was never seated. After repair, every guest has both a table and a
 * seat, or neither. Guests are never reordered; the input is not changed.
 */
export function repairGuestList(
  list: GuestList,
): { readonly list: GuestList; readonly unseated: number } {
  const seatsByTable = new Map<string, number>();
  for (const table of list.tables) {
    if (!seatsByTable.has(table.id)) seatsByTable.set(table.id, table.seats);
  }

  const taken = new Set<string>();
  let unseated = 0;

  const guests = list.guests.map((guest): Guest => {
    if (guest.tableId === null) {
      return guest.seat === null ? guest : { ...guest, seat: null };
    }
    const seats = seatsByTable.get(guest.tableId);
    if (seats === undefined) {
      unseated += 1;
      return { ...guest, tableId: null, seat: null };
    }
    if (guest.seat === null) {
      unseated += 1;
      return { ...guest, tableId: null };
    }
    const key = `${guest.tableId}:${String(guest.seat)}`;
    if (guest.seat > seats || taken.has(key)) {
      unseated += 1;
      return { ...guest, tableId: null, seat: null };
    }
    taken.add(key);
    return guest;
  });

  return { list: { ...list, guests }, unseated };
}

/**
 * The calendar day (UTC, "YYYY-MM-DD") on which the list is removed, and which
 * rule set it: 30 days after the event date, or, with no date, 90 days after
 * the last change. The sweep removes the list from the start of that day
 * (00:00 UTC), so the page says "removed on" that day.
 */
export function deleteAfter(
  list: GuestList,
): { readonly dateIso: string; readonly rule: "event" | "change" } {
  if (list.eventDate !== null) {
    return {
      dateIso: new Date(removedFromAfterEvent(list.eventDate)).toISOString().slice(0, 10),
      rule: "event",
    };
  }
  const start = Date.parse(list.updatedAt);
  return {
    dateIso: new Date(start + KEEP_DAYS_AFTER_CHANGE * MS_PER_DAY).toISOString().slice(0, 10),
    rule: "change",
  };
}

/** The moment a list dated `eventDate` is removed: 00:00 UTC, 30 days after the event. */
function removedFromAfterEvent(eventDate: string): number {
  return Date.parse(`${eventDate}T00:00:00.000Z`) + KEEP_DAYS_AFTER_EVENT * MS_PER_DAY;
}

/**
 * Whether an event date is refused: a list with that date would be removed at
 * once, because its removal day (30 days after the event, from 00:00 UTC, as
 * the sweep counts it) is today or earlier. A year typed wrong, or as two
 * digits (a date field holds "27" as year 0027), is refused rather than let
 * the next opening of the page remove the whole list. A value that cannot be
 * read as a date is refused too.
 */
export function eventDateRefused(eventDate: string, nowMs: number): boolean {
  return !(nowMs < removedFromAfterEvent(eventDate));
}

/** The earliest event date accepted at `nowMs` ("YYYY-MM-DD", UTC): 29 days before today. */
export function earliestEventDate(nowMs: number): string {
  const today = Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
  return new Date(today - (KEEP_DAYS_AFTER_EVENT - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}
