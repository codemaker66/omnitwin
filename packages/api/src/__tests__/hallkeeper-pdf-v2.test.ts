import { describe, it, expect } from "vitest";
import type { EventInstructions, HallkeeperSheetV2 } from "@omnitwin/types";
import { generateSheetPdfV2, sheetCopyLine, sheetQrTarget } from "../services/hallkeeper-pdf-v2.js";
import { buildSheetPaperCheck } from "../services/sheet-paper-check.js";
import { renderMetrics, __resetMetricsForTests } from "../observability/metrics.js";
import { boardMeetingSheet, emptyDraftSheet, longTextSheet, weddingSheet } from "./fixtures/hallkeeper-sheet-fixtures.js";
import { pdfImageCount, pdfPages, pdfText, type PdfLine } from "./helpers/pdf-text.js";

// ---------------------------------------------------------------------------
// The hallkeeper sheet PDF, "the brief, then the room" (design:
// docs/superpowers/specs/2026-10-18-hallkeeper-sheet-redesign-design.md).
//
// These read the PDF's own content streams back (helpers/pdf-text.ts): the
// text a viewer shows, where it sits and how wide it runs. The fixtures go
// through the real manifest generator and floor-plan builder.
// ---------------------------------------------------------------------------

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
/** Footer baselines sit in the bottom 40 pt; everything else above it. */
const FOOTER_TOP = 40;

const BASE_SHEET: HallkeeperSheetV2 = {
  config: { id: "00000000-0000-0000-0000-000000000001", name: "Anderson Wedding Reception", guestCount: 120, layoutStyle: "dinner-rounds" },
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford St, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
  timing: { eventStart: "2026-06-15T18:00:00.000Z", setupBy: "2026-06-15T16:30:00.000Z", bufferMinutes: 90 },
  instructions: null,
  phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
    key: "furniture|Centre|6ft Round Table with 10 chairs|0", name: "6ft Round Table with 10 chairs", category: "table",
    qty: 8, afterDepth: 0, isAccessory: false, notes: "", positions: [],
  }] }] }],
  totals: { entries: [{ name: "6ft Round Table with 10 chairs", category: "table", qty: 8 }], totalRows: 1, totalItems: 8 },
  diagramUrl: null,
  webViewUrl: "http://localhost:5173/hallkeeper/cfg",
  generatedAt: "2026-04-16T10:00:00.000Z",
  approval: null,
};

const EMPTY_INSTRUCTIONS: EventInstructions = {
  specialInstructions: "", dayOfContact: null, phaseDeadlines: [], accessNotes: "",
  accessibility: null, dietary: null, doorSchedule: null,
};

async function withPaperCheck(sheet: HallkeeperSheetV2, issued: boolean): Promise<HallkeeperSheetV2> {
  const issue = issued ? { snapshotId: "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d", version: sheet.approval?.version ?? 1, sourceHash: "ab".repeat(32) } : null;
  const paperCheck = await buildSheetPaperCheck("https://venviewer.com", sheet.config.id, issue);
  return paperCheck === null ? sheet : { ...sheet, paperCheck };
}

const textOf = (lines: readonly PdfLine[]): string => lines.map((line) => line.text).join(" ").replace(/\s+/gu, " ");
const isFooter = (line: PdfLine): boolean => line.y < FOOTER_TOP;

function expectInsideMargins(pages: readonly (readonly PdfLine[])[]): void {
  for (const [index, page] of pages.entries()) {
    for (const line of page) {
      const where = `page ${String(index + 1)}: "${line.text.slice(0, 40)}"`;
      expect(Math.min(line.x, line.x2), where).toBeGreaterThanOrEqual(MARGIN - 1);
      expect(Math.max(line.x, line.x2), where).toBeLessThanOrEqual(PAGE_W - MARGIN + 1);
      expect(Math.min(line.y, line.y2), where).toBeGreaterThan(20);
      expect(Math.max(line.y, line.y2), where).toBeLessThan(PAGE_H - MARGIN + 6);
    }
  }
}

function expectFooterOnEveryPage(pages: readonly (readonly PdfLine[])[], copyLine: string): void {
  for (const [index, page] of pages.entries()) {
    const footer = textOf(page.filter(isFooter));
    expect(footer, `page ${String(index + 1)}`).toContain(copyLine);
    expect(footer, `page ${String(index + 1)}`).toContain(`Page ${String(index + 1)} of ${String(pages.length)}`);
    expect(page.some((line) => !isFooter(line)), `page ${String(index + 1)} carries more than a footer`).toBe(true);
  }
}

