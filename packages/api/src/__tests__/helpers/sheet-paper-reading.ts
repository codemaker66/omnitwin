import {
  describeSheetCopy,
  parseSheetPaperLink,
  sheetSetupSteps,
  sheetStoreList,
  venueWallClock,
  withPrintedAt,
  type HallkeeperSheetV2,
  type SheetPaperCheckQuery,
} from "@omnitwin/types";
import { pdfPages, pdfStreams, plainSpaces, type PdfLine } from "./pdf-text.js";

// ---------------------------------------------------------------------------
// Reading a printed hallkeeper sheet the way the person holding it does:
// its words (through helpers/pdf-text.ts) and its QR code, read back from the
// PDF's own drawing operators. Used by the release-identity tests, which
// compare what the paper says with what the phone is served.
// ---------------------------------------------------------------------------

/** Footer runs sit on one baseline about 23 pt above the page's foot. */
const isFooter = (y: number): boolean => y > 18 && y < 30;

/** Every page's text with the footer band left out, as one string, no-break spaces read as spaces. */
export function bodyText(pdf: Buffer): string {
  return pdfPages(pdf).flat().filter((line) => !isFooter(line.y))
    .map((line) => plainSpaces(line.text)).join(" ").replace(/\s+/gu, " ");
}

/** Each page's footer runs, joined. */
export function footers(pdf: Buffer): string[] {
  return pdfPages(pdf).map((page) => page.filter((line) => isFooter(line.y)).map((line) => plainSpaces(line.text)).join(" "));
}

const SETUP_HEADING = "SETUP, IN ORDER";

/**
 * The form the setup printed in, read from the page layout: under the brief
 * when "Setup, in order" shares page 1 with it (each table's chairs on its own
 * line), else on a page of its own (the chairs at a step's tables on a line of
 * their own).
 */
export function setupForm(pdf: Buffer): "under-brief" | "own-page" {
  return (pdfPages(pdf)[0] ?? []).some((line) => plainSpaces(line.text) === SETUP_HEADING) ? "under-brief" : "own-page";
}

/** A setup line as it printed: its count, its item, the chairs on its line, and its place, line by line as wrapped. */
export interface PrintedSetupLine {
  readonly qty: number;
  readonly name: string;
  readonly chairs: string | null;
  readonly place: string;
  readonly placeLines: readonly string[];
}

/** A run in one of Inter's faces at one size, as the sheet sets its setup lines (pdfkit names an embedded face "ABCDEF+InterSheet-SemiBold"). */
const runIs = (line: PdfLine, face: "Regular" | "Medium" | "SemiBold", size: number): boolean =>
  new RegExp(`\\+Inter\\w*-${face}$`, "u").test(line.font) && Math.abs(line.size - size) < 0.01;

/**
 * Every setup line the paper prints, in order, read from the PDF's own runs
 * after "Setup, in order": the count (Inter SemiBold 10.5), the item (Inter
 * Medium or Regular 9.6), the chairs beside it (Inter Regular 8.4) and the
 * place (Inter Regular 7.6), with no-break spaces read as spaces.
 */
export function printedSetupLines(pdf: Buffer): PrintedSetupLine[] {
  const lines: PrintedSetupLine[] = [];
  let started = false;
  let current: { qty: number; name: string[]; chairs: string | null; place: string[] } | null = null;
  const close = (): void => {
    if (current !== null && current.place.length > 0) {
      lines.push({ qty: current.qty, name: current.name.join(" "), chairs: current.chairs, place: current.place.join(" "), placeLines: current.place });
    }
    current = null;
  };
  for (const run of pdfPages(pdf).flat()) {
    const text = plainSpaces(run.text).trim();
    if (!started) { started = text === SETUP_HEADING; continue; }
    if (runIs(run, "SemiBold", 10.5) && /^\d+$/u.test(text)) { close(); current = { qty: Number(text), name: [], chairs: null, place: [] }; continue; }
    if (current === null) continue;
    // A line prints its count, its item, the chairs beside it, then its place; anything after the place ends it.
    if (runIs(run, "Regular", 7.6)) current.place.push(text);
    else if (current.place.length > 0) close();
    else if (runIs(run, "Medium", 9.6) || runIs(run, "Regular", 9.6)) current.name.push(text);
    else if (runIs(run, "Regular", 8.4)) current.chairs = text;
  }
  close();
  return lines;
}

const RECT = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/u;

