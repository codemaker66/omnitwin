/**
 * The planner's kit: tables, seats and "seat everyone". This is the only place
 * the kit changes who sits where. Every function takes a list and returns a new
 * one (the input is never changed) with `changedSincePrint` set, except where
 * an id is not in the list: then the list comes back as it was, the same
 * object, unmarked.
 *
 * The invariant held throughout: a guest has both a table and a seat, or
 * neither. Nothing here leaves a guest at a table with no seat.
 *
 * The functions take no clock, so `updatedAt` is left for the store to set.
 * No function throws, and no refusal or value returned here carries a guest's
 * text: refusals are fixed words.
 */

import {
  GUEST_NAME_MAX,
  GUESTS_MAX,
  PARTY_MAX,
  SEATS_MAX,
  SEATS_MIN,
  TABLES_MAX,
  repairGuestList,
  type Guest,
  type GuestList,
  type KitTable,
} from "./model.js";

const TABLE_NAME_MAX = 60;
const TABLE_NUMBER_MAX = 999;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** `value` must be finite: callers return the list unchanged for NaN or an infinity. */
function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Cut to `max` UTF-16 units, never leaving half a pair: never more characters than the schemas allow (they count code points). */
function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when a name is over the name limit, counted in characters (code points), as the schema and the paste reader count it. */
function overNameLimit(name: string): boolean {
  return name.length > GUEST_NAME_MAX && Array.from(name).length > GUEST_NAME_MAX;
}

function changed(list: GuestList, patch: Partial<GuestList>): GuestList {
  return { ...list, ...patch, changedSincePrint: true };
}

function unseat(guest: Guest): Guest {
  return { ...guest, tableId: null, seat: null };
}