describe("the four fixtures, laid out", () => {
  it("sets a full Grand Hall wedding on three pages at most, inside the margins", async () => {
    const sheet = await withPaperCheck(weddingSheet(), true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expect(pages.length).toBeLessThanOrEqual(3);
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    expectInsideMargins(pages);
  });

  it("puts the day on page 1: ready-by time, guests, keep in view, the day in order and the store", async () => {
    const pages = pdfPages(await generateSheetPdfV2(await withPaperCheck(weddingSheet(), true)));
    const first = textOf(pages[0] ?? []);
    for (const words of ["HALLKEEPER SHEET · TRADES HALL GLASGOW", "Mackenzie–Ross wedding breakfast", "READY BY", "13:30", "14:30", "120",
      "KEEP IN VIEW", "Hearing loop in Centre", "2 nut-free", "Kirsty Mackenzie", "07700 900412",
      "THE DAY, IN ORDER", "Room ready", "Event starts", "Sun 25 Oct", "Team briefing",
      "FROM THE STORE", "Chiavari Wedding Chair", "FROM THE PLANNER", "ACCESS AND LOAD-IN"]) {
      expect(first, words).toContain(words);
    }
    expect(first).toContain("Approved by Fiona Grant · v3, issued 22 Oct 16:12, printed 24 Oct 07:42");
  });

  it("draws the room with the planner's table names and numbered notes, then the setup in order", async () => {
    const text = pdfText(await generateSheetPdfV2(await withPaperCheck(weddingSheet(), true)));
    expect(text).toContain("THE ROOM · GRAND HALL");
    expect(text).toContain("Top table");
    expect(text).toContain("Table 5: severe peanut allergy at seat 4, catering has the card");
    expect(text).toContain("Drawn from the saved layout, looking down.");
    expect(text).toContain("Setup, in order");
    expect(text.match(/Parquet Dance Floor Panel/gu)).toHaveLength(2); // store list and one setup line
    expect(text).toContain("Perimeter 16 · East wall 10 · Centre 4");
    expect(text).toContain("10 chairs each");
    expect(text).toContain("done by 10:00 · Band loads in at 10:15");
    expect(text).toContain("Final touches");
    expect(text).toContain("Room set by");
    expect(text).toContain("MARTYN'S LAW READINESS · PROMPTS ONLY");
  });

  it("sets a lean board meeting on two pages at most", async () => {
    const sheet = await withPaperCheck(boardMeetingSheet(), false);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expect(pages.length).toBeLessThanOrEqual(2);
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    expectInsideMargins(pages);
    expect(pdfText(await generateSheetPdfV2(sheet))).toContain("Draft, printed 24 Oct 07:05 · not yet approved. Check with the duty manager before setting up.");
  });

  it("sets an empty draft on one page and says what is missing", async () => {
    const sheet = await withPaperCheck(emptyDraftSheet(), false);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expect(pages).toHaveLength(1);
    const text = textOf(pages[0] ?? []);
    expect(text).toContain("No booking holds this room yet");
    expect(text).toContain("No plan was saved with this layout. Set the room from the list.");
    expect(text).toContain("Nothing is placed in this layout yet.");
    expect(text).toContain("None recorded on this sheet");
    expect(text).toContain("Nothing recorded for this event: responsible person, lead on duty, team briefing, door supervision and the four procedures are not set.");
  });

  it("flows every free-text field at its maximum across pages without losing a word", async () => {
    const sheet = await withPaperCheck(longTextSheet(), true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    expectInsideMargins(pages);
    const text = textOf(pages.flat());
    const ins = sheet.instructions;
    for (const field of [ins?.specialInstructions, ins?.accessNotes, ins?.dietary?.otherAllergies, ins?.accessibility?.notes]) {
      const tail = (field ?? "").slice(-40).replace(/\s+/gu, " ").trim();
      expect(tail.length).toBeGreaterThan(0);
      expect(text).toContain(tail);
    }
    expect(text).toContain("alexandria.montgomery-fitzwilliam@example.co.uk");
  });
});

describe("inputs that bite", () => {
  it("long title pushes the facts down and keeps clear of the code", async () => {
    const sheet = await withPaperCheck({ ...weddingSheet(), config: { ...weddingSheet().config, name: "The Mackenzie–Ross and Fraser–Lindqvist joint family celebration dinner with ceilidh, fireworks on the terrace and late carriages" } }, true);
    const page = pdfPages(await generateSheetPdfV2(sheet))[0] ?? [];
    const titleLines = page.filter((line) => line.font.includes("NewsreaderSheet-Regular") && line.size > 20);
    expect(titleLines.length).toBeGreaterThan(1);
    const facts = page.find((line) => line.text === "READY BY");
    expect(Math.min(...titleLines.map((line) => line.y)) - (facts?.y ?? Infinity)).toBeGreaterThan(10);
    for (const line of titleLines) expect(line.x + line.width).toBeLessThan(PAGE_W - MARGIN - 62);
  });

  it("draws a supplied diagram in the plan's place", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=";
    const buf = await generateSheetPdfV2({ ...weddingSheet(), diagramUrl: png });
    expect(pdfImageCount(buf)).toBe(1);
    expect(pdfText(buf)).not.toContain("Drawn from the saved layout");
  });

  it("says no plan was saved when a sheet was frozen without one", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...weddingSheet(), floorPlan: null }));
    expect(text).toContain("No plan was saved with this layout. Set the room from the list.");
    expect(text).toContain("Setup, in order");
  });

  it("a long day flows across pages", async () => {
    const base = weddingSheet();
    const at = (hour: number, minute: number): string => new Date(Date.UTC(2026, 9, 24, hour - 1, minute)).toISOString();
    const doors = Array.from({ length: 12 }, (_, door) => ({
      label: `Door ${String(door + 1)} on the ${door % 2 === 0 ? "Glassford Street" : "Garth Street"} side`,
      events: Array.from({ length: 10 }, (_, event) => ({ at: at(8 + event, door * 4), kind: event % 2 === 0 ? "open" as const : "lock" as const, note: "Staffed by the duty team" })),
    }));
    const sheet = await withPaperCheck({ ...base, instructions: { ...(base.instructions ?? EMPTY_INSTRUCTIONS), doorSchedule: { entries: doors } } }, true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expect(pages.length).toBeGreaterThan(3);
    expectInsideMargins(pages);
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    const text = textOf(pages.flat());
    for (const door of doors) expect(text).toContain(`${door.label} opens`);
  });

  it("sets a Greek title in Inter", async () => {
    const page = pdfPages(await generateSheetPdfV2({ ...BASE_SHEET, config: { ...BASE_SHEET.config, name: "Γάμος Παπαδόπουλου" } }))[0] ?? [];
    expect(page.find((line) => line.text.includes("Παπαδόπουλου"))?.font).toMatch(/InterSheet/u);
  });
});