/**
 * The QR code a pdfkit PDF draws, as rows of dark (1) and light (0) modules:
 * a white square, a fill, then one small square per dark module up to the
 * next fill. Rows and columns count from the top-left finder pattern's
 * corner module, which is always dark, and the cell is the smallest step
 * between module columns, so nothing here depends on the renderer's quiet
 * zone or cell size. Null when the PDF draws no code; a stream that will not
 * read throws (pdfStreams), so a damaged file is never mistaken for "no code".
 */
export function printedQr(pdf: Buffer): string[] | null {
  for (const content of pdfStreams(pdf)) {
    const lines = content.split("\n").map((line) => line.trim());
    for (let i = 0; i < lines.length; i++) {
      const ground = RECT.exec(lines[i] ?? "");
      if (ground === null || ground[3] !== ground[4] || Number(ground[3]) < 30) continue;
      let j = i + 1;
      while (j < lines.length && lines[j] !== "f") j++;
      const modules: { readonly x: number; readonly y: number }[] = [];
      for (j += 1; j < lines.length; j++) {
        const square = RECT.exec(lines[j] ?? "");
        if (square === null) break;
        modules.push({ x: Number(square[1]), y: Number(square[2]) });
      }
      if (modules.length < 50) continue;
      const xs = [...new Set(modules.map((m) => m.x))].sort((a, b) => a - b);
      const cell = Math.min(...xs.slice(1).map((x, k) => x - (xs[k] ?? x)));
      const left = xs[0] ?? 0;
      const top = Math.min(...modules.map((m) => m.y));
      const size = Math.round(((xs[xs.length - 1] ?? 0) - left) / cell) + 1;
      const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => "0"));
      for (const m of modules) {
        const row = grid[Math.round((m.y - top) / cell)];
        if (row !== undefined) row[Math.round((m.x - left) / cell)] = "1";
      }
      return grid.map((row) => row.join(""));
    }
  }
  return null;
}

/** The modules a QR encoder draws for `text`, at each error-correction level. */
async function encodings(text: string): Promise<string[][]> {
  const QRCode = await import("qrcode");
  return (["L", "M", "Q", "H"] as const).map((level) => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: level });
    return Array.from({ length: modules.size }, (_, row) =>
      Array.from({ length: modules.size }, (_, col) => (modules.get(row, col) === 1 ? "1" : "0")).join(""));
  });
}

/** Whether `rows` is a QR code that reads as exactly `text`. */
export async function encodes(rows: readonly string[] | null, text: string): Promise<boolean> {
  if (rows === null) return false;
  return (await encodings(text)).some((candidate) => candidate.length === rows.length && candidate.every((row, i) => row === rows[i]));
}

/** The link a copy printed at `printedAt` carries: the served check link plus that minute. */
export function printedLink(sheet: HallkeeperSheetV2, printedAt: string = sheet.generatedAt): string {
  if (sheet.paperCheck === undefined) throw new Error("The served sheet carries no paper check");
  const printed = venueWallClock(printedAt, sheet.venue.timezone);
  if (printed === null) throw new Error("No printed minute for that instant");
  return withPrintedAt(sheet.paperCheck.url, printed);
}

/** What the check endpoint is asked for a scanned link. */
export function queryOf(link: string): SheetPaperCheckQuery {
  const parsed = parseSheetPaperLink(new URL(link).searchParams);
  if (parsed === null) throw new Error(`Not a sheet check: ${link}`);
  return parsed.query;
}

