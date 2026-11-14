import { describe, it, expect } from "vitest";
import { GUEST_NAME_MAX, PARTY_MAX, GUESTS_MAX } from "../model.js";
import { parsePaste, takeNames } from "../parse-paste.js";

// Characters are built from code points so no source line carries a raw
// control, zero-width or right-to-left character.
const chars = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
const E_DIAERESIS = chars(0xeb);
const COMBINING_DIAERESIS = chars(0x308);
const PARTY_POPPER = chars(0x1f389);
const ZERO_WIDTH_SPACE = chars(0x200b);
const NO_BREAK_SPACE = chars(0xa0);
const NUL = chars(0);
const BEL = chars(7);
const HEBREW_NAME = `${chars(0x5d3, 0x5e0, 0x5d9, 0x5d0, 0x5dc)} ${chars(0x5db, 0x5d4, 0x5df)}`;
const LONE_SURROGATE = String.fromCharCode(0xd800);

const ONE_COLUMN = { nameColumn: 0, secondNameColumn: null, secondFirst: false, partyColumn: null } as const;

const SURNAMES = ["Fraser", "Okafor", "Campbell", "Nowak", "Haddad", "Murray"] as const;

/** A header and 180 rows over four columns: first name, surname, household, diet. */
const SHEET_4_COLUMNS_180_ROWS = [
  "First name\tSurname\tHousehold\tDiet",
  ...Array.from({ length: 180 }, (_, i) => {
    const surname = SURNAMES[i % SURNAMES.length] ?? "Fraser";
    const first = i === 0 ? "Ailsa" : `Guest${String(i)}`;
    return `${first}\t${surname}\t${surname}\tvegetarian`;
  }),
].join("\n");

const FIVE_THOUSAND_NAMES = Array.from({ length: 5000 }, (_, i) => `Guest Number ${String(i)}`).join("\n");

describe("parsePaste", () => {
  it("reads a spreadsheet paste (tabs) and guesses the columns from the header", () => {
    const p = parsePaste("First name\tSurname\tHousehold\tDiet\nAilsa\tFraser\tFraser\tvegetarian\nChidi\tOkafor\tOkafor\t");
    expect([p.hadHeader, p.columnCount, p.nameColumn, p.secondNameColumn, p.partyColumn]).toEqual([true, 4, 0, 1, 2]);
    expect(p.rows.length).toBe(2);
    expect(p.rows[0]).toEqual(["Ailsa", "Fraser", "Fraser", "vegetarian"]);
  });

  it("keeps a quoted cell with a comma whole", () => {
    expect(parsePaste('"Fraser, Ailsa",Top table\n"Okafor, Chidi",Top table').rows[0]).toEqual(["Fraser, Ailsa", "Top table"]);
  });

  it("reads one name a line, blank lines and stray spaces and all", () => {
    expect(parsePaste("  Ailsa   Fraser \n\nChidi Okafor\n").rows).toEqual([["Ailsa Fraser"], ["Chidi Okafor"]]);
  });

  it("reads commas as columns only when every non-blank line has the same number of them", () => {
    const same = parsePaste("Ailsa,Fraser\n\nChidi,Okafor");
    expect(same.rows).toEqual([["Ailsa", "Fraser"], ["Chidi", "Okafor"]]);
    expect(same.columnCount).toBe(2);
    const uneven = parsePaste("Fraser, Ailsa\nOkafor, Chidi, Jr");
    expect(uneven.rows).toEqual([["Fraser, Ailsa"], ["Okafor, Chidi, Jr"]]);
    expect(uneven.columnCount).toBe(1);
  });

  it("does not count a comma inside quotes when deciding whether a line is comma-separated", () => {
    const p = parsePaste('"Fraser, Ailsa",Top\n"Okafor, Chidi, Jr",Top');
    expect(p.rows).toEqual([["Fraser, Ailsa", "Top"], ["Okafor, Chidi, Jr", "Top"]]);
  });

  it("reads a tab paste as tabs even when names carry commas", () => {
    expect(parsePaste("Fraser, Ailsa\tTop\nOkafor, Chidi\tTop").rows[1]).toEqual(["Okafor, Chidi", "Top"]);
  });

  it("reads CRLF and bare CR line ends, and a quoted cell that spans lines", () => {
    expect(parsePaste("Ailsa\r\nChidi\rZo").rows).toEqual([["Ailsa"], ["Chidi"], ["Zo"]]);
    expect(parsePaste('"Ailsa\nFraser"\tTop\nChidi\tTop').rows[0]).toEqual(["Ailsa Fraser", "Top"]);
  });

  it("unescapes a doubled quote inside a quoted cell", () => {
    expect(parsePaste('"Dougie ""Dod"" Murray"\tTop\nZo\tTop').rows[0]).toEqual(['Dougie "Dod" Murray', "Top"]);
  });

  it("keeps a stray or unclosed quote as plain text and still reads the rest", () => {
    const p = parsePaste('"Unclosed Name\nAilsa Fraser\n5" Table Lead');
    expect(p.rows).toEqual([['"Unclosed Name'], ["Ailsa Fraser"], ['5" Table Lead']]);
  });

  it("cleans every cell: NFC, control characters out, whitespace runs to one space", () => {
    const p = parsePaste(`Zoe${COMBINING_DIAERESIS}${NUL}${BEL}\t ${NO_BREAK_SPACE}Top   table${ZERO_WIDTH_SPACE}\n`);
    expect(p.rows[0]).toEqual([`Zo${E_DIAERESIS}`, `Top table${ZERO_WIDTH_SPACE}`]);
  });

  it("treats the first row as a header only when a cell looks like one", () => {
    expect(parsePaste("Ailsa Fraser\nChidi Okafor").hadHeader).toBe(false);
    const p = parsePaste("Guest\nAilsa Fraser");
    expect(p.hadHeader).toBe(true);
    expect(p.rows).toEqual([["Ailsa Fraser"]]);
    expect(p.nameColumn).toBe(0);
  });

  it("guesses the given-name column as the name when the surname column comes first", () => {
    const p = parsePaste("Last name\tFirst name\tGroup\nFraser\tAilsa\tTop");
    expect([p.nameColumn, p.secondNameColumn, p.partyColumn]).toEqual([1, 0, 2]);
  });

  it("guesses a lone surname-like heading as the name column", () => {
    const p = parsePaste("Surname\tParty\nFraser\tTop");
    expect([p.nameColumn, p.secondNameColumn, p.partyColumn]).toEqual([0, null, 1]);
  });

  it("guesses the first column with no second name and no party when there is no header", () => {
    const p = parsePaste("Ailsa\tFraser\tTop\nChidi\tOkafor\tTop");
    expect([p.hadHeader, p.nameColumn, p.secondNameColumn, p.partyColumn]).toEqual([false, 0, null, null]);
  });

  it("does not count trailing empty cells as columns", () => {
    expect(parsePaste("Ailsa\tFraser\t\t\nChidi\tOkafor\t\t").columnCount).toBe(2);
  });

  it("returns an empty reading for empty or blank text", () => {
    for (const text of ["", "   \n\n\t\t\n"]) {
      const p = parsePaste(text);
      expect(p.rows).toEqual([]);
      expect(p.columnCount).toBe(0);
      expect(p.hadHeader).toBe(false);
    }
  });
});