describe("baseline guarantees", () => {
  it("produces a valid PDF", async () => {
    const buf = await generateSheetPdfV2(BASE_SHEET);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders an empty manifest and missing timing without throwing", async () => {
    await expect(generateSheetPdfV2({ ...BASE_SHEET, phases: [], timing: null })).resolves.toBeInstanceOf(Buffer);
  });

  it("counts a loose chair once in the store list", async () => {
    expect(pdfText(await generateSheetPdfV2(weddingSheet()))).toContain("1 White Highchair");
  });

  it("prints a 500-character planner note whole", async () => {
    const note = `${"Keep the chair clear for the speeches. ".repeat(13)}End.`;
    const sheet: HallkeeperSheetV2 = { ...BASE_SHEET, phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
      key: "k", name: "6ft Round Table", category: "table", qty: 1, afterDepth: 0, isAccessory: false, notes: note, positions: [],
    }] }] }] };
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expectInsideMargins(pages);
    expect(textOf(pages.flat())).toContain("speeches. End.");
  });
});

describe("times are the venue's", () => {
  const timed: HallkeeperSheetV2 = { ...BASE_SHEET, timing: { eventStart: "2026-06-15T17:30:00.000Z", setupBy: "2026-06-15T16:00:00.000Z", bufferMinutes: 90 } };
  const factsOf = async (timezone: string): Promise<string> =>
    textOf((pdfPages(await generateSheetPdfV2({ ...timed, venue: { ...timed.venue, timezone } }))[0] ?? []));

  it("prints the venue's wall clock for the ready-by time and the start", async () => {
    const text = await factsOf("Europe/London");
    expect(text).toMatch(/READY BY 17:00/u);
    expect(text).toMatch(/STARTS 18:30/u);
    expect(text).toContain("90 min before the start");
  });

  it("prints a different venue's wall clock for the same instant and names its zone", async () => {
    const text = await factsOf("America/New_York");
    expect(text).toMatch(/READY BY 12:00/u);
    expect(text).toMatch(/STARTS 13:30/u);
    expect(text).toContain("Eastern time");
  });

  it("names the reason when the ready-by time cannot be derived", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...BASE_SHEET, timing: { eventStart: "2026-06-15T17:30:00.000Z", setupBy: null, bufferMinutes: null } }));
    expect(text).toContain("No changeover time for this room");
    expect(text).toMatch(/STARTS 18:30/u);
    expect(text).not.toContain("min before the start");
  });

  it("says the times are not set rather than leaving a silent gap", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...BASE_SHEET, timing: null }));
    expect(text).toContain("No booking holds this room yet");
    expect(text).toContain("Confirm the time first");
  });
});

