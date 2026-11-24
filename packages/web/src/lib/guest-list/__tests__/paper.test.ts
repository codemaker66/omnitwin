import { describe, it, expect } from "vitest";
import { emptyGuestList, type Guest, type GuestList, type KitTable } from "../model.js";
import {
  sortKey,
  planLabel,
  tablePlanAZ,
  byTable,
  covers,
  placeCards,
  markPrinted,
} from "../paper.js";
import { parsePaste, takeNames, type ParsedPaste } from "../parse-paste.js";

const PLAN_ID = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const NOW = "2026-11-13T10:00:00.000Z";
const LATER = "2026-11-14T09:30:00.000Z";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function tableAt(number: number, seats = 10, name = ""): KitTable {
  return { id: uuid(number), number, name, seats };
}

function guestAt(n: number, name: string, number: number | null, seat: number | null): Guest {
  return { id: uuid(1000 + n), name, party: "", tableId: number === null ? null : uuid(number), seat };
}

function listOf(guests: readonly Guest[], tables: readonly KitTable[]): GuestList {
  return { ...emptyGuestList(PLAN_ID, NOW), guests: [...guests], tables: [...tables] };
}

/** 180 guests, 18 tables of ten: tables 1 to 16 full, 17 and 18 hold six each, 8 not seated. */
function list172of180(): GuestList {
  const tables = Array.from({ length: 18 }, (_, i) => tableAt(i + 1));
  const guests: Guest[] = [];
  let n = 0;
  for (const table of tables) {
    const count = table.number <= 16 ? 10 : 6;
    for (let seat = 1; seat <= count; seat += 1) {
      n += 1;
      guests.push(guestAt(n, `Given${String(n)} Family${String(n)}`, table.number, seat));
    }
  }
  for (let i = 0; i < 8; i += 1) {
    n += 1;
    guests.push(guestAt(n, `Given${String(n)} Family${String(n)}`, null, null));
  }
  return listOf(guests, tables);
}

/** The names a paste gives, as the page takes them, each seated at table 1 in paste order. */
function pastedAndSeated(parsed: ParsedPaste): GuestList {
  const pick = { nameColumn: parsed.nameColumn, secondNameColumn: parsed.secondNameColumn, secondFirst: false, partyColumn: parsed.partyColumn };
  const taken = takeNames(parsed, pick, 600).guests;
  return listOf(taken.map((g, at) => guestAt(at + 1, g.name, 1, at + 1)), [tableAt(1, 24)]);
}

function lettersAndLabels(plan: ReturnType<typeof tablePlanAZ>): readonly (readonly [string, readonly string[]])[] {
  return plan.groups.map((g) => [g.letter, g.entries.map((e) => e.label)] as const);
}

function threeGuests(): GuestList {
  return listOf(
    [
      guestAt(1, "Niall O'Neil", 2, 1),
      guestAt(2, "Ailsa Fraser", 1, 1),
      guestAt(3, "Callum Macleod", 1, 2),
    ],
    [tableAt(1), tableAt(2)],
  );
}

