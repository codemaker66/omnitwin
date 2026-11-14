import { describe, it, expect } from "vitest";
import {
  GUEST_NAME_MAX,
  PARTY_MAX,
  GUESTS_MAX,
  TABLES_MAX,
  SEATS_MIN,
  SEATS_MAX,
  emptyGuestList,
  repairGuestList,
  type Guest,
  type GuestList,
} from "../model.js";
import {
  addGuests,
  removeGuest,
  renameGuest,
  setTables,
  setTableSeats,
  nameTable,
  removeTable,
  seatEveryone,
  moveGuest,
  summary,
} from "../seating.js";

const PLAN_ID = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const NOW = "2026-11-13T10:00:00.000Z";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function guestIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => uuid(1000 + i));
}

/** Ids for tables: a distinct block per call site is not needed, tables come from `ids` below. */
function tableIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => uuid(5000 + i));
}

function people(count: number): { name: string; party: string }[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Guest ${String(i + 1)}`, party: "" }));
}

function listOf(taken: readonly { name: string; party: string }[]): GuestList {
  return addGuests(emptyGuestList(PLAN_ID, NOW), taken, guestIds(taken.length));
}

function list180(): GuestList {
  return listOf(people(180));
}

/** Narrow a result that must be a list. */
function mustList(result: GuestList | { readonly refused: string }): GuestList {
  if ("refused" in result) throw new Error("unexpected refusal");
  return result;
}

function guestNamed(list: GuestList, name: string): Guest {
  const found = list.guests.find((g) => g.name === name);
  if (found === undefined) throw new Error("fixture guest missing");
  return found;
}

/** Every guest holds both a table and a seat, or neither; no seat is held twice. */
function expectInvariant(list: GuestList): void {
  const seen = new Set<string>();
  for (const g of list.guests) {
    expect(g.tableId === null).toBe(g.seat === null);
    if (g.tableId !== null && g.seat !== null) {
      const table = list.tables.find((t) => t.id === g.tableId);
      expect(table).toBeDefined();
      expect(g.seat).toBeLessThanOrEqual(table?.seats ?? 0);
      const key = `${g.tableId}:${String(g.seat)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }
  expect(repairGuestList(list).unseated).toBe(0);
}

describe("addGuests", () => {
  it("adds guests in order, unseated, and marks the list changed", () => {
    const base = emptyGuestList(PLAN_ID, NOW);
    const next = addGuests(base, [{ name: "Ada Lovelace", party: "Lovelace" }, { name: "Bo Peep", party: "" }], guestIds(2));
    expect(next.guests).toEqual([
      { id: uuid(1000), name: "Ada Lovelace", party: "Lovelace", tableId: null, seat: null },
      { id: uuid(1001), name: "Bo Peep", party: "", tableId: null, seat: null },
    ]);
    expect(next.changedSincePrint).toBe(true);
    expect(base.guests).toEqual([]);
    expect(base.changedSincePrint).toBe(false);
  });

  it("adds no more guests than there are ids", () => {
    const next = addGuests(emptyGuestList(PLAN_ID, NOW), people(5), guestIds(3));
    expect(next.guests.map((g) => g.name)).toEqual(["Guest 1", "Guest 2", "Guest 3"]);
  });

  it("adds no more than the room left under the guest limit", () => {
    const nearlyFull = listOf(people(GUESTS_MAX - 2));
    const next = addGuests(nearlyFull, people(10), tableIds(10));
    expect(next.guests).toHaveLength(GUESTS_MAX);
    expect(addGuests(next, people(1), tableIds(1)).guests).toHaveLength(GUESTS_MAX);
  });

  it("ignores a name that is empty or over the limit, and cuts a long party", () => {
    const next = addGuests(
      emptyGuestList(PLAN_ID, NOW),
      [
        { name: "   ", party: "" },
        { name: "x".repeat(GUEST_NAME_MAX + 1), party: "" },
        { name: "Cy Twombly", party: "p".repeat(PARTY_MAX + 20) },
      ],
      guestIds(3),
    );
    expect(next.guests).toHaveLength(1);
    expect(next.guests[0]).toMatchObject({ id: uuid(1000), name: "Cy Twombly", party: "p".repeat(PARTY_MAX) });
  });
});