describe("Martyn's Law readiness (T-648)", () => {
  const sheetText = async (sheet: HallkeeperSheetV2): Promise<string> => pdfText(await generateSheetPdfV2(sheet));

  it("says plainly that nothing was recorded, so a blank is visible on paper", async () => {
    const text = await sheetText({ ...BASE_SHEET, instructions: null });
    expect(text).toContain("MARTYN'S LAW READINESS · PROMPTS ONLY");
    expect(text).toContain("Nothing recorded for this event: responsible person, lead on duty, team briefing, door supervision and the four procedures are not set.");
    expect(text).toContain("Guest count entered for this event: 120.");
    expect(text).toContain("The venue's responsible person decides what applies.");
  });

  it("prints the operator's entries on the venue's clock, with what is still unset", async () => {
    const text = await sheetText({ ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS, protectedPremises: {
      responsiblePerson: "The Trades House of Glasgow",
      dutyLead: { name: "Sarah Kerr", role: "Duty manager" },
      procedures: { evacuation: { briefed: true, note: "Evacuation plan v3" }, invacuation: { briefed: false }, lockdown: { briefed: true } },
      briefingAt: "2026-06-15T16:30:00.000Z",
      doorSupervision: { arranged: true, note: "Two door supervisors from 18:00" },
      notes: "Glassford Street door only after 19:00.",
    } } });
    expect(text).toContain("Prompts only, from what has been entered for this event.");
    expect(text).toContain("The Trades House of Glasgow");
    expect(text).toContain("Sarah Kerr · Duty manager");
    expect(text).toContain("Evacuation plan v3");
    expect(text.match(/Not briefed/gu)).toHaveLength(1);
    expect(text.match(/Not checked/gu)).toHaveLength(1);
    expect(text).toContain("Mon 15 Jun, 17:30");
    expect(text).toContain("Two door supervisors from 18:00");
    expect(text).toContain("Glassford Street door only after 19:00.");
  });

  it("reads a zero guest count as not set", async () => {
    expect(await sheetText({ ...BASE_SHEET, config: { ...BASE_SHEET.config, guestCount: 0 } })).toContain("Guest count for this event: not set.");
  });

  it("never words the Martyn's Law record as a compliance, approval or certification claim", async () => {
    const text = await sheetText({ ...BASE_SHEET, config: { ...BASE_SHEET.config, guestCount: 950 } });
    const block = text.slice(text.indexOf("MARTYN'S LAW READINESS"), text.indexOf("Page 1 of"));
    expect(block).toContain("The venue's responsible person decides what applies.");
    expect(block).not.toMatch(/\b(?:complian(?:t|ce)|certif(?:ied|y)|approv(?:ed|al)|triggers?)\b/iu);
  });

  it("keeps a short sheet with a full record on one page", async () => {
    const pages = pdfPages(await generateSheetPdfV2({ ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS, protectedPremises: { dutyLead: { name: "Sarah Kerr" }, procedures: { evacuation: { briefed: true } } } } }));
    expect(pages).toHaveLength(1);
  });
});

