import { describe, it, expect } from "vitest";
import { emptyGuestList, type Guest, type GuestList, type KitTable } from "../model.js";
import { toCsv } from "../export.js";

const PLAN_ID = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const NOW = "2026-11-13T10:00:00.000Z";
const BOM = "﻿";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function tableAt(number: number): KitTable {
  return { id: uuid(number), number, name: "", seats: 10 };
}

function guestAt(n: number, name: string, party: string, number: number | null, seat: number | null): Guest {
  return { id: uuid(1000 + n), name, party, tableId: number === null ? null : uuid(number), seat };
}

function listOf(guests: readonly Guest[], tables: readonly KitTable[] = [tableAt(1), tableAt(12)]): GuestList {
  return { ...emptyGuestList(PLAN_ID, NOW), guests: [...guests], tables: [...tables] };
}

function withGuestNamed(name: string): GuestList {
  return listOf([guestAt(1, name, "", 1, 1)]);
}

describe("toCsv", () => {
  it("starts with a byte order mark and a header of quoted cells", () => {
    const csv = toCsv(emptyGuestList(PLAN_ID, NOW));
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(BOM.length)).toBe('"Name","Party","Table","Seat"\r\n');
  });

  it("writes one quoted line a guest, in list order, with the table's number", () => {
    const csv = toCsv(
      listOf([
        guestAt(1, "Ailsa Fraser", "Fraser family", 12, 3),
        guestAt(2, "Callum Macleod", "", 1, 10),
      ]),
    );
    expect(csv.slice(BOM.length).split("\r\n")).toEqual([
      '"Name","Party","Table","Seat"',
      '"Ailsa Fraser","Fraser family","12","3"',
      '"Callum Macleod","","1","10"',
      "",
    ]);
  });

  it("leaves table and seat empty for a guest with no seat", () => {
    const csv = toCsv(listOf([guestAt(1, "Ailsa Fraser", "Bride", null, null)]));
    expect(csv).toContain('"Ailsa Fraser","Bride","",""\r\n');
  });

  it("leaves table and seat empty when the guest's table is gone", () => {
    const csv = toCsv(listOf([{ ...guestAt(1, "Ailsa Fraser", "", 1, 4), tableId: uuid(99) }]));
    expect(csv).toContain('"Ailsa Fraser","","",""\r\n');
  });

  it("doubles quotes inside a cell and keeps commas and line breaks inside it", () => {
    const csv = toCsv(listOf([guestAt(1, 'Ailsa "Ally" Fraser, Dr', "a\nb", 1, 1)]));
    expect(csv).toContain('"Ailsa ""Ally"" Fraser, Dr","a\nb","1","1"\r\n');
  });

  it("ends every line with CRLF, including the last", () => {
    const csv = toCsv(listOf([guestAt(1, "A", "", 1, 1), guestAt(2, "B", "", 1, 2)]));
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(csv.split("\r\n").length).toBe(4);
  });

  it("the downloaded list cannot run as a formula", () => {
    expect(toCsv(withGuestNamed("=SUM(A1)"))).toContain("\"'=SUM(A1)\"");
    expect(toCsv(withGuestNamed("+1"))).toContain("\"'+1\"");
    expect(toCsv(withGuestNamed("-1"))).toContain("\"'-1\"");
    expect(toCsv(withGuestNamed("@cmd"))).toContain("\"'@cmd\"");
    expect(toCsv(withGuestNamed("\tcmd"))).toContain("\"'\tcmd\"");
    expect(toCsv(withGuestNamed("\rcmd"))).toContain("\"'\rcmd\"");
  });

  it("guards the party cell the same way, and leaves a plain cell alone", () => {
    const csv = toCsv(listOf([guestAt(1, "Ailsa Fraser", "=HYPERLINK(1)", 1, 1)]));
    expect(csv).toContain("\"Ailsa Fraser\",\"'=HYPERLINK(1)\"");
    expect(csv).not.toContain("\"'Ailsa");
    expect(toCsv(withGuestNamed("A=B"))).toContain('"A=B"');
  });

  it("does not throw on odd names and does not change the list", () => {
    const list = withGuestNamed("\u0000\uD800 odd");
    const before = JSON.stringify(list);
    expect(() => toCsv(list)).not.toThrow();
    expect(JSON.stringify(list)).toBe(before);
  });
});