function byNumber(a: KitTable, b: KitTable): number {
  return a.number - b.number;
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

/**
 * Add guests, unseated, one id each. Adds no more than there are ids and no
 * more than the room left under the guest limit; the rest are ignored, as is
 * any name that is empty or over the name limit. A party is cut to its limit.
 */
export function addGuests(
  list: GuestList,
  taken: readonly { name: string; party: string }[],
  ids: readonly string[],
): GuestList {
  const room = Math.max(0, GUESTS_MAX - list.guests.length);
  const added: Guest[] = [];
  for (const entry of taken) {
    if (added.length >= room || added.length >= ids.length) break;
    const id = ids[added.length];
    if (id === undefined) break;
    if (entry.name.trim() === "" || overNameLimit(entry.name)) continue;
    added.push({ id, name: entry.name, party: cutTo(entry.party.trim(), PARTY_MAX), tableId: null, seat: null });
  }
  return changed(list, { guests: [...list.guests, ...added] });
}

export function removeGuest(list: GuestList, guestId: string): GuestList {
  if (!list.guests.some((g) => g.id === guestId)) return list;
  return changed(list, { guests: list.guests.filter((g) => g.id !== guestId) });
}

/**
 * Trim the name and party and collapse runs of spaces. An empty name, or one
 * over the name limit, is refused and nothing changes. A party over its limit
 * is cut to its first 60 characters.
 */
export function renameGuest(
  list: GuestList,
  guestId: string,
  name: string,
  party: string,
): GuestList | { readonly refused: "name" } {
  if (!list.guests.some((g) => g.id === guestId)) return list;
  const cleanName = tidy(name);
  if (cleanName === "" || overNameLimit(cleanName)) return { refused: "name" };
  const cleanParty = cutTo(tidy(party), PARTY_MAX);
  return changed(list, {
    guests: list.guests.map((g) => (g.id === guestId ? { ...g, name: cleanName, party: cleanParty } : g)),
  });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Set how many tables there are. Existing tables keep their number, name, seats
 * and guests. A count or seats that is not a finite number (an empty field gives
 * NaN) changes nothing: the same list comes back, unmarked. New ones take the next numbers (the highest number plus one) and
 * the given seats, one id each, and only as many as there are ids. Tables
 * beyond `count` go, highest number first, and their guests go back to "to
 * seat". Nothing is renumbered.
 */
export function setTables(list: GuestList, count: number, seats: number, ids: readonly string[]): GuestList {
  if (!Number.isFinite(count) || !Number.isFinite(seats)) return list;
  const target = clampInt(count, 0, TABLES_MAX);
  const seatsEach = clampInt(seats, SEATS_MIN, SEATS_MAX);

  const surplus = Math.max(0, list.tables.length - target);
  const removed = new Set(
    [...list.tables]
      .sort((a, b) => b.number - a.number)
      .slice(0, surplus)
      .map((t) => t.id),
  );
  const tables: KitTable[] = list.tables.filter((t) => !removed.has(t.id));

  const used = new Set(list.tables.map((t) => t.id));
  let nextNumber = tables.reduce((highest, t) => Math.max(highest, t.number), 0) + 1;
  for (const id of ids) {
    if (tables.length >= target || nextNumber > TABLE_NUMBER_MAX) break;
    if (used.has(id)) continue;
    used.add(id);
    tables.push({ id, number: nextNumber, name: "", seats: seatsEach });
    nextNumber += 1;
  }

  const guests =
    removed.size === 0
      ? list.guests
      : list.guests.map((g) => (g.tableId !== null && removed.has(g.tableId) ? unseat(g) : g));
  return changed(list, { tables, guests });
}

/** Set a table's seats (clamped; not a finite number changes nothing). Guests whose seat is now beyond the count go back to "to seat". */
export function setTableSeats(list: GuestList, tableId: string, seats: number): GuestList {
  if (!Number.isFinite(seats) || !list.tables.some((t) => t.id === tableId)) return list;
  const count = clampInt(seats, SEATS_MIN, SEATS_MAX);
  return changed(list, {
    tables: list.tables.map((t) => (t.id === tableId ? { ...t, seats: count } : t)),
    guests: list.guests.map((g) => (g.tableId === tableId && g.seat !== null && g.seat > count ? unseat(g) : g)),
  });
}

export function nameTable(list: GuestList, tableId: string, name: string): GuestList {
  if (!list.tables.some((t) => t.id === tableId)) return list;
  const clean = cutTo(name.trim(), TABLE_NAME_MAX);
  return changed(list, { tables: list.tables.map((t) => (t.id === tableId ? { ...t, name: clean } : t)) });
}

/** Remove a table; its guests go back to "to seat". The other tables keep their numbers. */
export function removeTable(list: GuestList, tableId: string): GuestList {
  if (!list.tables.some((t) => t.id === tableId)) return list;
  return changed(list, {
    tables: list.tables.filter((t) => t.id !== tableId),
    guests: list.guests.map((g) => (g.tableId === tableId ? unseat(g) : g)),
  });
}

// ---------------------------------------------------------------------------
// Seating
// ---------------------------------------------------------------------------

function partyKey(guest: Guest): string {
  return guest.party.trim().toLowerCase();
}

/**
 * Seat every guest who is "to seat", leaving seated guests where they are and
 * filling only free seats. Tables are used in number order, the lowest free
 * seat first. A party (unseated guests sharing a non-empty party label, taken
 * at its first member's place in the list) first joins a table where the party
 * already sits, the lowest-numbered one with room for all its unseated members;
 * failing that it goes whole to the first table with room for all of it; guests with no party go one at a time. A party is split,
 * in list order, only when it is larger than every table. A party that would
 * fit a table but finds none with room stays "to seat". With too few seats,
 * what fits is seated and the rest stay "to seat".
 */
export function seatEveryone(list: GuestList): GuestList {
  const base = repairGuestList(list).list;
  const tables = [...base.tables].sort(byNumber);
  const largest = tables.reduce((most, t) => Math.max(most, t.seats), 0);

  const held = new Map<string, Set<number>>();
  for (const table of tables) held.set(table.id, new Set<number>());
  for (const guest of base.guests) {
    if (guest.tableId !== null && guest.seat !== null) held.get(guest.tableId)?.add(guest.seat);
  }

  function freeSeats(table: KitTable): number {
    return table.seats - (held.get(table.id)?.size ?? table.seats);
  }

  function place(table: KitTable): number {
    const taken = held.get(table.id);
    let seat = SEATS_MIN;
    while (taken?.has(seat) === true) seat += 1;
    taken?.add(seat);
    return seat;
  }

  // A unit is one guest with no party, or every unseated member of one party.
  const units: { readonly key: string; readonly members: number[] }[] = [];
  const partyUnits = new Map<string, number[]>();
  base.guests.forEach((guest, index) => {
    if (guest.tableId !== null) return;
    const key = partyKey(guest);
    if (key === "") {
      units.push({ key: "", members: [index] });
      return;
    }
    const unit = partyUnits.get(key);
    if (unit === undefined) {
      const members = [index];
      partyUnits.set(key, members);
      units.push({ key, members });
    } else {
      unit.push(index);
    }
  });

  const partyTables = new Map<string, Set<string>>();
  for (const guest of base.guests) {
    if (guest.tableId === null) continue;
    const key = partyKey(guest);
    if (key === "") continue;
    const sitting = partyTables.get(key) ?? new Set<string>();
    sitting.add(guest.tableId);
    partyTables.set(key, sitting);
  }

  const seatOf = new Map<number, { readonly tableId: string; readonly seat: number }>();
  for (const { key, members } of units) {
    const own = partyTables.get(key);
    const whole =
      (own === undefined ? undefined : tables.find((t) => own.has(t.id) && freeSeats(t) >= members.length)) ??
      tables.find((t) => freeSeats(t) >= members.length);
    if (whole !== undefined) {
      for (const index of members) seatOf.set(index, { tableId: whole.id, seat: place(whole) });
      continue;
    }
    if (members.length <= largest) continue;
    for (const index of members) {
      const table = tables.find((t) => freeSeats(t) > 0);
      if (table === undefined) break;
      seatOf.set(index, { tableId: table.id, seat: place(table) });
    }
  }

  return changed(base, {
    guests: base.guests.map((guest, index) => {
      const spot = seatOf.get(index);
      return spot === undefined ? guest : { ...guest, tableId: spot.tableId, seat: spot.seat };
    }),
  });
}

export type MoveRefusal = {
  readonly refused: "seat-taken" | "table-full" | "no-such-table" | "no-such-guest";
};

/**
 * Seat one guest by hand, or unseat them with a null table (both go null).
 * With no `seat`, the guest takes the lowest free seat, or keeps their seat if
 * they are already at that table. A refused move changes nothing. A seat the
 * table does not have is refused as "seat-taken": it is not free to take.
 */
export function moveGuest(
  list: GuestList,
  guestId: string,
  tableId: string | null,
  seat?: number,
): GuestList | MoveRefusal {
  const guest = list.guests.find((g) => g.id === guestId);
  if (guest === undefined) return { refused: "no-such-guest" };

  const place = (tableIdNext: string | null, seatNext: number | null): GuestList =>
    changed(list, {
      guests: list.guests.map((g) => (g.id === guestId ? { ...g, tableId: tableIdNext, seat: seatNext } : g)),
    });

  if (tableId === null) return place(null, null);

  const table = list.tables.find((t) => t.id === tableId);
  if (table === undefined) return { refused: "no-such-table" };

  const heldByOthers = new Set<number>();
  for (const other of list.guests) {
    if (other.id !== guestId && other.tableId === tableId && other.seat !== null) heldByOthers.add(other.seat);
  }

  if (seat !== undefined) {
    if (!Number.isInteger(seat) || seat < SEATS_MIN || seat > table.seats || heldByOthers.has(seat)) {
      return { refused: "seat-taken" };
    }
    return place(tableId, seat);
  }

  if (guest.tableId === tableId && guest.seat !== null) return place(tableId, guest.seat);
  for (let candidate = SEATS_MIN; candidate <= table.seats; candidate += 1) {
    if (!heldByOthers.has(candidate)) return place(tableId, candidate);
  }
  return { refused: "table-full" };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function summary(list: GuestList): {
  readonly guests: number;
  readonly seated: number;
  readonly toSeat: number;
  readonly tables: number;
  readonly freeSeats: number;
} {
  const seated = list.guests.filter((g) => g.tableId !== null && g.seat !== null).length;
  const totalSeats = list.tables.reduce((sum, t) => sum + t.seats, 0);
  return {
    guests: list.guests.length,
    seated,
    toSeat: list.guests.length - seated,
    tables: list.tables.length,
    freeSeats: Math.max(0, totalSeats - seated),
  };
}