describe("paper that knows its version", () => {
  const CHECK_URL = "https://venviewer.com/sheet-check?s=5b8f2c1e-3d4a-4f6b-9c7d-1e2f3a4b5c6d&v=7&h=0123456789abcdef";
  const qr = { size: 21, rows: Array.from({ length: 21 }, () => "0".repeat(21)) };
  const issued: HallkeeperSheetV2 = {
    ...BASE_SHEET,
    generatedAt: "2026-10-17T05:02:00.000Z",
    approval: { version: 7, approvedAt: "2026-10-16T13:02:00.000Z", approverName: "Duty manager" },
    paperCheck: { url: CHECK_URL, qr },
  };

  it("prints the copy's version in words, on the venue's clock, at the top and on every page", async () => {
    expect(sheetCopyLine(issued)).toBe("v7, issued 16 Oct 14:02, printed 17 Oct 06:02");
    const pages = pdfPages(await generateSheetPdfV2(issued));
    expect(textOf((pages[0] ?? []).filter((line) => line.y > PAGE_H - 160))).toContain("v7, issued 16 Oct 14:02, printed 17 Oct 06:02");
    expectFooterOnEveryPage(pages, "v7, issued 16 Oct 14:02, printed 17 Oct 06:02");
  });

  it("keeps the approver and the version whole when the approver's name is long", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...issued, approval: { version: 7, approvedAt: "2026-10-16T13:02:00.000Z", approverName: "Alexandria Montgomery ".repeat(9).trim() } }));
    expect(text).toContain("v7, issued 16 Oct 14:02, printed 17 Oct 06:02");
    expect(text).toContain("Approved by Alexandria Montgomery");
  });

  it("calls a copy printed before approval a draft, with no approval claim", async () => {
    const draft: HallkeeperSheetV2 = { ...BASE_SHEET, generatedAt: "2026-10-17T05:02:00.000Z" };
    expect(sheetCopyLine(draft)).toBe("Draft, printed 17 Oct 06:02");
    const text = pdfText(await generateSheetPdfV2(draft));
    expect(text).toContain("Draft, printed 17 Oct 06:02");
    expect(text).not.toContain("Approved by");
  });

  it("points the QR at the no-sign-in check, carrying this copy's printed minute", () => {
    const target = sheetQrTarget(issued);
    expect(target.url).toBe(`${CHECK_URL}&p=2026-10-17T06:02`);
    expect(target.url).not.toContain("/hallkeeper/");
    expect(target.caption).toBe("Scan to check this copy is current. No sign-in; the check shows nothing from this sheet.");
  });

  it("keeps the sign-in link, and says so, when the sheet carries no paper check", () => {
    const target = sheetQrTarget({ ...issued, paperCheck: undefined });
    expect(target.url).toBe(BASE_SHEET.webViewUrl);
    expect(target.caption).toContain("sign-in needed");
  });

  it("prints the check caption beside the code on page 1", async () => {
    const page = pdfPages(await generateSheetPdfV2(issued))[0] ?? [];
    expect(textOf(page)).toContain("Scan to check this copy is current. No sign-in; the check shows nothing from this sheet.");
    expect(textOf(page)).not.toContain("Generated by Venviewer");
  });
});

describe("render metrics", () => {
  it("increments hallkeeper_pdf_render_total with status=ok and emits a duration observation", async () => {
    __resetMetricsForTests();
    await generateSheetPdfV2(BASE_SHEET);
    const text = renderMetrics();
    expect(text).toContain("hallkeeper_pdf_render_total");
    expect(text).toContain('status="ok"');
    expect(text).toContain('approval="draft"');
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_bucket");
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_sum");
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_count");
  });

  it("labels approved sheets with approval=\"approved\"", async () => {
    __resetMetricsForTests();
    await generateSheetPdfV2({ ...BASE_SHEET, approval: { version: 1, approvedAt: "2026-04-19T09:00:00.000Z", approverName: "Jane Doe" } });
    const text = renderMetrics();
    expect(text).toContain('approval="approved"');
    expect(text).not.toContain('approval="draft"');
  });

  it("counters accumulate across multiple renders", async () => {
    __resetMetricsForTests();
    await generateSheetPdfV2(BASE_SHEET);
    await generateSheetPdfV2(BASE_SHEET);
    await generateSheetPdfV2(BASE_SHEET);
    const counterLine = renderMetrics().split("\n")
      .find((line) => line.startsWith("hallkeeper_pdf_render_total{") && line.includes('status="ok"') && line.includes('approval="draft"'));
    expect(counterLine).toMatch(/\s3\s*$/u);
  });
});