describe("removeGuest", () => {
  it("removes the guest and marks the list changed", () => {
    const base = listOf(people(3));
    const next = removeGuest(base, uuid(1001));
    expect(next.guests.map((g) => g.name)).toEqual(["Guest 1", "Guest 3"]);
    expect(next.changedSincePrint).toBe(true);
    expect(base.guests).toHaveLength(3);
  });

  it("returns the same list, unmarked, for an unknown id", () => {
    const base = listOf(people(3));
    expect(removeGuest(base, uuid(9999))).toBe(base);
    expect(base.changedSincePrint).toBe(true); // set by addGuests in the fixture
    const fresh: GuestList = { ...base, changedSincePrint: false };
    const same = removeGuest(fresh, uuid(9999));
    expect(same).toBe(fresh);
    expect(same.changedSincePrint).toBe(false);
  });
});

describe("renameGuest", () => {
  it("trims the name and the party and collapses runs of spaces", () => {
    const base = listOf([{ name: "Old", party: "" }]);
    const next = mustList(renameGuest(base, uuid(1000), "  Ada   Lovelace ", "  The   Lovelaces  "));
    expect(next.guests[0]).toMatchObject({ name: "Ada Lovelace", party: "The Lovelaces" });
    expect(next.changedSincePrint).toBe(true);
  });

  it("refuses an empty name and changes nothing", () => {
    const base = listOf([{ name: "Old", party: "Keep" }]);
    const result = renameGuest(base, uuid(1000), "   ", "Other");
    expect(result).toEqual({ refused: "name" });
    expect(base.guests[0]).toMatchObject({ name: "Old", party: "Keep" });
  });

  it("refuses a name over the limit, without carrying it in the refusal", () => {
    const base = listOf([{ name: "Old", party: "" }]);
    const long = "z".repeat(GUEST_NAME_MAX + 1);
    const result = renameGuest(base, uuid(1000), long, "");
    expect(result).toEqual({ refused: "name" });
    expect(JSON.stringify(result)).not.toContain("zzz");
  });

  it("accepts a name of exactly the limit", () => {
    const base = listOf([{ name: "Old", party: "" }]);
    const next = mustList(renameGuest(base, uuid(1000), "y".repeat(GUEST_NAME_MAX), ""));
    expect(next.guests[0]?.name).toHaveLength(GUEST_NAME_MAX);
  });

  it("cuts a party over the limit to its first 60 characters", () => {
    const base = listOf([{ name: "Old", party: "" }]);
    const party = `${"a".repeat(PARTY_MAX)}TAIL`;
    const next = mustList(renameGuest(base, uuid(1000), "New", party));
    expect(next.guests[0]?.party).toBe("a".repeat(PARTY_MAX));
  });

  it("does not leave half a character when it cuts a party", () => {
    const base = listOf([{ name: "Old", party: "" }]);
    const party = `${"a".repeat(PARTY_MAX - 1)}\u{1F600}`; // the emoji straddles the cut
    const next = mustList(renameGuest(base, uuid(1000), "New", party));
    expect(next.guests[0]?.party).toBe("a".repeat(PARTY_MAX - 1));
  });

  it("keeps the guest's seat, and returns the same list for an unknown id", () => {
    const seated = seatEveryone(setTables(listOf(people(2)), 1, 10, tableIds(1)));
    const renamed = mustList(renameGuest(seated, uuid(1000), "New", ""));
    expect(renamed.guests[0]).toMatchObject({ tableId: seated.guests[0]?.tableId, seat: 1 });
    const fresh: GuestList = { ...seated, changedSincePrint: false };
    const same = renameGuest(fresh, uuid(9999), "Whoever", "");
    expect(same).toBe(fresh);
  });
});

