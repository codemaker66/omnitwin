import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import type { EventInstructions, HallkeeperSheetV2 } from "@omnitwin/types";
import { generateSheetPdfV2, sheetCopyLine, sheetQrTarget } from "../services/hallkeeper-pdf-v2.js";
import { brief, martynsLaw, setupPage } from "../services/sheet-pdf/blocks.js";
import { Flow, PAGE_OPTIONS } from "../services/sheet-pdf/flow.js";
import { registerSheetFonts } from "../services/sheet-pdf/fonts.js";
import { PAGE } from "../services/sheet-pdf/style.js";
import { buildSheetPaperCheck } from "../services/sheet-paper-check.js";
import { renderMetrics, __resetMetricsForTests } from "../observability/metrics.js";
import { boardMeetingSheet, emptyDraftSheet, longTextSheet, weddingSheet } from "./fixtures/hallkeeper-sheet-fixtures.js";
import { pdfImageCount, pdfPageContents, pdfPages, pdfRules, pdfText, type PdfLine } from "./helpers/pdf-text.js";

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

const BASE_SHEET: HallkeeperSheetV2 = {
  config: { id: "00000000-0000-4000-8000-000000000001", name: "Anderson Wedding Reception", guestCount: 120, layoutStyle: "dinner-rounds" },
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
/** Footer runs sit on one baseline about 23 pt above the page's foot. */
const isFooter = (line: PdfLine): boolean => line.y > 18 && line.y < 30;
/** Body text keeps clear of the footer band: baselines at least 44 pt up. */
const BODY_FLOOR = 44;

function expectInsideMargins(pages: readonly (readonly PdfLine[])[]): void {
  for (const [index, page] of pages.entries()) {
    for (const line of page) {
      const where = `page ${String(index + 1)}: "${line.text.slice(0, 40)}"`;
      expect(Math.min(line.x, line.x2), where).toBeGreaterThanOrEqual(MARGIN - 1);
      expect(Math.max(line.x, line.x2), where).toBeLessThanOrEqual(PAGE_W - MARGIN + 1);
      if (!isFooter(line)) expect(Math.min(line.y, line.y2), where).toBeGreaterThanOrEqual(BODY_FLOOR);
      expect(Math.max(line.y, line.y2), where).toBeLessThan(PAGE_H - MARGIN + 6);
    }
  }
}

/** A sheet whose Martyn's Law record has every field at its maximum: taller than a page. */
function maxedMartynsSheet(): HallkeeperSheetV2 {
  const fill = (max: number): string => "Door team briefed at the side entrance before guests arrive. ".repeat(40).slice(0, max).trim();
  return { ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS, protectedPremises: {
    responsiblePerson: fill(200),
    dutyLead: { name: fill(120), role: fill(120) },
    procedures: { evacuation: { briefed: true, note: fill(300) }, invacuation: { briefed: false, note: fill(300) }, lockdown: { briefed: true, note: fill(300) }, communication: { briefed: true, note: fill(300) } },
    briefingAt: "2026-06-15T16:30:00.000Z",
    doorSupervision: { arranged: true, note: fill(300) },
    notes: `${fill(1450)} Last words here.`,
  } } };
}

/** The wedding with `count` seats carrying a planner's note each. */
function withSeatNotes(count: number): HallkeeperSheetV2 {
  const base = weddingSheet();
  const plan = base.floorPlan;
  if (plan === null || plan === undefined) throw new Error("wedding fixture has a plan");
  const seats = new Set(plan.objects.filter((object) => object.category === "chair").slice(0, count).map((object) => object.objectId));
  let n = 0;
  return { ...base, floorPlan: { ...plan, objects: plan.objects.map((object) => {
    if (!seats.has(object.objectId)) return object;
    n += 1;
    return { ...object, note: `Seat ${String(n)}: guest needs the aisle side and a cushion; ask catering about the soup` };
  }) } };
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
      "FROM THE STORE", "Chiavari Wedding Chair", "FROM THE PLANNER"]) {
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
    expect(text).toContain("SETUP, IN ORDER");
    expect(text.match(/Parquet Dance Floor Panel/gu)).toHaveLength(2); // store list and one setup line
    // One laid floor is one line, at the floor's middle (planner-qol E-13).
    expect(text).toContain("30 Parquet Dance Floor Panel Perimeter · Laid as one floor");
    expect(text).toContain("10 chairs each");
    expect(text).toContain("Structure by 10:00 Band loads in at 10:15");
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
    const fields = [
      ins?.specialInstructions, ins?.accessNotes, ins?.dietary?.otherAllergies, ins?.accessibility?.notes,
      ...(ins?.phaseDeadlines ?? []).map((deadline) => deadline.reason),
      ...(ins?.doorSchedule?.entries ?? []).flatMap((entry) => entry.events.map((event) => event.note)),
      ...(sheet.floorPlan?.objects ?? []).flatMap((object) => (object.note === undefined ? [] : [object.note])),
    ];
    expect(fields.length).toBeGreaterThan(10);
    for (const field of fields) {
      const tail = (field ?? "").slice(-40).replace(/\s+/gu, " ").trim();
      expect(tail.length).toBeGreaterThan(0);
      expect(text).toContain(tail);
    }
    expect(text).toContain("alexandria.montgomery-fitzwilliam@example.co.uk");
  });
});