describe("sortKey and planLabel", () => {
  it("puts the last word first for a last-word sort", () => {
    expect(sortKey("Ailsa Jean Fraser", "last-word")).toBe("Fraser Ailsa Jean");
    expect(planLabel("Ailsa Jean Fraser", "last-word")).toBe("Fraser, Ailsa Jean");
    expect(planLabel("Mr and Mrs Fraser", "last-word")).toBe("Fraser, Mr and Mrs");
  });

  it("uses the name as written for a first-word sort", () => {
    expect(sortKey("Mr and Mrs Fraser", "first-word")).toBe("Mr and Mrs Fraser");
    expect(planLabel("Mr and Mrs Fraser", "first-word")).toBe("Mr and Mrs Fraser");
  });

  it("treats a one-word name as its own key and its own label", () => {
    expect(sortKey("Zoë", "last-word")).toBe("Zoë");
    expect(planLabel("Zoë", "last-word")).toBe("Zoë");
  });

  it("ignores extra spaces between words when finding the last word", () => {
    expect(sortKey("  Ailsa   Fraser ", "last-word")).toBe("Fraser Ailsa");
    expect(planLabel("  Ailsa   Fraser ", "last-word")).toBe("Fraser, Ailsa");
  });

  it("files a name written \"Surname, Given\" (one comma, words on both sides) under the surname", () => {
    expect(sortKey("Fraser, Ailsa", "last-word")).toBe("Fraser Ailsa");
    expect(planLabel("Fraser, Ailsa", "last-word")).toBe("Fraser, Ailsa");
    expect(sortKey("Fraser,Ailsa", "last-word")).toBe("Fraser Ailsa");
    expect(planLabel("Fraser,Ailsa", "last-word")).toBe("Fraser, Ailsa");
    expect(sortKey("Fraser, Ailsa Jean", "last-word")).toBe("Fraser Ailsa Jean");
    expect(planLabel("Fraser, Ailsa Jean", "last-word")).toBe("Fraser, Ailsa Jean");
    expect(sortKey("  Mac  Leod ,  Morag ", "last-word")).toBe("Mac Leod Morag");
    expect(planLabel("  Mac  Leod ,  Morag ", "last-word")).toBe("Mac Leod, Morag");
  });

  it("files a name with more than one comma, or a comma at an end, as written", () => {
    for (const name of ["Fraser, Ailsa, Jean", "Fraser,", "Ailsa Fraser,", ", Ailsa", "Fraser ,", ","]) {
      expect(sortKey(name, "last-word"), name).toBe(name);
      expect(planLabel(name, "last-word"), name).toBe(name);
    }
  });

  it("leaves a comma name as written for a first-word sort", () => {
    expect(sortKey("Fraser, Ailsa", "first-word")).toBe("Fraser, Ailsa");
    expect(planLabel("Fraser, Ailsa", "first-word")).toBe("Fraser, Ailsa");
  });
});