describe("setTables", () => {
  it("makes tables numbered from 1 with the given seats and ids", () => {
    const next = setTables(listOf(people(1)), 3, 8, tableIds(3));
    expect(next.tables).toEqual([
      { id: uuid(5000), number: 1, name: "", seats: 8 },
      { id: uuid(5001), number: 2, name: "", seats: 8 },
      { id: uuid(5002), number: 3, name: "", seats: 8 },
    ]);
    expect(next.changedSincePrint).toBe(true);
  });

  it("clamps the count to 0..TABLES_MAX and the seats to SEATS_MIN..SEATS_MAX", () => {
    const base = listOf(people(1));
    expect(setTables(base, 500, 10, tableIds(500)).tables).toHaveLength(TABLES_MAX);
    expect(setTables(base, -4, 10, tableIds(4)).tables).toHaveLength(0);
    expect(setTables(base, 1, 99, tableIds(1)).tables[0]?.seats).toBe(SEATS_MAX);
    expect(setTables(base, 1, 0, tableIds(1)).tables[0]?.seats).toBe(SEATS_MIN);
  });

  it("adds only as many tables as there are ids", () => {
    expect(setTables(listOf(people(1)), 5, 10, tableIds(2)).tables).toHaveLength(2);
  });

  it("keeps existing tables' number, name, seats and guests when adding", () => {
    const first = setTables(listOf(people(4)), 2, 6, tableIds(2));
    const named = nameTable(first, uuid(5000), "Top table");
    const seated = seatEveryone(named);
    const grown = setTables(seated, 4, 12, [uuid(5002), uuid(5003)]);
    expect(grown.tables.slice(0, 2)).toEqual(seated.tables);
    expect(grown.tables[2]).toEqual({ id: uuid(5002), number: 3, name: "", seats: 12 });
    expect(grown.tables[3]).toEqual({ id: uuid(5003), number: 4, name: "", seats: 12 });
    expect(grown.guests).toEqual(seated.guests);
  });

  it("takes away the last tables first and never renumbers the rest", () => {
    const seated = seatEveryone(setTables(list180(), 18, 10, tableIds(18)));
    const fewer = setTables(seated, 16, 10, []);
    expect(fewer.tables.map((t) => t.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(fewer.tables).toEqual(seated.tables.slice(0, 16));
    expect(summary(fewer)).toMatchObject({ seated: 160, toSeat: 20, tables: 16 });
    expectInvariant(fewer);
  });

  it("numbers a new table after the highest number, not after the count", () => {
    const base = setTables(listOf([]), 3, 10, tableIds(3));
    const without2 = removeTable(base, uuid(5001)); // numbers 1 and 3 remain
    const grown = setTables(without2, 3, 10, [uuid(5009)]);
    expect(grown.tables.map((t) => t.number)).toEqual([1, 3, 4]);
  });

  it("removes the highest-numbered tables, not the last in the array", () => {
    const base = setTables(listOf([]), 3, 10, tableIds(3));
    const reversed: GuestList = { ...base, tables: [...base.tables].reverse() };
    const fewer = setTables(reversed, 2, 10, []);
    expect(fewer.tables.map((t) => t.number).sort()).toEqual([1, 2]);
  });
});

describe("a number that is not finite changes nothing", () => {
  function seatedFixture(): GuestList {
    const seated = seatEveryone(setTables(listOf(people(24)), 2, 12, tableIds(2)));
    return { ...seated, changedSincePrint: false };
  }

  it("setTables returns the same list for NaN or an infinity, as count or as seats", () => {
    const base = seatedFixture();
    const before = JSON.stringify(base);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const badCount = setTables(base, bad, 12, tableIds(5));
      expect(badCount).toBe(base);
      expect(badCount.changedSincePrint).toBe(false);
      const badSeats = setTables(base, 2, bad, tableIds(5));
      expect(badSeats).toBe(base);
      expect(badSeats.changedSincePrint).toBe(false);
    }
    expect(JSON.stringify(base)).toBe(before);
    expect(summary(base)).toMatchObject({ seated: 24, tables: 2 });
  });

  it("setTableSeats returns the same list for NaN or an infinity, and keeps high seats seated", () => {
    const base = seatedFixture();
    const tableId = uuid(5000);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const same = setTableSeats(base, tableId, bad);
      expect(same).toBe(base);
      expect(same.changedSincePrint).toBe(false);
    }
    expect(base.guests[11]).toMatchObject({ tableId, seat: 12 });
    expect(summary(base).toSeat).toBe(0);
  });
});