describe("section rules", () => {
  /** A block drawn from every starting height on a page, each on a fresh page of one document. */
  async function sweep(draw: (flow: Flow) => void): Promise<Buffer> {
    const doc = new PDFDocument({ ...PAGE_OPTIONS, bufferPages: true });
    registerSheetFonts(doc);
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      doc.on("end", () => { resolve(Buffer.concat(chunks)); });
      doc.on("error", reject);
    });
    const flow = new Flow(doc);
    for (let y = PAGE.margin; y <= PAGE.contentBottom; y += 9) {
      flow.newPage();
      flow.y = y;
      draw(flow);
    }
    doc.end();
    return done;
  }

  /**
   * Every rule heads what follows it, in its own span: never above the top
   * margin, never alone at a foot, whether it crosses the page, a column or a
   * step. A setup line's own rule (0.4 pt) closes the line above it instead.
   * The plan's scale bar, 80 pt at most, is not a rule.
   */
  function expectRulesHeadText(buf: Buffer): void {
    const text = pdfPages(buf);
    let checked = 0;
    for (const [index, rules] of pdfRules(buf).entries()) {
      for (const rule of rules.filter((candidate) => candidate.x2 - candidate.x > 90)) {
        const where = `page ${String(index + 1)}, rule ${rule.x.toFixed(1)}–${rule.x2.toFixed(1)} at ${rule.y.toFixed(1)} pt up`;
        const inSpan = (line: PdfLine): boolean => line.x2 > rule.x && line.x < rule.x2;
        expect(rule.y, where).toBeLessThanOrEqual(PAGE_H - MARGIN);
        const closes = rule.weight === 0.4;
        const near = text[index]?.some((line) => inSpan(line) && (closes ? line.y > rule.y && line.y - rule.y < 40 : line.y < rule.y)) ?? false;
        expect(near, `${where}: ${closes ? "closes no line above" : "heads nothing below"}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }

  it("heads the planner's notes wherever they run: under the day, below it, or before the setup", async () => {
    const base = weddingSheet();
    const notes = "Keep the north aisle clear for the photographer between courses and check the candles before service. ".repeat(30).trim();
    const sheet = { ...base, instructions: { ...(base.instructions ?? EMPTY_INSTRUCTIONS), specialInstructions: notes } };
    expectRulesHeadText(await sweep((flow) => { setupPage(flow, sheet, "v1", brief(flow, sheet)); }));
  }, 60_000);

  it("sets page 1's two columns from any height, with no stray rule", async () => {
    const sheet = weddingSheet();
    expectRulesHeadText(await sweep((flow) => { brief(flow, sheet); }));
  }, 60_000);

  it("heads the setup's steps with the rail, wherever the setup starts", async () => {
    const sheet = weddingSheet();
    expectRulesHeadText(await sweep((flow) => { setupPage(flow, sheet, "v1"); }));
  }, 60_000);

  it("heads Martyn's Law, whether it fits a page or runs on", async () => {
    const sheet = weddingSheet();
    expectRulesHeadText(await sweep((flow) => { martynsLaw(flow, sheet); }));
    expectRulesHeadText(await sweep((flow) => { martynsLaw(flow, maxedMartynsSheet()); }));
  }, 60_000);
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

  // planner-qol E-X4: a thumbnail is a picture from some earlier save and can
  // show an older layout than the one the sheet lists, so the saved plan wins.
  it("draws the saved plan, never an older picture, when the layout has a plan", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=";
    const buf = await generateSheetPdfV2({ ...weddingSheet(), diagramUrl: png });
    expect(pdfImageCount(buf)).toBe(0);
    expect(pdfText(buf)).toContain("Drawn from the saved layout");
  });

  // Release audit hallkeeper-ops-3 / planner-qol E-13: the crew sets each
  // table's linen by its number and builds the floor to its size.
  it("prints the tables' numbers and the dance floor's size in the setup", async () => {
    const text = pdfText(await generateSheetPdfV2(weddingSheet()));
    expect(text).toContain("Tables 1–11");
    expect(text).toContain("Laid as one floor, 6 × 5 panels, 5.46 × 4.55 m");
  });

  it("draws a supplied picture only for a layout saved with no plan", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=";
    const buf = await generateSheetPdfV2({ ...weddingSheet(), floorPlan: null, diagramUrl: png });
    expect(pdfImageCount(buf)).toBe(1);
    expect(pdfText(buf)).not.toContain("No plan was saved with this layout");
  });

  it("draws the planner's own JPEG picture for a layout saved with no plan", async () => {
    // The Grand Hall as Send layout captures it (web PLAN_THUMBNAIL, an 800×533 JPEG; T-684).
    const jpeg = readFileSync(resolve(import.meta.dirname, "fixtures/grand-hall-plan-thumbnail.jpg"));
    const buf = await generateSheetPdfV2({ ...weddingSheet(), floorPlan: null, diagramUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
    expect(pdfImageCount(buf)).toBe(1);
    expect(buf.includes("/DCTDecode")).toBe(true);
    expect(pdfText(buf)).not.toContain("No plan was saved with this layout");
  });

  it("says no plan was saved when a sheet was frozen without one", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...weddingSheet(), floorPlan: null }));
    expect(text).toContain("No plan was saved with this layout. Set the room from the list.");
    expect(text).toContain("SETUP, IN ORDER");
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

  it("keeps the day and the store on page 1 for a bigger event", async () => {
    const base = weddingSheet();
    const plan = base.floorPlan;
    if (plan === null || plan === undefined) throw new Error("wedding fixture has a plan");
    const template = plan.objects.find((object) => object.category === "other");
    if (template === undefined) throw new Error("wedding fixture has a bar");
    const extras = ["Coat Rail", "Gift Table", "Easel", "Welcome Sign", "Photo Booth", "DJ Booth", "Lantern Stand", "Card Box"]
      .map((name, index) => ({ ...template, objectId: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`, name, x: 0, z: 0 }));
    const sheet = await withPaperCheck({ ...base, floorPlan: { ...plan, objects: [...plan.objects, ...extras] } }, true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    const first = pages[0] ?? [];
    expect(textOf(first)).toContain("THE DAY, IN ORDER");
    expect(textOf(first)).toContain("FROM THE STORE");
    expect(textOf(first)).toContain("Room ready");
    expect(Math.min(...first.filter((line) => !isFooter(line)).map((line) => line.y))).toBeLessThan(120);
    expect(textOf(pages.flat())).toContain("Card Box");
    expectInsideMargins(pages);
  });

  it("keeps every note on the page when forty seats carry one", async () => {
    const sheet = await withPaperCheck(withSeatNotes(40), true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expectInsideMargins(pages);
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    const text = textOf(pages.flat());
    for (let n = 1; n <= 40; n++) expect(text).toContain(`Seat ${String(n)}: guest needs the aisle side`);
  });

  it("flows a setup line with forty-five notes onto the next page", async () => {
    const notes = Array.from({ length: 45 }, (_, n) => `Table ${String(n + 1)}: keep the place cards in seating order; the florist checks the centrepieces at noon and the duty manager lights the candles at 18:30`).join(" · ");
    const sheet: HallkeeperSheetV2 = { ...BASE_SHEET, phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [{
      key: "k", name: "6ft Round Table with 10 chairs", category: "table", qty: 45, afterDepth: 0, isAccessory: false, notes, positions: [],
    }] }] }] };
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expectInsideMargins(pages);
    const text = textOf(pages.flat());
    for (let n = 1; n <= 45; n++) expect(text).toContain(`Table ${String(n)}: keep the place cards`);
  });

  it("keeps Martyn's Law on the page when every field is at its maximum", async () => {
    const pages = pdfPages(await generateSheetPdfV2(maxedMartynsSheet()));
    expectInsideMargins(pages);
    expect(textOf(pages.flat())).toContain("Last words here.");
  });

  it("breaks a 4,000-character note with no spaces quickly and keeps all of it", async () => {
    const word = "https://example.com/menu/" + "x7".repeat(1985);
    const started = performance.now();
    const buf = await generateSheetPdfV2({ ...weddingSheet(), instructions: { ...(weddingSheet().instructions ?? EMPTY_INSTRUCTIONS), specialInstructions: word } });
    expect(performance.now() - started).toBeLessThan(8000);
    const pages = pdfPages(buf);
    expectInsideMargins(pages);
    expect(textOf(pages.flat().filter((line) => !isFooter(line))).replace(/\s+/gu, "")).toContain(word);
  });

  it("dates a setup deadline that falls the evening before", async () => {
    const base = weddingSheet();
    const before = new Date(Date.UTC(2026, 9, 23, 19, 0)).toISOString();
    const instructions = base.instructions ?? EMPTY_INSTRUCTIONS;
    const text = pdfText(await generateSheetPdfV2({ ...base, instructions: { ...instructions, phaseDeadlines: instructions.phaseDeadlines.map((deadline) => deadline.phase === "structure" ? { ...deadline, deadline: before } : deadline) } }));
    expect(text).toContain("by Fri 23 Oct 20:00");
    expect(text).toMatch(/20:00 Structure done · Fri 23 Oct/u);
  });

  it("sets a Greek title in Inter", async () => {
    const page = pdfPages(await generateSheetPdfV2({ ...BASE_SHEET, config: { ...BASE_SHEET.config, name: "Γάμος Παπαδόπουλου" } }))[0] ?? [];
    expect(page.find((line) => line.text.includes("Παπαδόπουλου"))?.font).toMatch(/InterSheet/u);
  });

  it("sets a Chinese or Japanese title without breaking the page", async () => {
    const sheet = await withPaperCheck({ ...weddingSheet(), config: { ...weddingSheet().config, name: "山田家・佐藤家 結婚披露宴 王家與李家婚宴" } }, true);
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expectInsideMargins(pages);
    expectFooterOnEveryPage(pages, sheetCopyLine(sheet));
    expect(textOf(pages[0] ?? [])).toContain("READY BY");
  });

  it("keeps a long venue name to its line, clear of the code", async () => {
    const base = weddingSheet();
    const name = "The Incorporation of the Trades House of Glasgow, its Merchants and Craftsmen, at the Hall on Glassford Street";
    const page = pdfPages(await generateSheetPdfV2(await withPaperCheck({ ...base, venue: { ...base.venue, name } }, true)))[0] ?? [];
    const overline = page.filter((line) => line.text.startsWith("HALLKEEPER SHEET"));
    expect(overline).toHaveLength(1);
    expect(overline[0]?.text.endsWith("…")).toBe(true);
    expect(overline[0]?.x2 ?? Infinity).toBeLessThanOrEqual(PAGE_W - MARGIN - 62 - 18 + 0.5);
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
    expect(text).toMatch(/GUESTS IN 18:30/u);
    // Measured from when guests come in, the fact beside it, not a "start" the sheet no longer names.
    expect(text).toContain("90 min before guests come in");
  });

  it("prints a different venue's wall clock for the same instant and names its zone", async () => {
    const text = await factsOf("America/New_York");
    expect(text).toMatch(/READY BY 12:00/u);
    expect(text).toMatch(/GUESTS IN 13:30/u);
    expect(text).toContain("Eastern time");
  });

  it("names the reason when the ready-by time cannot be derived", async () => {
    const text = pdfText(await generateSheetPdfV2({ ...BASE_SHEET, timing: { eventStart: "2026-06-15T17:30:00.000Z", setupBy: null, bufferMinutes: null } }));
    expect(text).toContain("No changeover time for this room");
    expect(text).toMatch(/GUESTS IN 18:30/u);
    expect(text).not.toContain("min before guests come in");
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

// ---------------------------------------------------------------------------
// A, then D (T-696; docs/superpowers/specs/2026-11-06-hallkeeper-sheet-a-d-f-design.md):
// page 1 is the brief with the room beside what to keep in view; page 2 opens
// with the setup's progress rail, the steps beside a rail of what to keep in view.
// ---------------------------------------------------------------------------

describe("A, then D (T-696): the brief with the room, then the setup to tick", () => {
  /** pdfkit's stroke colour for brick (#8a3522), as it writes it. */
  const BRICK_STROKE = "0.5411764705882353 0.20784313725490197 0.13333333333333333 SCN";
  const render = async (): Promise<Buffer> => generateSheetPdfV2(await withPaperCheck(weddingSheet(), true));

  it("says when guests come in, rather than when the event starts", async () => {
    const first = textOf(pdfPages(await render())[0] ?? []);
    expect(first).toContain("GUESTS IN");
    expect(first).not.toContain("STARTS");
  });

  it("draws the room on page 1, with Keep in view beside it", async () => {
    const first = pdfPages(await render())[0] ?? [];
    const north = first.find((line) => line.text === "NORTH WALL");
    const keep = first.find((line) => line.text === "KEEP IN VIEW");
    if (north === undefined || keep === undefined) throw new Error("page 1 should carry the plan and Keep in view");
    expect(keep.x).toBeGreaterThan(PAGE_W * 0.55);
    expect(Math.abs(keep.y - north.y)).toBeLessThan(40);
  });

  it("gives each care fact its own line, the place apart from its words", async () => {
    const lines = (pdfPages(await render())[0] ?? []).map((line) => line.text);
    expect(lines).toContain("Table 5, seat 4");
    expect(lines.some((text) => text.startsWith("severe peanut allergy"))).toBe(true);
    expect(lines).toContain("Table 9");
    expect(lines).toContain("two guests coeliac.");
  });

  it("puts who to call beside who is on duty, under the room", async () => {
    const first = pdfPages(await render())[0] ?? [];
    const at = (text: string): PdfLine => {
      const line = first.find((candidate) => candidate.text === text);
      if (line === undefined) throw new Error(`page 1 should carry "${text}"`);
      return line;
    };
    const call = at("CALL ON THE DAY");
    const duty = at("ON DUTY");
    expect(call.y).toBeLessThan(at("SOUTH WALL").y);
    expect(duty.y).toBeCloseTo(call.y, 1);
    expect(duty.x).toBeGreaterThan(call.x + 100);
    for (const words of ["Kirsty Mackenzie", "Bride's sister", "07700 900412", "Callum Reid", "Duty manager"]) at(words);
  });

  it("rings on the plan each table the care words name", async () => {
    const [first] = pdfPageContents(await render());
    expect((first ?? "").split(BRICK_STROKE).length - 1).toBe(3);
  });

  it("opens page 2 with the setup's progress rail, before the first step's lines", async () => {
    const second = textOf(pdfPages(await render())[1] ?? []);
    let at = 0;
    for (const words of ["Structure", "10:00", "Furniture", "11:00", "Dress", "12:00", "Technical", "12:30", "Final touches", "13:30", "Room ready", "13:30", "Guests in", "14:30"]) {
      const found = second.indexOf(words, at);
      expect(found, words).toBeGreaterThanOrEqual(at);
      at = found + words.length;
    }
    expect(second.indexOf("Guests in")).toBeLessThan(second.indexOf("Staging Deck"));
  });

  it("heads the setup's own page with the event, its guests and whether this copy is approved", async () => {
    const second = textOf(pdfPages(await render())[1] ?? []);
    let at = 0;
    for (const words of ["Mackenzie–Ross wedding breakfast", "Saturday 24 October · Grand Hall · 120 guests · Dinner rounds",
      "Approved by Fiona Grant · v3, issued 22 Oct 16:12, printed 24 Oct 07:42", "SETUP, IN ORDER"]) {
      const found = second.indexOf(words, at);
      expect(found, words).toBeGreaterThanOrEqual(at);
      at = found + words.length;
    }
  });

  it("warns on the setup's own page too when the copy is a draft", async () => {
    const pages = pdfPages(await generateSheetPdfV2(await withPaperCheck(boardMeetingSheet(), false)));
    expect(pages).toHaveLength(2);
    expect(textOf(pages[1] ?? [])).toContain("Draft, printed 24 Oct 07:05 · not yet approved. Check with the duty manager before setting up.");
  });

  it("keeps what to keep in view and who to call beside the steps on page 2", async () => {
    const second = pdfPages(await render())[1] ?? [];
    const keep = second.find((line) => line.text === "KEEP IN VIEW");
    if (keep === undefined) throw new Error("page 2 should carry Keep in view");
    expect(keep.x).toBeGreaterThan(PAGE_W * 0.6);
    expect(textOf(second)).toContain("07700 900412");
  });

  it("states each step's deadline, with its reason on a line of its own", async () => {
    const lines = pdfPages(await render()).flat().map((line) => line.text);
    expect(lines).toContain("by 10:00");
    expect(lines).toContain("Band loads in at 10:15");
  });

  it("keeps the planner's words under the day when page 1 has room for them", async () => {
    const sheet: HallkeeperSheetV2 = { ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS,
      specialInstructions: "Keep the north aisle clear for the photographer.", accessNotes: "Florist unloads at the service door." } };
    const pages = pdfPages(await generateSheetPdfV2(sheet));
    expect(pages).toHaveLength(1);
    const first = textOf(pages[0] ?? []);
    expect(first.indexOf("Keep the north aisle clear for the photographer.")).toBeGreaterThan(first.indexOf("THE DAY, IN ORDER"));
    expect(first).toContain("Florist unloads at the service door.");
    expect(first).not.toContain("above the setup's steps");
    // In the left column, under the day, not across the page.
    const words = (pages[0] ?? []).find((line) => line.text === "Keep the north aisle clear for the photographer.");
    if (words === undefined) throw new Error("page 1 should carry the planner's words on a line of their own");
    expect(words.x).toBeCloseTo(MARGIN, 0);
    expect(words.x2).toBeLessThanOrEqual(MARGIN + Math.round((PAGE_W - 2 * MARGIN) * 0.6));
  });

  it("opens the setup with the planner's words when page 1 is full, and page 1 says where they are", async () => {
    const [first, second] = pdfPages(await render()).map((page) => textOf(page));
    expect(first).toContain("FROM THE PLANNER On page 2, above the setup's steps.");
    expect(first).not.toContain("Petals only on the stairs");
    let at = 0;
    for (const words of ["Guests in", "FROM THE PLANNER", "Petals only on the stairs", "ACCESS AND LOAD-IN", "Band's van leaves before 12:00", "Staging Deck"]) {
      const found = (second ?? "").indexOf(words, at);
      expect(found, words).toBeGreaterThanOrEqual(at);
      at = found + words.length;
    }
  });

  it("sets a setup that fits under the brief on page 1 full width, with Keep in view shown once", async () => {
    const pages = pdfPages(await generateSheetPdfV2(BASE_SHEET));
    expect(pages).toHaveLength(1);
    const first = pages[0] ?? [];
    expect(first.filter((line) => line.text === "KEEP IN VIEW")).toHaveLength(1);
    const rail = first.find((line) => line.text === "SETUP, IN ORDER");
    const place = first.find((line) => line.text === "Centre");
    if (rail === undefined || place === undefined) throw new Error("page 1 should carry the setup");
    expect(place.y).toBeLessThan(rail.y);
    // Full width: the line's place stands at the page's right, where the rail would otherwise run.
    expect(place.x).toBeGreaterThan(PAGE_W * 0.6);
  });

  it("lists the plan's numbered notes that no setup line carries, after the steps", async () => {
    const text = pdfText(await generateSheetPdfV2(withSeatNotes(2)));
    const listed = text.indexOf("NOTES ON THE PLAN");
    // The last "Final touches" is the final step's head; the first is the rail's station.
    expect(listed).toBeGreaterThan(text.lastIndexOf("Final touches"));
    expect(text.indexOf("Seat 1: guest needs the aisle side", listed)).toBeGreaterThan(listed);
    expect(text.indexOf("Seat 2: guest needs the aisle side", listed)).toBeGreaterThan(listed);
  });

  it("starts the setup on the page a long brief ran onto, rather than a page later", async () => {
    const base = weddingSheet();
    const instructions = base.instructions ?? EMPTY_INSTRUCTIONS;
    const dietary = instructions.dietary;
    if (dietary === null) throw new Error("the wedding records its dietary needs");
    const more = Array.from({ length: 4 }, (_, n) => `Table ${String(n + 1)}: one guest avoids sesame.`).join(" ");
    const sheet = { ...base, instructions: { ...instructions, dietary: { ...dietary, otherAllergies: `${dietary.otherAllergies} ${more}` } } };
    const pages = pdfPages(await generateSheetPdfV2(await withPaperCheck(sheet, true))).map((page) => textOf(page));
    expect(pages[0]).not.toContain("SETUP, IN ORDER");
    expect(pages[1]).toContain("SETUP, IN ORDER");
    expect(pages.length).toBeLessThanOrEqual(3);
  });

  it("sets a line's notes under its name, so a long place beside them adds no gap", async () => {
    const second = pdfPages(await render())[1] ?? [];
    const lastNote = second.find((line) => line.text.endsWith("catering has the card"));
    const next = second.find((line) => line.text === "Cake Cutting Table");
    if (lastNote === undefined || next === undefined) throw new Error("page 2 should carry the round tables' notes and the cake table");
    expect(lastNote.y - next.y).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// What #415's review found (12 November 2026): care facts that carry a clock
// time, the planner's words when page 1 is full or nothing is placed, the
// rail's times, the plan's names and rings, and the branches the first tests
// left out.
// ---------------------------------------------------------------------------

/** An instant on the wedding's own clock: BST on Saturday 24 October 2026, or `dayOffset` days away. */
function bst(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(Date.UTC(2026, 9, 24 + dayOffset, hour - 1, minute)).toISOString();
}

/** The wedding with its instructions changed. */
function weddingWith(change: (instructions: EventInstructions) => EventInstructions): HallkeeperSheetV2 {
  const base = weddingSheet();
  return { ...base, instructions: change(base.instructions ?? EMPTY_INSTRUCTIONS) };
}

/** The wedding with `count` more door times in its day. */
function weddingWithDoorTimes(count: number): HallkeeperSheetV2 {
  return weddingWith((instructions) => ({ ...instructions, doorSchedule: { entries: [
    ...(instructions.doorSchedule?.entries ?? []),
    { label: "Saloon door", events: Array.from({ length: count }, (_, n) => ({
      at: bst(15 + Math.floor(n / 2), (n % 2) * 30), kind: n % 2 === 0 ? "open" as const : "lock" as const, note: "" })) },
  ] } }));
}

/** The wedding with `count` more allergy sentences, each a line of its own in Keep in view. */
function weddingWithAllergies(count: number): HallkeeperSheetV2 {
  return weddingWith((instructions) => {
    const dietary = instructions.dietary;
    if (dietary === null) throw new Error("the wedding records its dietary needs");
    const more = Array.from({ length: count }, (_, n) => `Table ${String((n % 11) + 1)}: one guest avoids sesame.`).join(" ");
    return { ...instructions, dietary: { ...dietary, otherAllergies: `${dietary.otherAllergies} ${more}` } };
  });
}

describe("what #415's review found (T-696)", () => {
  /** A care ring as pdfkit writes it: a move to its left edge, four curves, then a brick stroke. */
  const BRICK_RING = /(-?[\d.]+) (-?[\d.]+) m\n(?:-?[\d.]+ ){5}-?[\d.]+ c\n(?:-?[\d.]+ ){4}(-?[\d.]+) -?[\d.]+ c\n(?:[-\d. ]+ c\n){2}h\n[\d.]+ w\n\/DeviceRGB CS\n0\.5411764705882353 0\.20784313725490197 0\.13333333333333333 SCN\nS/gu;
  const pagesOf = async (sheet: HallkeeperSheetV2): Promise<PdfLine[][]> => pdfPages(await generateSheetPdfV2(await withPaperCheck(sheet, true)));
  const PLANNER = "Petals only on the stairs";
  const LEFT_W = Math.round((PAGE_W - 2 * MARGIN) * 0.6);

  it("keeps a clock time and a link whole in a care fact, setting a place apart only at its colon", async () => {
    const sheet = weddingWith((instructions) => ({
      ...instructions,
      dietary: instructions.dietary === null ? null : { ...instructions.dietary,
        otherAllergies: "Table 5, seat 4: severe peanut allergy. Nut-free desserts go out at 21:15 with the cake." },
      accessibility: instructions.accessibility === null ? null : { ...instructions.accessibility,
        notes: "Wheelchair user arrives 14:15, needs the lift. Route map at https://t.co/x1." },
    }));
    const pages = await pagesOf(sheet);
    for (const [index, page] of pages.slice(0, 2).entries()) {
      const text = textOf(page);
      for (const words of ["Nut-free desserts go out at 21:15 with the cake.", "Wheelchair user arrives 14:15, needs the lift.", "Route map at https://t.co/x1."]) {
        expect(text, `page ${String(index + 1)}: ${words}`).toContain(words);
      }
    }
    expect((pages[0] ?? []).map((line) => line.text)).toContain("Table 5, seat 4");
  });

  it("dates a rail time due on another day, and marks one due after the room is ready", async () => {
    const sheet = weddingWith((instructions) => ({ ...instructions, phaseDeadlines: instructions.phaseDeadlines.map((deadline) =>
      deadline.phase === "structure" ? { ...deadline, deadline: bst(16, 0, -1) }
        : deadline.phase === "final" ? { ...deadline, deadline: bst(13, 45) } : deadline) }));
    const second = textOf((await pagesOf(sheet))[1] ?? []);
    const rail = second.slice(second.indexOf("SETUP, IN ORDER"), second.indexOf("Guests in"));
    expect(rail).toContain("Structure Fri 16:00");
    expect(rail).toContain("Furniture 11:00");
    expect(rail).toContain("Final touches 13:45 late");
    expect(rail).not.toContain("11:00 late");
  });

  it("prints the planner's words under the columns when nothing is placed, and points nowhere", async () => {
    const words = "Keep the north aisle clear for the photographer between courses and check the candles before service. ".repeat(12).trim();
    for (const keepPlan of [true, false]) {
      const base = weddingWith((instructions) => ({ ...instructions, specialInstructions: words }));
      const sheet: HallkeeperSheetV2 = { ...base, phases: [], totals: { entries: [], totalRows: 0, totalItems: 0 }, ...(keepPlan ? {} : { floorPlan: null }) };
      const text = textOf((await pagesOf(sheet)).flat());
      const where = keepPlan ? "with a plan" : "with no plan";
      expect(text.split("FROM THE PLANNER").length - 1, where).toBe(1);
      expect(text, where).not.toContain("above the setup's steps");
      expect(text, where).not.toContain("With the setup, above its steps.");
      expect(text.lastIndexOf("before service."), where).toBeLessThan(text.indexOf("Nothing is placed in this layout yet."));
    }
  });

  it("answers every number on the plan even when nothing is set out in steps", async () => {
    const text = textOf((await pagesOf({ ...weddingSheet(), phases: [] })).flat());
    const listed = text.indexOf("NOTES ON THE PLAN");
    expect(listed).toBeGreaterThan(text.indexOf("Nothing is placed in this layout yet."));
    for (const note of ["Table 5: severe peanut allergy at seat 4, catering has the card", "Highchair for table 6", "Cash bar from 21:00"]) {
      expect(text.indexOf(note, listed), note).toBeGreaterThan(listed);
    }
  });

  it("never leaves the planner's words after the setup's rail unless page 1 says where they are", async () => {
    for (const [name, sheet] of [["two more door times", weddingWithDoorTimes(2)], ["four more", weddingWithDoorTimes(4)],
      ["twelve more", weddingWithDoorTimes(12)], ["six more allergy notes", weddingWithAllergies(6)]] as const) {
      const pages = (await pagesOf(sheet)).map((page) => textOf(page));
      const all = pages.join(" ");
      const named = /FROM THE PLANNER On page (\d+), above the setup's steps\./u.exec(pages[0] ?? "")?.[1];
      const withSetup = (pages[0] ?? "").includes("FROM THE PLANNER With the setup, above its steps.");
      const beforeRail = all.indexOf(PLANNER) < all.indexOf("SETUP, IN ORDER");
      expect(named !== undefined || withSetup || beforeRail, name).toBe(true);
      expect(named === undefined || (pages[Number(named) - 1] ?? "").includes(PLANNER), name).toBe(true);
      expect(all.split(PLANNER).length - 1, name).toBe(1);
    }
  });

  it("leads the setup page with the planner's words, under its head, when page 1 has no room even to point to them", async () => {
    // Structure the day before and final touches after the ready-by time: the late line stacks, one line taller.
    const dayBefore = weddingWith((instructions) => ({ ...instructions, phaseDeadlines: instructions.phaseDeadlines.map((deadline) =>
      deadline.phase === "structure" ? { ...deadline, deadline: bst(16, 0, -1) } : deadline.phase === "final" ? { ...deadline, deadline: bst(13, 45) } : deadline) }));
    for (const [name, sheet] of [["two more door times", weddingWithDoorTimes(2)], ["structure the day before, final touches late", dayBefore]] as const) {
      const pages = (await pagesOf(sheet)).map((page) => textOf(page));
      expect(pages[0], name).not.toContain("FROM THE PLANNER");
      const second = pages[1] ?? "";
      let at = 0;
      for (const words of ["Mackenzie–Ross wedding breakfast", "Approved by Fiona Grant", "FROM THE PLANNER", PLANNER, "SETUP, IN ORDER", "Guests in", "Staging Deck"]) {
        const found = second.indexOf(words, at);
        expect(found, `${name}: ${words}`).toBeGreaterThanOrEqual(at);
        at = found + words.length;
      }
    }
  });

  it("names the top table on page 1's plan, beside its piece when the name is wider than the piece", async () => {
    const first = (await pagesOf(weddingSheet()))[0] ?? [];
    const at = (text: string): PdfLine => {
      const line = first.find((candidate) => candidate.text === text);
      if (line === undefined) throw new Error(`page 1 should carry "${text}"`);
      return line;
    };
    const name = at("Top table");
    expect(name.y).toBeLessThan(at("NORTH WALL").y);
    expect(name.y).toBeGreaterThan(at("SOUTH WALL").y);
    expect(name.x).toBeGreaterThanOrEqual(MARGIN);
    expect(name.x2).toBeLessThanOrEqual(MARGIN + LEFT_W);
  });

  it("sets a name too wide for its piece beside it, on clear floor inside the plan", async () => {
    const base = weddingSheet();
    const plan = base.floorPlan;
    if (plan === null || plan === undefined) throw new Error("wedding fixture has a plan");
    const objects = plan.objects.map((object) => (Math.abs(object.x - 3) < 0.01 && Math.abs(object.z - 4.2) < 0.01 ? { ...object, label: "Cake" } : object));
    const first = (await pagesOf({ ...base, floorPlan: { ...plan, objects } }))[0] ?? [];
    const at = (text: string): PdfLine => {
      const line = first.find((candidate) => candidate.text === text);
      if (line === undefined) throw new Error(`page 1 should carry "${text}"`);
      return line;
    };
    const name = at("Cake");
    expect(name.y).toBeLessThan(at("NORTH WALL").y);
    expect(name.y).toBeGreaterThan(at("SOUTH WALL").y);
    expect(name.x).toBeGreaterThanOrEqual(MARGIN);
    expect(name.x2).toBeLessThanOrEqual(MARGIN + LEFT_W);
    expect(textOf(first)).not.toContain("Too small to name here");
  });

  it("names under the plan's caption a piece it has no room to name on the drawing", async () => {
    const base = weddingSheet();
    const plan = base.floorPlan;
    if (plan === null || plan === undefined) throw new Error("wedding fixture has a plan");
    const objects = plan.objects.map((object) => (Math.abs(object.x - 3) < 0.01 && Math.abs(object.z - 4.2) < 0.01
      ? { ...object, label: "Gift table for the cards and presents" } : object));
    expect(objects.filter((object) => object.label === "Gift table for the cards and presents")).toHaveLength(1);
    const first = textOf((await pagesOf({ ...base, floorPlan: { ...plan, objects } }))[0] ?? []);
    expect(first).toContain("Too small to name here: Gift table for the cards and presents.");
  });

  it("rings tables 3, 5 and 9 on page 1's plan, each ring round its own table", async () => {
    const buf = await generateSheetPdfV2(await withPaperCheck(weddingSheet(), true));
    const [content] = pdfPageContents(buf);
    const first = pdfPages(buf)[0] ?? [];
    const ringed = [...(content ?? "").matchAll(BRICK_RING)].map((match) => {
      const cx = (Number(match[1]) + Number(match[3])) / 2;
      const cy = Number(match[2]);
      return first.find((line) => Math.abs((line.x + line.x2) / 2 - cx) < 1 && Math.abs(PAGE_H - line.y - cy) < 9)?.text;
    });
    expect(ringed).toHaveLength(3);
    expect(new Set(ringed)).toEqual(new Set(["3", "5", "9"]));
  });

  it("keeps the contact's email with page 1 and off the setup's rail", async () => {
    const sheet = weddingWith((instructions) => ({ ...instructions,
      dayOfContact: instructions.dayOfContact === null ? null : { ...instructions.dayOfContact, email: "kirsty@example.com" } }));
    const [first, second] = (await pagesOf(sheet)).map((page) => textOf(page));
    expect(first).toContain("kirsty@example.com");
    expect(second).toContain("07700 900412");
    expect(second).not.toContain("kirsty@example.com");
  });

  it("runs the planner's words full width under both columns when they fit there but not beside the day", async () => {
    const words = "Keep the north aisle clear for the photographer between courses and check the candles before service. ".repeat(22).trim();
    const pages = await pagesOf({ ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS, specialInstructions: words } });
    const lines = (pages[0] ?? []).filter((line) => line.text.includes("photographer"));
    expect(lines.length).toBeGreaterThan(10);
    expect(Math.min(...lines.map((line) => line.x))).toBeCloseTo(MARGIN, 0);
    expect(Math.max(...lines.map((line) => line.x2))).toBeGreaterThan(PAGE_W * 0.75);
    const store = (pages[0] ?? []).find((line) => line.text === "FROM THE STORE");
    if (store === undefined) throw new Error("page 1 should carry the store");
    expect(Math.max(...lines.map((line) => line.y))).toBeLessThan(store.y);
  });

  it("points from page 1's right column to words that open the setup, when the left column runs on", async () => {
    const events = Array.from({ length: 40 }, (_, n) => ({
      at: new Date(Date.UTC(2026, 5, 15, 6 + Math.floor(n / 4), (n % 4) * 15)).toISOString(), kind: "open" as const, note: "" }));
    const words = "Keep the north aisle clear for the photographer between courses and check the candles before service. ".repeat(10).trim();
    const pages = await pagesOf({ ...BASE_SHEET, instructions: { ...EMPTY_INSTRUCTIONS, specialInstructions: words,
      doorSchedule: { entries: [{ label: "Service door", events }] } } });
    const pointer = (pages[0] ?? []).find((line) => line.text === "With the setup, above its steps.");
    if (pointer === undefined) throw new Error("page 1 should say where the planner's words are");
    expect(pointer.x).toBeGreaterThan(PAGE_W * 0.6);
    const all = pages.map((page) => textOf(page)).join(" ");
    expect(all.indexOf("Keep the north aisle clear")).toBeGreaterThan(all.indexOf("SETUP, IN ORDER"));
  });

  it("opens the setup on a fresh page, with its head, after a brief that filled most of page 2", async () => {
    const pages = (await pagesOf(weddingWithAllergies(24))).map((page) => textOf(page));
    expect(pages[1]).not.toContain("SETUP, IN ORDER");
    const third = pages[2] ?? "";
    expect(third.indexOf("Mackenzie–Ross wedding breakfast")).toBeGreaterThanOrEqual(0);
    expect(third.indexOf("Mackenzie–Ross wedding breakfast")).toBeLessThan(third.indexOf("SETUP, IN ORDER"));
  });
});