describe("takeNames", () => {
  it("takes names and parties only, and says what it left", () => {
    const t = takeNames(parsePaste(SHEET_4_COLUMNS_180_ROWS), { nameColumn: 0, secondNameColumn: 1, secondFirst: false, partyColumn: 2 }, 600);
    expect(t.guests.length).toBe(180);
    expect(t.guests[0]).toEqual({ name: "Ailsa Fraser", party: "Fraser" });
    expect(t.droppedColumns).toBe(1);
    expect(t.skipped).toEqual({ blank: 0, tooLong: 0, overLimit: 0 });
  });

  it("joins two name columns the other way round when asked", () => {
    const p = parsePaste("Fraser\tAilsa\nOkafor\tChidi");
    const t = takeNames(p, { nameColumn: 0, secondNameColumn: 1, secondFirst: true, partyColumn: null }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Ailsa Fraser", "Chidi Okafor"]);
  });

  it("keeps a guest whose second name is empty under the first name alone", () => {
    const p = parsePaste("Ailsa\t\nChidi\tOkafor");
    const t = takeNames(p, { nameColumn: 0, secondNameColumn: 1, secondFirst: false, partyColumn: null }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Ailsa", "Chidi Okafor"]);
  });

  it("refuses, and counts, a name over 80 characters and rows beyond the room left", () => {
    const t = takeNames(parsePaste(["a".repeat(500), "Ok One", "Ok Two", "Ok Three"].join("\n")), ONE_COLUMN, 2);
    expect(t.guests.map((g) => g.name)).toEqual(["Ok One", "Ok Two"]);
    expect(t.skipped).toEqual({ blank: 0, tooLong: 1, overLimit: 1 });
  });

  it("counts length in characters, not UTF-16 units: 80 emoji pass and 81 are refused whole", () => {
    const ok = PARTY_POPPER.repeat(GUEST_NAME_MAX);
    const long = PARTY_POPPER.repeat(GUEST_NAME_MAX + 1);
    const t = takeNames(parsePaste([ok, long].join("\n")), ONE_COLUMN, 600);
    expect(t.guests.map((g) => g.name)).toEqual([ok]);
    expect(t.skipped.tooLong).toBe(1);
  });

  it("applies the 80-character limit to the joined name", () => {
    const p = parsePaste(`${"a".repeat(50)}\t${"b".repeat(50)}\nAilsa\tFraser`);
    const t = takeNames(p, { nameColumn: 0, secondNameColumn: 1, secondFirst: false, partyColumn: null }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Ailsa Fraser"]);
    expect(t.skipped.tooLong).toBe(1);
  });

  it("cuts a party label over 60 characters to its first 60 and keeps the guest", () => {
    const p = parsePaste(`Ailsa\t${"h".repeat(100)}\nChidi\t${PARTY_POPPER.repeat(70)}`);
    const t = takeNames(p, { nameColumn: 0, secondNameColumn: null, secondFirst: false, partyColumn: 1 }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Ailsa", "Chidi"]);
    expect(t.guests[0]?.party).toBe("h".repeat(PARTY_MAX));
    expect(t.guests[1]?.party).toBe(PARTY_POPPER.repeat(PARTY_MAX));
    expect(t.skipped).toEqual({ blank: 0, tooLong: 0, overLimit: 0 });
  });

  it("counts a row with an empty name under blank and keeps the order of the rest", () => {
    const p = parsePaste(`\tTop\nAilsa\tTop\n${BEL} ${NO_BREAK_SPACE}\tTop\nChidi\t`);
    const t = takeNames(p, { nameColumn: 0, secondNameColumn: null, secondFirst: false, partyColumn: 1 }, 600);
    expect(t.guests).toEqual([
      { name: "Ailsa", party: "Top" },
      { name: "Chidi", party: "" },
    ]);
    expect(t.skipped.blank).toBe(2);
  });

  it("counts a row whose name cell is missing as blank", () => {
    const p = parsePaste("Ailsa\tTop\n\tTop\nChidi");
    const t = takeNames(p, { nameColumn: 1, secondNameColumn: null, secondFirst: false, partyColumn: null }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Top", "Top"]);
    expect(t.skipped.blank).toBe(1);
  });

  it("keeps emoji, right-to-left text and a leading equals sign as plain text", () => {
    const names = ["=SUM(A1)", HEBREW_NAME, `Zo${E_DIAERESIS} ${PARTY_POPPER}`];
    const t = takeNames(parsePaste(names.join("\n")), ONE_COLUMN, 600);
    expect(t.guests.map((g) => g.name)).toEqual(names);
  });

  it("takes 5,000 rows without throwing and stops at the room left", () => {
    expect(takeNames(parsePaste(FIVE_THOUSAND_NAMES), ONE_COLUMN, 600).skipped.overLimit).toBe(4400);
  });

  it("never takes more than the list limit, whatever room the caller claims", () => {
    const t = takeNames(parsePaste(FIVE_THOUSAND_NAMES), ONE_COLUMN, 1_000_000);
    expect(t.guests.length).toBe(GUESTS_MAX);
    expect(t.skipped.overLimit).toBe(5000 - GUESTS_MAX);
  });

  it("takes nothing when no room is left, and treats a bad room as none", () => {
    for (const room of [0, -3, Number.NaN]) {
      const t = takeNames(parsePaste("Ailsa\nChidi"), ONE_COLUMN, room);
      expect(t.guests).toEqual([]);
      expect(t.skipped.overLimit).toBe(2);
    }
  });

  it("counts every column not taken, and counts a repeated or missing pick once", () => {
    const p = parsePaste("a\tb\tc\td\te");
    const take = (pick: { nameColumn: number; secondNameColumn: number | null; partyColumn: number | null }): number =>
      takeNames(p, { ...pick, secondFirst: false }, 600).droppedColumns;
    expect(take({ nameColumn: 0, secondNameColumn: null, partyColumn: null })).toBe(4);
    expect(take({ nameColumn: 0, secondNameColumn: 0, partyColumn: 0 })).toBe(4);
    expect(take({ nameColumn: 0, secondNameColumn: 9, partyColumn: null })).toBe(4);
    expect(take({ nameColumn: 4, secondNameColumn: 1, partyColumn: 2 })).toBe(2);
  });

  it("does not repeat a name when the second column is the name column", () => {
    const t = takeNames(parsePaste("Ailsa\nChidi"), { nameColumn: 0, secondNameColumn: 0, secondFirst: false, partyColumn: null }, 600);
    expect(t.guests.map((g) => g.name)).toEqual(["Ailsa", "Chidi"]);
  });
});

describe("pasted text stays out of errors", () => {
  it("does not throw on hostile input or a bad pick", () => {
    const hostile = [
      '"',
      '""',
      '"\t"',
      `${NUL}${NUL}`,
      LONE_SURROGATE,
      `${'"'.repeat(10_000)}\n${"x".repeat(10_000)}`,
      "\t".repeat(5000),
      "a,b\nc",
    ];
    for (const text of hostile) {
      let thrown: unknown = null;
      try {
        takeNames(parsePaste(text), { nameColumn: -1, secondNameColumn: 99, secondFirst: true, partyColumn: 1.5 }, 600);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeNull();
    }
  });

  it("reads a large paste of unclosed quotes in linear time", () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `"Name ${String(i)}`).join("\n");
    const start = performance.now();
    const p = parsePaste(text);
    expect(p.rows.length).toBe(20_000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