describe("setTableSeats", () => {
  it("clamps the seats and sends guests whose seat is beyond the new count back to seat", () => {
    const seated = seatEveryone(setTables(list180(), 18, 10, tableIds(18)));
    const first = seated.tables[0]?.id ?? "";
    const smaller = setTableSeats(seated, first, 8);
    expect(summary(smaller).toSeat).toBe(2);
    expect(smaller.tables[0]?.seats).toBe(8);
    expect(smaller.guests[8]).toMatchObject({ tableId: null, seat: null });
    expect(smaller.guests[7]).toMatchObject({ tableId: first, seat: 8 });
    expectInvariant(smaller);
    expect(setTableSeats(seated, first, 99).tables[0]?.seats).toBe(SEATS_MAX);
    expect(setTableSeats(seated, first, -3).tables[0]?.seats).toBe(SEATS_MIN);
  });

  it("changes nothing for guests when the seats grow", () => {
    const seated = seatEveryone(setTables(listOf(people(10)), 1, 10, tableIds(1)));
    const bigger = setTableSeats(seated, uuid(5000), 12);
    expect(bigger.guests).toEqual(seated.guests);
    expect(summary(bigger).freeSeats).toBe(2);
  });

  it("returns the same list, unmarked, for an unknown table", () => {
    const base: GuestList = { ...setTables(listOf(people(2)), 1, 10, tableIds(1)), changedSincePrint: false };
    const same = setTableSeats(base, uuid(9999), 5);
    expect(same).toBe(base);
    expect(same.changedSincePrint).toBe(false);
  });
});

describe("nameTable", () => {
  it("trims and cuts the name to 60 characters", () => {
    const base = setTables(listOf([]), 1, 10, tableIds(1));
    expect(nameTable(base, uuid(5000), "  Bride's family  ").tables[0]?.name).toBe("Bride's family");
    expect(nameTable(base, uuid(5000), "n".repeat(90)).tables[0]?.name).toBe("n".repeat(60));
    expect(nameTable(base, uuid(5000), "x").changedSincePrint).toBe(true);
  });

  it("returns the same list, unmarked, for an unknown table", () => {
    const base: GuestList = { ...setTables(listOf([]), 1, 10, tableIds(1)), changedSincePrint: false };
    const same = nameTable(base, uuid(9999), "Nope");
    expect(same).toBe(base);
    expect(same.changedSincePrint).toBe(false);
  });
});

describe("removeTable", () => {
  it("removes the table, sends its guests back to seat, and does not renumber", () => {
    const seated = seatEveryone(setTables(list180(), 18, 10, tableIds(18)));
    const gone = removeTable(seated, seated.tables[17]?.id ?? "");
    expect(summary(gone).toSeat).toBe(10);
    expect(gone.tables).toHaveLength(17);
    const middle = removeTable(seated, seated.tables[3]?.id ?? "");
    expect(middle.tables.map((t) => t.number)).not.toContain(4);
    expect(middle.tables.map((t) => t.number)).toContain(5);
    expectInvariant(gone);
    expectInvariant(middle);
  });

  it("returns the same list, unmarked, for an unknown table", () => {
    const base: GuestList = { ...setTables(listOf([]), 1, 10, tableIds(1)), changedSincePrint: false };
    const same = removeTable(base, uuid(9999));
    expect(same).toBe(base);
    expect(same.changedSincePrint).toBe(false);
  });
});