describe("tablePlanAZ", () => {
  it("puts only seated guests on the table plan and counts the rest", () => {
    const plan = tablePlanAZ(list172of180());
    expect(plan.notSeated).toBe(8);
    expect(plan.groups.flatMap((g) => g.entries).length).toBe(172);
  });

  it("groups under the first letter of the sort key, with the table's number", () => {
    const plan = tablePlanAZ(threeGuests());
    expect(plan.groups.map((g) => g.letter)).toEqual(["F", "M", "O"]);
    expect(plan.groups[0]?.entries).toEqual([{ label: "Fraser, Ailsa", table: 1 }]);
    expect(plan.groups[2]?.entries).toEqual([{ label: "O'Neil, Niall", table: 2 }]);
    expect(plan.notSeated).toBe(0);
  });

  it("orders accents and case as a reader expects, grouping with accents folded", () => {
    const list = listOf(
      [guestAt(1, "Zoë", 1, 1), guestAt(2, "eze", 1, 2), guestAt(3, "Éireann", 1, 3)],
      [tableAt(1)],
    );
    const plan = tablePlanAZ(list);
    expect(plan.groups.map((g) => g.letter)).toEqual(["E", "Z"]);
    expect(plan.groups[0]?.entries.map((e) => e.label)).toEqual(["Éireann", "eze"]);
    expect(plan.groups[1]?.entries.map((e) => e.label)).toEqual(["Zoë"]);
  });

  it("sorts first-word lists by the name as written", () => {
    const list = {
      ...listOf(
        [guestAt(1, "Mr and Mrs Fraser", 1, 1), guestAt(2, "Aunt Morag", 1, 2)],
        [tableAt(1)],
      ),
      sortBy: "first-word" as const,
    };
    const plan = tablePlanAZ(list);
    expect(plan.groups.map((g) => g.letter)).toEqual(["A", "M"]);
    expect(plan.groups[1]?.entries[0]?.label).toBe("Mr and Mrs Fraser");
  });

  it("puts a name that does not start with a letter under #, first", () => {
    const list = listOf(
      [guestAt(1, "Ailsa Fraser", 1, 1), guestAt(2, "007", 1, 2), guestAt(3, "“Jo”", 1, 3)],
      [tableAt(1)],
    );
    const plan = tablePlanAZ(list);
    expect(plan.groups.map((g) => g.letter)).toEqual(["#", "F"]);
    expect(plan.groups[0]?.entries.length).toBe(2);
  });

  it("breaks a tie in the sort key by label", () => {
    const list = {
      ...listOf([guestAt(1, "Ann Reid", 1, 1), guestAt(2, "Ann reid", 1, 2)], [tableAt(1)]),
      sortBy: "first-word" as const,
    };
    const labels = tablePlanAZ(list).groups.flatMap((g) => g.entries.map((e) => e.label));
    expect(labels).toEqual(["Ann reid", "Ann Reid"]);
  });

  it("counts a guest whose table is gone as not seated, and never fails", () => {
    const list = listOf(
      [guestAt(1, "Ailsa Fraser", 1, 1), { ...guestAt(2, "Callum Macleod", 1, 2), tableId: uuid(99) }],
      [tableAt(1)],
    );
    const plan = tablePlanAZ(list);
    expect(plan.notSeated).toBe(1);
    expect(plan.groups.flatMap((g) => g.entries).length).toBe(1);
  });

  it("files \"Surname, Given\" names under the surname's letter", () => {
    const list = listOf(
      [guestAt(1, "Fraser, Ailsa", 1, 1), guestAt(2, "McDonald, Hamish", 1, 2), guestAt(3, "Ada Canary", 1, 3)],
      [tableAt(1)],
    );
    const plan = tablePlanAZ(list);
    expect(plan.groups.map((g) => [g.letter, g.entries.map((e) => e.label)])).toEqual([
      ["C", ["Canary, Ada"]],
      ["F", ["Fraser, Ailsa"]],
      ["M", ["McDonald, Hamish"]],
    ]);
  });

  it("files a pasted one-column list that mixes \"Ada Canary\" and \"Fraser, Ailsa\" lines under the surnames", () => {
    const parsed = parsePaste("Ada Canary\nFraser, Ailsa\nMary Example\nMcDonald, Hamish");
    expect(parsed.columnCount).toBe(1);
    const plan = tablePlanAZ(pastedAndSeated(parsed));
    expect(lettersAndLabels(plan)).toEqual([
      ["C", ["Canary, Ada"]],
      ["E", ["Example, Mary"]],
      ["F", ["Fraser, Ailsa"]],
      ["M", ["McDonald, Hamish"]],
    ]);
    expect(plan.groups.flatMap((g) => g.entries).filter((e) => e.label.endsWith(","))).toEqual([]);
  });

  it("files a pasted sheet whose Name cell is \"Fraser, Ailsa\" under the surname", () => {
    const parsed = parsePaste("Name\tParty\nFraser, Ailsa\tFraser\nAda Canary\tCanary");
    expect(parsed.columnCount).toBe(2);
    const plan = tablePlanAZ(pastedAndSeated(parsed));
    expect(lettersAndLabels(plan)).toEqual([
      ["C", ["Canary, Ada"]],
      ["F", ["Fraser, Ailsa"]],
    ]);
    expect(plan.groups.flatMap((g) => g.entries).filter((e) => e.label.endsWith(","))).toEqual([]);
  });

  it("returns nothing for an empty list", () => {
    expect(tablePlanAZ(emptyGuestList(PLAN_ID, NOW))).toEqual({ groups: [], notSeated: 0 });
  });

  it("does not change the list it is given", () => {
    const list = threeGuests();
    const before = JSON.stringify(list);
    tablePlanAZ(list);
    byTable(list);
    covers(list);
    placeCards(list);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("byTable", () => {
  it("lists every table in number order, a table's guests by seat", () => {
    const list = listOf(
      [
        guestAt(1, "Third", 2, 3),
        guestAt(2, "First", 2, 1),
        guestAt(3, "Second", 2, 2),
        guestAt(4, "Only", 5, 4),
      ],
      [tableAt(5, 8, "Top"), tableAt(2, 10), tableAt(3, 6)],
    );
    const tables = byTable(list);
    expect(tables.map((t) => t.number)).toEqual([2, 3, 5]);
    expect(tables[0]).toEqual({
      number: 2,
      name: "",
      seats: 10,
      guests: [
        { seat: 1, name: "First" },
        { seat: 2, name: "Second" },
        { seat: 3, name: "Third" },
      ],
    });
    expect(tables[1]).toEqual({ number: 3, name: "", seats: 6, guests: [] });
    expect(tables[2]).toEqual({ number: 5, name: "Top", seats: 8, guests: [{ seat: 4, name: "Only" }] });
  });

  it("leaves out a guest whose table is gone", () => {
    const list = listOf([{ ...guestAt(1, "Lost", 1, 1), tableId: uuid(99) }], [tableAt(1)]);
    expect(byTable(list)[0]?.guests).toEqual([]);
  });
});

describe("covers", () => {
  it("adds up to the seated count, table by table", () => {
    const result = covers(list172of180());
    expect(result).toMatchObject({ total: 172 });
    expect(result.tables[16]).toEqual({ number: 17, covers: 6 });
    expect(result.tables.reduce((sum, t) => sum + t.covers, 0)).toBe(172);
  });

  it("lists a table with nobody at it as zero covers, in number order", () => {
    const list = listOf([guestAt(1, "Only", 3, 1)], [tableAt(3), tableAt(1), tableAt(2)]);
    expect(covers(list)).toEqual({
      tables: [
        { number: 1, covers: 0 },
        { number: 2, covers: 0 },
        { number: 3, covers: 1 },
      ],
      total: 1,
    });
  });

  it("does not count a guest whose table is gone", () => {
    const list = listOf([{ ...guestAt(1, "Lost", 1, 1), tableId: uuid(99) }], [tableAt(1)]);
    expect(covers(list)).toEqual({ tables: [{ number: 1, covers: 0 }], total: 0 });
  });
});

describe("placeCards", () => {
  it("makes one card for each seated guest, by table number then seat, name as written", () => {
    const list = listOf(
      [
        guestAt(1, "Ailsa Fraser", 2, 2),
        guestAt(2, "Mr and Mrs Reid", 1, 5),
        guestAt(3, "Callum Macleod", 2, 1),
        guestAt(4, "Not Seated", null, null),
        guestAt(5, "Niall O'Neil", 1, 2),
      ],
      [tableAt(2), tableAt(1)],
    );
    expect(placeCards(list)).toEqual([
      { name: "Niall O'Neil", table: 1 },
      { name: "Mr and Mrs Reid", table: 1 },
      { name: "Callum Macleod", table: 2 },
      { name: "Ailsa Fraser", table: 2 },
    ]);
  });

  it("makes 172 cards for the 172 seated guests", () => {
    expect(placeCards(list172of180()).length).toBe(172);
  });
});

describe("markPrinted", () => {
  const changed: GuestList = { ...threeGuests(), changedSincePrint: true };

  it("makes a first print version 1, and prints again unchanged at the same version", () => {
    const once = markPrinted(changed, NOW);
    expect([once.paperVersion, once.changedSincePrint]).toEqual([1, false]);
    expect(markPrinted(once, NOW).paperVersion).toBe(1);
  });

  it("makes a first print version 1 even when nothing is marked as changed", () => {
    const fresh: GuestList = { ...threeGuests(), changedSincePrint: false };
    expect(fresh.paperVersion).toBe(0);
    expect(markPrinted(fresh, NOW).paperVersion).toBe(1);
  });

  it("adds one to the version only when something changed since the last print", () => {
    const once = markPrinted(changed, NOW);
    const edited: GuestList = { ...once, changedSincePrint: true };
    const twice = markPrinted(edited, LATER);
    expect([twice.paperVersion, twice.changedSincePrint]).toEqual([2, false]);
  });

  it("records the print time every time, and leaves updatedAt alone", () => {
    const once = markPrinted(changed, NOW);
    expect(once.printedAt).toBe(NOW);
    const again = markPrinted(once, LATER);
    expect(again.printedAt).toBe(LATER);
    expect(again.paperVersion).toBe(1);
    expect(again.updatedAt).toBe(changed.updatedAt);
  });

  it("does not change the list it is given", () => {
    const before = JSON.stringify(changed);
    markPrinted(changed, NOW);
    expect(JSON.stringify(changed)).toBe(before);
  });
});
