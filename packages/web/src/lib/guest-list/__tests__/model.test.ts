import { describe, it, expect } from "vitest";
import {
  GUEST_NAME_MAX,
  PARTY_MAX,
  GUESTS_MAX,
  TABLES_MAX,
  SEATS_MIN,
  SEATS_MAX,
  SEATS_DEFAULT,
  LIST_VERSION,
  KEEP_DAYS_AFTER_EVENT,
  KEEP_DAYS_AFTER_CHANGE,
  GuestSchema,
  KitTableSchema,
  GuestListSchema,
  emptyGuestList,
  repairGuestList,
  deleteAfter,
  type Guest,
  type GuestList,
  type KitTable,
} from "../model.js";

const PLAN_ID = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const NOW = "2026-11-13T10:00:00.000Z";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function guestAt(n: number, tableId: string | null, seat: number | null): Guest {
  return { id: uuid(1000 + n), name: `Guest ${String(n)}`, party: "", tableId, seat };
}

function tableAt(n: number, seats: number): KitTable {
  return { id: uuid(n), number: n, name: "", seats };
}

const guest: Guest = guestAt(1, null, null);
const list: GuestList = emptyGuestList(PLAN_ID, NOW);

describe("limits", () => {
  it("holds the exact numbers", () => {
    expect(GUEST_NAME_MAX).toBe(80);
    expect(PARTY_MAX).toBe(60);
    expect(GUESTS_MAX).toBe(600);
    expect(TABLES_MAX).toBe(80);
    expect(SEATS_MIN).toBe(1);
    expect(SEATS_MAX).toBe(24);
    expect(SEATS_DEFAULT).toBe(10);
    expect(LIST_VERSION).toBe(1);
    expect(KEEP_DAYS_AFTER_EVENT).toBe(30);
    expect(KEEP_DAYS_AFTER_CHANGE).toBe(90);
  });
});

describe("GuestSchema", () => {
  it("accepts a plain guest", () => {
    expect(GuestSchema.safeParse(guest).success).toBe(true);
  });

  it("refuses a guest record with any other field", () => {
    expect(GuestSchema.safeParse({ ...guest, email: "x" }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, notes: "x" }).success).toBe(false);
  });

  it("refuses a name over 80 characters and an empty name", () => {
    expect(GuestSchema.safeParse({ ...guest, name: "a".repeat(81) }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, name: "" }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, name: "a".repeat(80) }).success).toBe(true);
  });

  it("refuses a party over 60 characters but allows an empty party", () => {
    expect(GuestSchema.safeParse({ ...guest, party: "p".repeat(61) }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, party: "p".repeat(60) }).success).toBe(true);
    expect(GuestSchema.safeParse({ ...guest, party: "" }).success).toBe(true);
  });

  it("keeps seat between 1 and 24, whole numbers, or null", () => {
    const t = uuid(1);
    expect(GuestSchema.safeParse({ ...guest, tableId: t, seat: 0 }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, tableId: t, seat: 25 }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, tableId: t, seat: 1.5 }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, tableId: t, seat: 24 }).success).toBe(true);
    expect(GuestSchema.safeParse({ ...guest, tableId: t, seat: null }).success).toBe(true);
  });

  it("refuses an id that is not a uuid", () => {
    expect(GuestSchema.safeParse({ ...guest, id: "g1" }).success).toBe(false);
    expect(GuestSchema.safeParse({ ...guest, tableId: "t1" }).success).toBe(false);
  });

  it("carries no guest text in its error output", () => {
    const secret = "Zebedee Quillfeather".repeat(10);
    const result = GuestSchema.safeParse({ ...guest, name: secret });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain("Zebedee");
    }
  });
});

describe("KitTableSchema", () => {
  it("accepts a table and refuses extra fields", () => {
    const t = tableAt(1, 10);
    expect(KitTableSchema.safeParse(t).success).toBe(true);
    expect(KitTableSchema.safeParse({ ...t, shape: "round" }).success).toBe(false);
  });

  it("bounds number 1 to 999, name 60 and seats 1 to 24", () => {
    const t = tableAt(1, 10);
    expect(KitTableSchema.safeParse({ ...t, number: 0 }).success).toBe(false);
    expect(KitTableSchema.safeParse({ ...t, number: 1000 }).success).toBe(false);
    expect(KitTableSchema.safeParse({ ...t, number: 999 }).success).toBe(true);
    expect(KitTableSchema.safeParse({ ...t, name: "n".repeat(61) }).success).toBe(false);
    expect(KitTableSchema.safeParse({ ...t, seats: 0 }).success).toBe(false);
    expect(KitTableSchema.safeParse({ ...t, seats: 25 }).success).toBe(false);
  });
});