describe("seatEveryone", () => {
  it("seats 180 guests at 18 tables of 10 in list order", () => {
    const seated = seatEveryone(setTables(list180(), 18, 10, tableIds(18)));
    expect(summary(seated)).toEqual({ guests: 180, seated: 180, toSeat: 0, tables: 18, freeSeats: 0 });
    expect(seated.guests[0]).toMatchObject({ tableId: seated.tables[0]?.id, seat: 1 });
    expect(seated.guests[10]).toMatchObject({ tableId: seated.tables[1]?.id, seat: 1 });
    expect(seated.guests[179]).toMatchObject({ tableId: seated.tables[17]?.id, seat: 10 });
    expect(seated.changedSincePrint).toBe(true);
    expectInvariant(seated);
  });

  it("keeps a party together: a party of 4 does not start in the last 2 seats of a table", () => {
    const eightThenParty = listOf([
      ...people(8),
      ...["Ade", "Bola", "Chidi", "Dayo"].map((name) => ({ name, party: "Okafor" })),
    ]);
    const s = seatEveryone(setTables(eightThenParty, 2, 10, tableIds(2)));
    const party = s.guests.filter((g) => g.party === "Okafor");
    expect(new Set(party.map((g) => g.tableId)).size).toBe(1);
    expect(party[0]?.tableId).toBe(s.tables[1]?.id);
    expect(party.map((g) => g.seat)).toEqual([1, 2, 3, 4]);
    expectInvariant(s);
  });

  it("gathers a party whose members are spread through the list, at the first member's place", () => {
    const spread = listOf([
      { name: "A1", party: "Okafor" },
      { name: "S1", party: "" },
      { name: "A2", party: " okafor " },
      { name: "S2", party: "" },
      { name: "A3", party: "OKAFOR" },
    ]);
    const s = seatEveryone(setTables(spread, 1, 10, tableIds(1)));
    expect(s.guests.map((g) => g.seat)).toEqual([1, 4, 2, 5, 3]);
  });

  it("splits a party only when it is larger than any table, in order", () => {
    const big = listOf(Array.from({ length: 12 }, (_, i) => ({ name: `M${String(i + 1)}`, party: "Big" })));
    const s = seatEveryone(setTables(big, 2, 10, tableIds(2)));
    expect(s.guests.slice(0, 10).every((g) => g.tableId === s.tables[0]?.id)).toBe(true);
    expect(s.guests.slice(10).every((g) => g.tableId === s.tables[1]?.id)).toBe(true);
    expect(s.guests.map((g) => g.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2]);
    expectInvariant(s);
  });

  it("does not split a party that fits a table but finds none with room, and seats later singles", () => {
    const base = listOf([
      ...people(9),
      ...["P1", "P2"].map((name) => ({ name, party: "Pair" })),
      { name: "Single", party: "" },
    ]);
    const s = seatEveryone(setTables(base, 1, 10, tableIds(1)));
    expect(guestNamed(s, "P1")).toMatchObject({ tableId: null, seat: null });
    expect(guestNamed(s, "P2")).toMatchObject({ tableId: null, seat: null });
    expect(guestNamed(s, "Single")).toMatchObject({ tableId: uuid(5000), seat: 10 });
    expect(summary(s)).toMatchObject({ seated: 10, toSeat: 2 });
  });

  it("leaves a seated guest where they are, and fills only free seats", () => {
    const base = setTables(listOf(people(5)), 1, 10, tableIds(1));
    const handSeated = mustList(moveGuest(base, uuid(1002), uuid(5000), 1)); // Guest 3 takes seat 1
    const s = seatEveryone(handSeated);
    expect(guestNamed(s, "Guest 3")).toMatchObject({ tableId: uuid(5000), seat: 1 });
    expect(s.guests.map((g) => g.seat)).toEqual([2, 3, 1, 4, 5]);
    expectInvariant(s);
  });

  it("seats a late-added party member at the party's own table when it has room", () => {
    const base = setTables(
      listOf([...people(3), ...["F1", "F2"].map((name) => ({ name, party: "Family" }))]),
      3,
      10,
      tableIds(3),
    );
    // The family sits at table 3 by hand; tables 1 and 2 are empty.
    let seated = mustList(moveGuest(base, uuid(1003), uuid(5002), 1));
    seated = mustList(moveGuest(seated, uuid(1004), uuid(5002), 2));
    const later = addGuests(seated, [{ name: "F3", party: "family" }], [uuid(2000)]);
    const s = seatEveryone(later);
    expect(guestNamed(s, "F3")).toMatchObject({ tableId: uuid(5002), seat: 3 });
    expect(guestNamed(s, "Guest 1")).toMatchObject({ tableId: uuid(5000), seat: 1 });
    expectInvariant(s);
  });

  it("sends a party member unseated by hand, or by fewer seats, back to the party's table", () => {
    const base = setTables(
      listOf(["A", "B", "C"].map((name) => ({ name, party: "Trio" }))),
      2,
      10,
      tableIds(2),
    );
    let list = mustList(moveGuest(base, uuid(1000), uuid(5001), 1));
    list = mustList(moveGuest(list, uuid(1001), uuid(5001), 2));
    list = mustList(moveGuest(list, uuid(1002), uuid(5001), 9));
    const byHand = seatEveryone(mustList(moveGuest(list, uuid(1001), null)));
    expect(guestNamed(byHand, "B")).toMatchObject({ tableId: uuid(5001), seat: 2 });
    const fewerSeats = seatEveryone(setTableSeats(list, uuid(5001), 8)); // C (seat 9) is unseated
    expect(guestNamed(fewerSeats, "C")).toMatchObject({ tableId: uuid(5001), seat: 3 });
    expectInvariant(byHand);
    expectInvariant(fewerSeats);
  });

  it("joins the lowest-numbered table where the party sits that has room for all its unseated members", () => {
    const base = setTables(
      listOf([
        { name: "P1", party: "Pen" },
        { name: "P2", party: "Pen" },
        { name: "P3", party: "Pen" },
        { name: "P4", party: "Pen" },
        { name: "L1", party: "Pen" },
        { name: "L2", party: "Pen" },
      ]),
      3,
      4,
      tableIds(3),
    );
    // P1, P2, P3 at table 3 (one seat free), P4 at table 2 (three seats free).
    let list = mustList(moveGuest(base, uuid(1000), uuid(5002), 1));
    list = mustList(moveGuest(list, uuid(1001), uuid(5002), 2));
    list = mustList(moveGuest(list, uuid(1002), uuid(5002), 3));
    list = mustList(moveGuest(list, uuid(1003), uuid(5001), 1));
    const s = seatEveryone(list);
    // Two unseated (L1, L2): table 3 has only 1 free; table 2 has 3 free and is the lowest that fits both
    // (table 1 is empty, but the party does not sit there).
    expect(guestNamed(s, "L1").tableId).toBe(uuid(5001));
    expect(guestNamed(s, "L2").tableId).toBe(uuid(5001));
    expectInvariant(s);
  });

  it("takes the lowest-numbered of two own tables when both have room", () => {
    const base = setTables(
      listOf(["P1", "P2", "L1"].map((name) => ({ name, party: "Pen" }))),
      3,
      4,
      tableIds(3),
    );
    let list = mustList(moveGuest(base, uuid(1000), uuid(5002), 1));
    list = mustList(moveGuest(list, uuid(1001), uuid(5001), 1));
    const s = seatEveryone(list);
    expect(guestNamed(s, "L1")).toMatchObject({ tableId: uuid(5001), seat: 2 });
  });

  it("falls back to the first table with room when the party's own tables are full", () => {
    const base = setTables(
      listOf([
        { name: "P1", party: "Pen" },
        { name: "P2", party: "Pen" },
        { name: "L1", party: "Pen" },
      ]),
      2,
      2,
      tableIds(2),
    );
    let list = mustList(moveGuest(base, uuid(1000), uuid(5001), 1));
    list = mustList(moveGuest(list, uuid(1001), uuid(5001), 2)); // table 2 full of the party
    const s = seatEveryone(list);
    expect(guestNamed(s, "L1")).toMatchObject({ tableId: uuid(5000), seat: 1 });
  });

  it("leaves a guest with no party out of all this: they take the first free seat", () => {
    const base = setTables(
      listOf([
        { name: "P1", party: "Pen" },
        { name: "Solo", party: "" },
        { name: "Solo2", party: "  " },
      ]),
      2,
      4,
      tableIds(2),
    );
    const list = mustList(moveGuest(base, uuid(1000), uuid(5001), 1)); // the Pen guest sits at table 2
    const s = seatEveryone(list);
    expect(guestNamed(s, "Solo")).toMatchObject({ tableId: uuid(5000), seat: 1 });
    expect(guestNamed(s, "Solo2")).toMatchObject({ tableId: uuid(5000), seat: 2 });
  });

  it("with too few seats, seats what fits and leaves the rest to seat", () => {
    expect(summary(seatEveryone(setTables(list180(), 17, 10, tableIds(17))))).toMatchObject({
      seated: 170,
      toSeat: 10,
    });
  });

  it("with no tables, seats no one and still returns a new list", () => {
    const base = listOf(people(3));
    const s = seatEveryone(base);
    expect(s).not.toBe(base);
    expect(summary(s)).toMatchObject({ seated: 0, toSeat: 3, tables: 0, freeSeats: 0 });
  });

  it("works table by table in number order, whatever the array order", () => {
    const base = setTables(listOf(people(3)), 2, 2, tableIds(2));
    const reversed: GuestList = { ...base, tables: [...base.tables].reverse() };
    const s = seatEveryone(reversed);
    const numberOf = (tableId: string | null): number | undefined => s.tables.find((t) => t.id === tableId)?.number;
    expect(s.guests.map((g) => numberOf(g.tableId))).toEqual([1, 1, 2]);
  });

  it("does not change its input", () => {
    const base = setTables(list180(), 18, 10, tableIds(18));
    const before = JSON.stringify(base);
    seatEveryone(base);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("moveGuest", () => {
  function seatedTen(): { list: GuestList; full: string; other: string } {
    const two = setTables(listOf(people(11)), 2, 10, tableIds(2));
    const seated = seatEveryone(two);
    return { list: seated, full: uuid(5000), other: uuid(5001) };
  }

  it("refuses a taken seat and a full table, and changes nothing", () => {
    const { list: seated, full } = seatedTen();
    const before = JSON.stringify(seated);
    // Guest 11 sits at table 2 seat 1; Guest 1 holds table 1 seat 1.
    expect(moveGuest(seated, uuid(1010), full, 1)).toEqual({ refused: "seat-taken" });
    expect(moveGuest(seated, uuid(1010), full)).toEqual({ refused: "table-full" });
    expect(JSON.stringify(seated)).toBe(before);
  });

  it("refuses an unknown guest and an unknown table", () => {
    const { list: seated, full } = seatedTen();
    expect(moveGuest(seated, uuid(9999), full)).toEqual({ refused: "no-such-guest" });
    expect(moveGuest(seated, uuid(1000), uuid(9999))).toEqual({ refused: "no-such-table" });
  });

  it("refuses a seat the table does not have", () => {
    const { list: seated, other } = seatedTen();
    expect(moveGuest(seated, uuid(1000), other, 11)).toEqual({ refused: "seat-taken" });
    expect(moveGuest(seated, uuid(1000), other, 0)).toEqual({ refused: "seat-taken" });
  });

  it("takes the lowest free seat when no seat is given", () => {
    const { list: seated, other } = seatedTen();
    const next = mustList(moveGuest(seated, uuid(1000), other)); // Guest 1 leaves table 1 for table 2
    expect(next.guests[0]).toMatchObject({ tableId: other, seat: 2 }); // seat 1 is Guest 11's
    expect(next.changedSincePrint).toBe(true);
    expectInvariant(next);
  });

  it("takes the seat asked for when it is free", () => {
    const { list: seated, other } = seatedTen();
    const next = mustList(moveGuest(seated, uuid(1000), other, 7));
    expect(next.guests[0]).toMatchObject({ tableId: other, seat: 7 });
    expectInvariant(next);
  });

  it("frees the old seat when a guest moves", () => {
    const { list: seated, full, other } = seatedTen();
    const moved = mustList(moveGuest(seated, uuid(1000), other));
    const back = mustList(moveGuest(moved, uuid(1010), full)); // Guest 11 takes the seat left at table 1
    expect(back.guests[10]).toMatchObject({ tableId: full, seat: 1 });
  });

  it("lets a seated guest keep their seat when moved to their own table with no seat given", () => {
    const { list: seated, full } = seatedTen();
    const next = mustList(moveGuest(seated, uuid(1004), full)); // Guest 5, seat 5, same table
    expect(next.guests[4]).toMatchObject({ tableId: full, seat: 5 });
  });

  it("lets a guest move to another seat of their own table", () => {
    const base = seatEveryone(setTables(listOf(people(3)), 1, 10, tableIds(1)));
    const next = mustList(moveGuest(base, uuid(1000), uuid(5000), 9));
    expect(next.guests[0]).toMatchObject({ seat: 9 });
    expectInvariant(next);
  });

  it("unseats a guest when the table is null, leaving both table and seat empty", () => {
    const { list: seated } = seatedTen();
    const next = mustList(moveGuest(seated, uuid(1000), null));
    expect(next.guests[0]).toMatchObject({ tableId: null, seat: null });
    expect(summary(next).toSeat).toBe(1);
    expectInvariant(next);
  });

  it("never leaves a guest at a table with no seat", () => {
    const { list: seated, other } = seatedTen();
    for (const result of [
      moveGuest(seated, uuid(1000), other),
      moveGuest(seated, uuid(1000), other, 5),
      moveGuest(seated, uuid(1000), null),
    ]) {
      expectInvariant(mustList(result));
    }
  });
});

describe("summary", () => {
  it("counts guests, seated, to seat, tables and free seats", () => {
    const base = setTables(listOf(people(7)), 2, 5, tableIds(2));
    expect(summary(base)).toEqual({ guests: 7, seated: 0, toSeat: 7, tables: 2, freeSeats: 10 });
    expect(summary(seatEveryone(base))).toEqual({ guests: 7, seated: 7, toSeat: 0, tables: 2, freeSeats: 3 });
  });

  it("is all zeros for an empty list", () => {
    expect(summary(emptyGuestList(PLAN_ID, NOW))).toEqual({ guests: 0, seated: 0, toSeat: 0, tables: 0, freeSeats: 0 });
  });
});

describe("no function carries a guest's name in a refusal", () => {
  it("returns fixed words only", () => {
    const base = listOf([{ name: "Secret Name", party: "Secret Party" }]);
    const results: unknown[] = [
      renameGuest(base, uuid(1000), "", ""),
      moveGuest(base, uuid(1000), uuid(9999)),
      moveGuest(base, uuid(9999), null),
    ];
    for (const r of results) {
      expect(JSON.stringify(r)).not.toContain("Secret");
    }
  });
});
