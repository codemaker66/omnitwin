/**
 * The planner's kit: what is printed. These functions turn a guest list into
 * the lines the paper page shows (the table plan A to Z, each table's guests,
 * covers, place cards) and nothing more; the page renders their output and
 * decides nothing itself.
 *
 * A guest is seated when the guest holds a seat at a table that is in the list.
 * A guest whose table is not in the list counts as not seated, never an error.
 * None of these functions throws, and none puts a guest's text anywhere but in
 * the value it returns.
 */

import type { Guest, GuestList, KitTable } from "./model.js";

export type Sheet = "table-plan" | "by-table" | "place-cards" | "covers";

type SortBy = GuestList["sortBy"];

const LOCALE = "en-GB";
/** Orders accents and case together, as a reader expects. */
const BASE_ORDER = new Intl.Collator(LOCALE, { sensitivity: "base" });
/** Breaks a tie: accents and case count. */
const FULL_ORDER = new Intl.Collator(LOCALE);

const NOT_A_LETTER = "#";

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

function wordsOf(name: string): readonly string[] {
  return name.split(/\s+/).filter((word) => word !== "");
}

/**
 * The text a name is ordered by. For "last-word" the last word comes first and
 * the rest follow ("Ailsa Jean Fraser" is "Fraser Ailsa Jean"); a one-word name
 * is its own key. For "first-word" the name is ordered as written.
 */
export function sortKey(name: string, sortBy: SortBy): string {
  const words = wordsOf(name);
  if (sortBy === "first-word") return words.join(" ");
  const last = words[words.length - 1];
  if (last === undefined) return "";
  return [last, ...words.slice(0, -1)].join(" ");
}

/**
 * The name as the table plan prints it: "Fraser, Ailsa Jean" for "last-word",
 * the name as written for "first-word", and a one-word name as it is.
 */
export function planLabel(name: string, sortBy: SortBy): string {
  if (sortBy === "first-word") return name;
  const words = wordsOf(name);
  const last = words[words.length - 1];
  if (last === undefined) return name;
  if (words.length === 1) return last;
  return `${last}, ${words.slice(0, -1).join(" ")}`;
}

/** The upper-cased first letter of a key, accents folded; `#` when it is not a letter. */
function groupLetter(key: string): string {
  const folded = key.normalize("NFD").replace(/\p{M}/gu, "");
  const first = Array.from(folded)[0];
  if (first === undefined || !/^\p{L}$/u.test(first)) return NOT_A_LETTER;
  return Array.from(first.toUpperCase())[0] ?? NOT_A_LETTER;
}

// ---------------------------------------------------------------------------
// Who is seated where
// ---------------------------------------------------------------------------

export interface SeatedGuest {
  readonly guest: Guest;
  readonly table: KitTable;
  readonly seat: number;
}

/**
 * The guests who hold a seat at a table that is in the list, in list order,
 * with that table and seat. The other sheets and the downloadable list read
 * seating only through this, so they always agree.
 */
export function seatedGuests(list: GuestList): readonly SeatedGuest[] {
  const tables = new Map<string, KitTable>();
  for (const table of list.tables) {
    if (!tables.has(table.id)) tables.set(table.id, table);
  }
  const seated: SeatedGuest[] = [];
  for (const guest of list.guests) {
    if (guest.tableId === null || guest.seat === null) continue;
    const table = tables.get(guest.tableId);
    if (table === undefined) continue;
    seated.push({ guest, table, seat: guest.seat });
  }
  return seated;
}

function byTableNumber(a: KitTable, b: KitTable): number {
  return a.number - b.number;
}

// ---------------------------------------------------------------------------
// The sheets
// ---------------------------------------------------------------------------

export function tablePlanAZ(list: GuestList): {
  readonly groups: readonly {
    readonly letter: string;
    readonly entries: readonly { readonly label: string; readonly table: number }[];
  }[];
  readonly notSeated: number;
} {
  const seated = seatedGuests(list);
  const entries = seated
    .map(({ guest, table }) => ({
      key: sortKey(guest.name, list.sortBy),
      label: planLabel(guest.name, list.sortBy),
      table: table.number,
    }))
    .sort((a, b) => BASE_ORDER.compare(a.key, b.key) || FULL_ORDER.compare(a.label, b.label));

  const byLetter = new Map<string, { label: string; table: number }[]>();
  for (const entry of entries) {
    const letter = groupLetter(entry.key);
    const group = byLetter.get(letter) ?? [];
    group.push({ label: entry.label, table: entry.table });
    byLetter.set(letter, group);
  }

  const groups = [...byLetter.entries()]
    .sort(([a], [b]) => {
      if (a === NOT_A_LETTER) return b === NOT_A_LETTER ? 0 : -1;
      if (b === NOT_A_LETTER) return 1;
      return BASE_ORDER.compare(a, b);
    })
    .map(([letter, group]) => ({ letter, entries: group }));

  return { groups, notSeated: list.guests.length - seated.length };
}

export function byTable(list: GuestList): readonly {
  readonly number: number;
  readonly name: string;
  readonly seats: number;
  readonly guests: readonly { readonly seat: number; readonly name: string }[];
}[] {
  const seatedAt = new Map<string, { seat: number; name: string }[]>();
  for (const { guest, table, seat } of seatedGuests(list)) {
    const at = seatedAt.get(table.id) ?? [];
    at.push({ seat, name: guest.name });
    seatedAt.set(table.id, at);
  }
  return [...list.tables].sort(byTableNumber).map((table) => ({
    number: table.number,
    name: table.name,
    seats: table.seats,
    guests: [...(seatedAt.get(table.id) ?? [])].sort((a, b) => a.seat - b.seat),
  }));
}

export function covers(list: GuestList): {
  readonly tables: readonly { readonly number: number; readonly covers: number }[];
  readonly total: number;
} {
  const counts = new Map<string, number>();
  const seated = seatedGuests(list);
  for (const { table } of seated) {
    counts.set(table.id, (counts.get(table.id) ?? 0) + 1);
  }
  return {
    tables: [...list.tables]
      .sort(byTableNumber)
      .map((table) => ({ number: table.number, covers: counts.get(table.id) ?? 0 })),
    total: seated.length,
  };
}

export function placeCards(list: GuestList): readonly { readonly name: string; readonly table: number }[] {
  return [...seatedGuests(list)]
    .sort((a, b) => a.table.number - b.table.number || a.seat - b.seat)
    .map(({ guest, table }) => ({ name: guest.name, table: table.number }));
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/**
 * Record a print. The print time is set every time. The paper's version goes up
 * by one when the list changed since the last print, and on a first print (so
 * the first sheet is always version 1); printing again unchanged keeps it.
 * `updatedAt` is not set here. A print changes the stored list (its version
 * and print time), so the page state stamps `updatedAt` as for any change, and
 * the 90 days of a list with no date count from the last change, a print
 * included. A print takes no undo step.
 */
export function markPrinted(list: GuestList, nowIso: string): GuestList {
  const next = list.changedSincePrint || list.paperVersion === 0 ? list.paperVersion + 1 : list.paperVersion;
  return { ...list, paperVersion: next, changedSincePrint: false, printedAt: nowIso };
}