describe("emptyGuestList and GuestListSchema", () => {
  it("makes a valid empty list at version 1", () => {
    expect(list.version).toBe(1);
    expect(list.planId).toBe(PLAN_ID);
    expect(list.guests).toEqual([]);
    expect(list.tables).toEqual([]);
    expect(list.eventDate).toBeNull();
    expect(list.sortBy).toBe("last-word");
    expect(list.paperVersion).toBe(0);
    expect(list.changedSincePrint).toBe(false);
    expect(list.updatedAt).toBe(NOW);
    expect(GuestListSchema.safeParse(list).success).toBe(true);
  });

  it("refuses an extra field, a wrong version and a bad date", () => {
    expect(GuestListSchema.safeParse({ ...list, owner: "x" }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, version: 2 }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, eventDate: "12/06/2027" }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, eventDate: "2027-02-30" }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, eventDate: "2027-06-12" }).success).toBe(true);
    expect(GuestListSchema.safeParse({ ...list, updatedAt: "yesterday" }).success).toBe(false);
  });

  it("allows 600 guests and refuses 601", () => {
    const many = (n: number): Guest[] => Array.from({ length: n }, (_, i) => guestAt(i, null, null));
    expect(GuestListSchema.safeParse({ ...list, guests: many(GUESTS_MAX) }).success).toBe(true);
    expect(GuestListSchema.safeParse({ ...list, guests: many(GUESTS_MAX + 1) }).success).toBe(false);
  });

  it("allows 80 tables and refuses 81", () => {
    const many = (n: number): KitTable[] => Array.from({ length: n }, (_, i) => tableAt(i + 1, 10));
    expect(GuestListSchema.safeParse({ ...list, tables: many(TABLES_MAX) }).success).toBe(true);
    expect(GuestListSchema.safeParse({ ...list, tables: many(TABLES_MAX + 1) }).success).toBe(false);
  });

  it("bounds the title at 120 and paperVersion at zero or more", () => {
    expect(GuestListSchema.safeParse({ ...list, title: "t".repeat(121) }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, paperVersion: -1 }).success).toBe(false);
    expect(GuestListSchema.safeParse({ ...list, sortBy: "surname" }).success).toBe(false);
  });
});

describe("repairGuestList", () => {
  const tables = [tableAt(1, 4), tableAt(2, 4)];

  function brokenList(): GuestList {
    const guests: Guest[] = [
      guestAt(1, uuid(1), 1), // fine
      guestAt(2, uuid(1), 2), // fine
      guestAt(3, uuid(1), 2), // seat taken twice (guest 2 keeps it)
      guestAt(4, uuid(2), 1), // fine
      guestAt(5, uuid(9), 3), // table is gone
      guestAt(6, uuid(2), 5), // beyond the table's four seats
      guestAt(7, uuid(2), 4), // fine
      guestAt(8, uuid(2), null), // at a table, no seat: left alone
      guestAt(9, null, null), // to seat: left alone
      guestAt(10, uuid(1), 4), // fine
    ];
    return { ...list, tables, guests };
  }

  it("unseats, and counts, a guest whose table is gone, whose seat is taken twice, or beyond the table's seats", () => {
    const { list: repaired, unseated } = repairGuestList(brokenList());
    expect(unseated).toBe(3);
    expect(repaired.guests.filter((g) => g.tableId === null).length).toBe(4);
    expect(repaired.guests.every((g) => g.tableId !== null || g.seat === null)).toBe(true);
  });

  it("keeps the first guest, in list order, when two hold one seat", () => {
    const { list: repaired } = repairGuestList(brokenList());
    const byId = new Map(repaired.guests.map((g) => [g.id, g]));
    expect(byId.get(uuid(1002))?.seat).toBe(2);
    expect(byId.get(uuid(1002))?.tableId).toBe(uuid(1));
    expect(byId.get(uuid(1003))?.tableId).toBeNull();
    expect(byId.get(uuid(1003))?.seat).toBeNull();
  });

  it("never reorders guests and leaves unbroken guests unchanged", () => {
    const input = brokenList();
    const { list: repaired } = repairGuestList(input);
    expect(repaired.guests.map((g) => g.id)).toEqual(input.guests.map((g) => g.id));
    for (const i of [0, 1, 3, 6, 7, 8, 9]) {
      expect(repaired.guests[i]).toEqual(input.guests[i]);
    }
  });

  it("does not change the input", () => {
    const input = brokenList();
    const before = JSON.stringify(input);
    repairGuestList(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns zero and an equal list when nothing is broken", () => {
    const clean: GuestList = { ...list, tables, guests: [guestAt(1, uuid(1), 1), guestAt(2, uuid(2), 1), guestAt(3, null, null)] };
    const result = repairGuestList(clean);
    expect(result.unseated).toBe(0);
    expect(result.list).toEqual(clean);
  });

  it("clears a seat on a guest with no table without counting it as unseated", () => {
    const odd: GuestList = { ...list, tables, guests: [guestAt(1, null, 3)] };
    const result = repairGuestList(odd);
    expect(result.unseated).toBe(0);
    expect(result.list.guests[0]).toEqual(guestAt(1, null, null));
  });

  it("treats the same seat number at two different tables as different seats", () => {
    const two: GuestList = { ...list, tables, guests: [guestAt(1, uuid(1), 1), guestAt(2, uuid(2), 1)] };
    expect(repairGuestList(two).unseated).toBe(0);
  });
});

describe("deleteAfter", () => {
  it("deletes 30 days after the event, or 90 days after the last change with no date", () => {
    expect(deleteAfter({ ...list, eventDate: "2027-06-12" })).toEqual({ dateIso: "2027-07-12", rule: "event" });
    expect(deleteAfter({ ...list, eventDate: null, updatedAt: "2026-11-13T10:00:00.000Z" }).dateIso).toBe("2027-02-11");
    expect(deleteAfter({ ...list, eventDate: null, updatedAt: "2026-11-13T10:00:00.000Z" }).rule).toBe("change");
  });

  it("counts across month and year ends, and a leap day, in UTC", () => {
    expect(deleteAfter({ ...list, eventDate: "2027-12-15" }).dateIso).toBe("2028-01-14");
    expect(deleteAfter({ ...list, eventDate: "2028-02-10" }).dateIso).toBe("2028-03-11");
    expect(deleteAfter({ ...list, eventDate: null, updatedAt: "2026-11-13T23:59:59.000Z" }).dateIso).toBe("2027-02-11");
    expect(deleteAfter({ ...list, eventDate: null, updatedAt: "2026-11-13T00:00:00.000Z" }).dateIso).toBe("2027-02-11");
  });
});
