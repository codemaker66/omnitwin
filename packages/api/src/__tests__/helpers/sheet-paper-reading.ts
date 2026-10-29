import { inflateSync } from "node:zlib";
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
import { pdfPages } from "./pdf-text.js";

// ---------------------------------------------------------------------------
// Reading a printed hallkeeper sheet the way the person holding it does:
// its words (through helpers/pdf-text.ts) and its QR code, read back from the
// PDF's own drawing operators. Used by the release-identity tests, which
// compare what the paper says with what the phone is served.
// ---------------------------------------------------------------------------

/** Footer runs sit on one baseline about 23 pt above the page's foot. */
const isFooter = (y: number): boolean => y > 18 && y < 30;

/** Every page's text with the footer band left out, as one string. */
export function bodyText(pdf: Buffer): string {
  return pdfPages(pdf).flat().filter((line) => !isFooter(line.y))
    .map((line) => line.text).join(" ").replace(/\s+/gu, " ");
}

/** Each page's footer runs, joined. */
export function footers(pdf: Buffer): string[] {
  return pdfPages(pdf).map((page) => page.filter((line) => isFooter(line.y)).map((line) => line.text).join(" "));
}

const RECT = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/u;

/**
 * The QR code a pdfkit PDF draws, as rows of dark (1) and light (0) modules:
 * a white square, a fill, then one small square per dark module up to the
 * next fill. Rows and columns count from the top-left finder pattern's
 * corner module, which is always dark, and the cell is the smallest step
 * between module columns, so nothing here depends on the renderer's quiet
 * zone or cell size. Null when the PDF draws no code.
 */
export function printedQr(pdf: Buffer): string[] | null {
  const source = pdf.toString("latin1");
  for (const match of source.matchAll(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gu)) {
    const raw = Buffer.from(match[2] ?? "", "latin1");
    let content: string;
    try {
      content = (/\/FlateDecode/u.test(match[1] ?? "") ? inflateSync(raw) : raw).toString("latin1");
    } catch {
      continue;
    }
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

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Where the paper and the phone disagree about the room, in words; empty when
 * they agree. The paper must print, for every item, exactly its store count
 * and its setup lines (sheetStoreList and sheetSetupSteps, the shared rules
 * in @omnitwin/types). The phone lists the manifest's rows zone by zone;
 * merged across zones, each phase's rows must be that phase's setup lines,
 * and the chairs its table rows seat, with its loose chairs, must be the
 * store's chair count.
 */
export function roomDisagreements(sheet: HallkeeperSheetV2, pdf: Buffer): string[] {
  const text = bodyText(pdf);
  const steps = sheetSetupSteps(sheet);
  const storeGroups = sheetStoreList(sheet);
  const store = storeGroups.flatMap((group) => group.items);
  const found: string[] = [];

  const names = new Set([...store.map((item) => item.name), ...steps.flatMap((step) => step.items.map((item) => item.name))]);
  for (const name of names) {
    const expected = [
      ...store.filter((item) => item.name === name).map((item) => item.qty),
      ...steps.flatMap((step) => step.items.filter((item) => item.name === name).map((item) => item.qty)),
    ].sort((a, b) => a - b);
    const printed = quantitiesBefore(text, name);
    if (!sameNumbers(printed, expected)) found.push(`paper prints ${name} as [${printed.join(", ")}], the lists say [${expected.join(", ")}]`);
  }

  const rows = sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows));
  for (const phase of sheet.phases) {
    const onPhone = new Map<string, number>();
    for (const row of phase.zones.flatMap((zone) => zone.rows)) {
      const item = SEATED.exec(row.name)?.[1] ?? row.name;
      onPhone.set(item, (onPhone.get(item) ?? 0) + row.qty);
    }
    const onPaper = new Map<string, number>();
    for (const item of steps.find((step) => step.phase === phase.phase)?.items ?? []) {
      onPaper.set(item.name, (onPaper.get(item.name) ?? 0) + item.qty);
    }
    for (const name of new Set([...onPhone.keys(), ...onPaper.keys()])) {
      if (onPhone.get(name) !== onPaper.get(name)) {
        found.push(`${phase.phase}: the phone's rows give ${name} ×${String(onPhone.get(name) ?? 0)}, the paper ×${String(onPaper.get(name) ?? 0)}`);
      }
    }
  }

  const seated = rows.reduce((sum, row) => sum + row.qty * Number(SEATED.exec(row.name)?.[2] ?? 0), 0);
  const loose = rows.filter((row) => row.category === "chair").reduce((sum, row) => sum + row.qty, 0);
  const chairs = storeGroups.find((group) => group.title === "Chairs")?.items.reduce((sum, item) => sum + item.qty, 0) ?? 0;
  if (seated + loose !== chairs) found.push(`the phone seats ${String(seated)} and lists ${String(loose)} loose chairs; the store holds ${String(chairs)}`);
  return found;
}

/** The chairs a sheet's table rows seat ("… with 10 chairs" × qty). */
export function seatedChairs(sheet: HallkeeperSheetV2): number {
  return sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows))
    .reduce((sum, row) => sum + row.qty * Number(SEATED.exec(row.name)?.[2] ?? 0), 0);
}