/** The release words both readers are given: "v3, issued 22 Oct 16:12, printed 24 Oct 07:42". */
export function releaseLine(sheet: HallkeeperSheetV2, printedAt: string = sheet.generatedAt): string {
  return describeSheetCopy({
    version: sheet.approval?.version ?? null,
    issuedAt: sheet.approval?.approvedAt ?? null,
    printedAt,
    timeZone: sheet.venue.timezone,
  });
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Every quantity printed straight before `name`, e.g. "11 6ft Round Table" → [11], sorted. */
export function quantitiesBefore(text: string, name: string): number[] {
  return [...text.matchAll(new RegExp(`(?:^| )(\\d+) ${escape(name)}(?= |$)`, "gu"))]
    .map((match) => Number(match[1])).sort((a, b) => a - b);
}

/** A phone row's item as the setup merges it: "6ft Round Table with 10 chairs" seats 10 at a "6ft Round Table". */
const SEATED = /^(.*) with (\d+) chairs?$/u;

/** The chairs a phone row seats: only a table's row seats them, as the store and the setup read it. */
const seatsOf = (row: { readonly name: string; readonly category: string; readonly qty: number }): number =>
  row.category === "table" ? row.qty * Number(SEATED.exec(row.name)?.[2] ?? 0) : 0;

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

/** How many tables a printed place names: "11 × 6ft Round Table" 11, "Tables 1–4, 6–9, 13" 9, "Top table" 1, "Table 2, Top table" 2. */
function tablesIn(place: string): number {
  const counted = /^(\d+) × /u.exec(place);
  if (counted?.[1] !== undefined) return Number(counted[1]);
  const numbered = /^Tables? (\d+(?:–\d+)?(?:, \d+(?:–\d+)?)*)$/u.exec(place);
  if (numbered?.[1] === undefined) return place.split(", ").length;
  return numbered[1].split(", ").reduce((sum, run) => {
    const [from = 0, to] = run.split("–").map(Number);
    return sum + (to === undefined ? 1 : to - from + 1);
  }, 0);
}

/** A printed seat entry: "110 at Tables 1–11 (10 each)". */
const SEAT_ENTRY = /^(\d+) at (.+?)(?: \((\d+) each\))?$/u;

/**
 * Where the paper and the phone disagree about the room, in words; empty when
 * they agree. The paper's form comes from its own layout (setupForm): under
 * the brief, each table's line carries its chairs and there is no chairs line;
 * on the setup's own page, the chairs at a step's tables have a line of their
 * own and the tables' lines carry none. The paper must print, for every item,
 * exactly its store count and that form's setup lines (sheetStoreList and
 * sheetSetupSteps, the shared rules in @omnitwin/types). The phone lists the
 * manifest's rows zone by zone; merged across zones, each phase's rows must be
 * that phase's setup lines. The chairs line, read from the paper itself, must
 * count what the phase's table rows seat, its entries must add up to it, each
 * table kind's chairs as the rows seat them, a place's "N each" times its
 * tables must be its entry (with more than one table there), and a counted
 * place's tables as many as the rows set. The chairs all table rows seat, with
 * the loose chairs, must be the store's chair count.
 */
export function roomDisagreements(sheet: HallkeeperSheetV2, pdf: Buffer): string[] {
  const text = bodyText(pdf);
  const form = setupForm(pdf);
  const steps = sheetSetupSteps(sheet, { chairsLine: form === "own-page" });
  const storeGroups = sheetStoreList(sheet);
  const store = storeGroups.flatMap((group) => group.items);
  const found: string[] = [];

  const lines = steps.flatMap((step) => step.items);
  const names = new Set([...store.map((item) => item.name), ...lines.map((item) => item.name)]);
  for (const name of names) {
    const expected = [
      ...store.filter((item) => item.name === name).map((item) => item.qty),
      ...lines.filter((item) => item.name === name).map((item) => item.qty),
    ].sort((a, b) => a - b);
    const printed = quantitiesBefore(text, name);
    if (!sameNumbers(printed, expected)) {
      found.push(`paper prints ${name} as [${printed.join(", ")}], the store and the setup ${form === "own-page" ? "on its own page, with its chairs line," : "under the brief"} say [${expected.join(", ")}]`);
    }
  }

  const rows = sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows));
  const printedLines = printedSetupLines(pdf);
  const seatLines = printedLines.filter((line) => /^\d+ at /u.test(line.place));
  if (form === "under-brief" && seatLines.length > 0) found.push(`the setup sits under the brief, yet the paper prints a chairs line: ${seatLines.map((line) => line.place).join(" | ")}`);
  if (form === "own-page") {
    for (const line of printedLines.filter((candidate) => candidate.chairs !== null)) {
      found.push(`the setup has its own page, yet the paper prints chairs on ${line.name}'s line: ${line.chairs ?? ""}`);
    }
  }
  let seatLine = 0;
  for (const phase of sheet.phases) {
    const phaseRows = phase.zones.flatMap((zone) => zone.rows);
    const onPhone = new Map<string, number>();
    const tablesOnPhone = new Map<string, number>();
    const seatedOnPhone = new Map<string, number>();
    for (const row of phaseRows) {
      const item = row.category === "table" ? SEATED.exec(row.name)?.[1] ?? row.name : row.name;
      onPhone.set(item, (onPhone.get(item) ?? 0) + row.qty);
      if (row.category !== "table") continue;
      tablesOnPhone.set(item, (tablesOnPhone.get(item) ?? 0) + row.qty);
      if (seatsOf(row) > 0) seatedOnPhone.set(item, (seatedOnPhone.get(item) ?? 0) + seatsOf(row));
    }
    const onPaper = new Map<string, number>();
    for (const item of steps.find((step) => step.phase === phase.phase)?.items ?? []) {
      if (item.seats === null) onPaper.set(item.name, (onPaper.get(item.name) ?? 0) + item.qty);
    }
    for (const name of new Set([...onPhone.keys(), ...onPaper.keys()])) {
      if (onPhone.get(name) !== onPaper.get(name)) {
        found.push(`${phase.phase}: the phone's rows give ${name} ×${String(onPhone.get(name) ?? 0)}, the paper ×${String(onPaper.get(name) ?? 0)}`);
      }
    }
    const phoneSeats = phaseRows.reduce((sum, row) => sum + seatsOf(row), 0);
    if (phoneSeats === 0) continue;
    if (form === "under-brief") {
      // Each table kind's line carries its own chairs.
      for (const [kind, seats] of seatedOnPhone) {
        const line = printedLines.find((candidate) => candidate.name === kind);
        const each = /^(\d+) chairs each$/u.exec(line?.chairs ?? "")?.[1];
        const all = /^(\d+) chairs in all$/u.exec(line?.chairs ?? "")?.[1];
        const printed = each !== undefined ? Number(each) * (line?.qty ?? 0) : all !== undefined ? Number(all) : null;
        if (printed !== seats) found.push(`${phase.phase}: the phone's ${kind} rows seat ${String(seats)} chairs, the paper's ${kind} line says ${line?.chairs ?? "nothing of them"}`);
      }
      continue;
    }
    // The chairs line, as the paper prints it: the next one, in the steps' order.
    const line = seatLines[seatLine];
    seatLine += 1;
    if (line === undefined) {
      found.push(`${phase.phase}: the phone's tables seat ${String(phoneSeats)} chairs, and the paper prints no chairs line for them`);
      continue;
    }
    if (line.qty !== phoneSeats) found.push(`${phase.phase}: the phone's tables seat ${String(phoneSeats)} chairs, the paper's chairs line ${String(line.qty)}`);
    const entries = line.place.split(" · ").map((entry) => SEAT_ENTRY.exec(entry));
    const read = entries.flatMap((entry) => (entry === null ? [] : [{ qty: Number(entry[1]), place: entry[2] ?? "", each: entry[3] === undefined ? null : Number(entry[3]) }]));
    if (read.length !== entries.length) found.push(`${phase.phase}: the paper's chairs line has a place it does not word as "N at …": ${line.place}`);
    if (read.reduce((sum, entry) => sum + entry.qty, 0) !== line.qty) found.push(`${phase.phase}: the paper's chairs line counts ${String(line.qty)} but its places add up to ${String(read.reduce((sum, entry) => sum + entry.qty, 0))}: ${line.place}`);
    const kinds = [...seatedOnPhone.values()].sort((a, b) => a - b);
    if (!sameNumbers(read.map((entry) => entry.qty).sort((a, b) => a - b), kinds)) {
      found.push(`${phase.phase}: the phone's table kinds seat [${kinds.join(", ")}], the paper's chairs line places [${read.map((entry) => entry.qty).join(", ")}]`);
    }
    for (const entry of read) {
      const tables = tablesIn(entry.place);
      if (entry.each !== null && (tables < 2 || tables * entry.each !== entry.qty)) {
        found.push(`${phase.phase}: the paper's "${String(entry.qty)} at ${entry.place} (${String(entry.each)} each)" does not add up: ${String(tables)} × ${String(entry.each)}`);
      }
      const counted = /^(\d+) × (.+)$/u.exec(entry.place);
      if (counted?.[2] !== undefined && tablesOnPhone.get(counted[2]) !== Number(counted[1])) {
        found.push(`${phase.phase}: the paper counts ${counted[1] ?? ""} × ${counted[2]}, the phone's rows set ${String(tablesOnPhone.get(counted[2]) ?? 0)}`);
      }
    }
  }
  if (seatLine < seatLines.length) found.push(`the paper prints ${String(seatLines.length - seatLine)} chairs line(s) the phone's tables do not seat`);

  const seated = rows.reduce((sum, row) => sum + seatsOf(row), 0);
  const loose = rows.filter((row) => row.category === "chair").reduce((sum, row) => sum + row.qty, 0);
  const chairs = storeGroups.find((group) => group.title === "Chairs")?.items.reduce((sum, item) => sum + item.qty, 0) ?? 0;
  if (seated + loose !== chairs) found.push(`the phone seats ${String(seated)} and lists ${String(loose)} loose chairs; the store holds ${String(chairs)}`);
  return found;
}

/** The chairs a sheet's table rows seat ("… with 10 chairs" × qty). */
export function seatedChairs(sheet: HallkeeperSheetV2): number {
  return sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows)).reduce((sum, row) => sum + seatsOf(row), 0);
}
