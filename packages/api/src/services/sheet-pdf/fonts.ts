import { readFileSync } from "node:fs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// The sheet's type: Newsreader and Inter, the House pairing, embedded from
// static TrueType instances in packages/api/assets/fonts (cut by
// scripts/build-sheet-fonts.py from the files the web self-hosts). pdfkit
// subsets each face into the PDF, so a sheet carries only the glyphs it uses.
// ---------------------------------------------------------------------------

export const SHEET_FACES = [
  "Newsreader-DisplayLight",
  "Newsreader-Regular",
  "Newsreader-Medium",
  "Newsreader-Italic",
  "Inter-Regular",
  "Inter-Medium",
  "Inter-SemiBold",
] as const;
export type SheetFace = (typeof SHEET_FACES)[number];

/** The Inter face that stands in when a Newsreader face lacks a glyph. */
const FALLBACK: Readonly<Record<SheetFace, SheetFace>> = {
  "Newsreader-DisplayLight": "Inter-Regular",
  "Newsreader-Regular": "Inter-Regular",
  "Newsreader-Medium": "Inter-SemiBold",
  "Newsreader-Italic": "Inter-Regular",
  "Inter-Regular": "Inter-Regular",
  "Inter-Medium": "Inter-Medium",
  "Inter-SemiBold": "Inter-SemiBold",
};

// src/services/sheet-pdf and dist/services/sheet-pdf both sit three levels
// below the package root, where assets/ ships with the API image.
const FONT_DIR = new URL("../../../assets/fonts/", import.meta.url);

const CoverageSchema = z.record(z.string(), z.array(z.tuple([z.number().int(), z.number().int()])));

let fontBytes: ReadonlyMap<SheetFace, Buffer> | null = null;
let coverage: ReadonlyMap<SheetFace, readonly (readonly [number, number])[]> | null = null;

function loadFonts(): ReadonlyMap<SheetFace, Buffer> {
  fontBytes ??= new Map(SHEET_FACES.map((face) => [face, readFileSync(new URL(`${face}.ttf`, FONT_DIR))]));
  return fontBytes;
}

function loadCoverage(): ReadonlyMap<SheetFace, readonly (readonly [number, number])[]> {
  if (coverage === null) {
    const parsed = CoverageSchema.parse(JSON.parse(readFileSync(new URL("coverage.json", FONT_DIR), "utf8")));
    coverage = new Map(SHEET_FACES.map((face) => {
      const ranges = parsed[face];
      if (ranges === undefined) throw new Error(`coverage.json has no entry for ${face}`);
      return [face, ranges];
    }));
  }
  return coverage;
}

/** Register every House face on a document under its own name. */
export function registerSheetFonts(doc: PDFKit.PDFDocument): void {
  for (const [face, bytes] of loadFonts()) doc.registerFont(face, bytes);
}

function covers(face: SheetFace, text: string): boolean {
  const ranges = loadCoverage().get(face) ?? [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x20) continue;
    let lo = 0;
    let hi = ranges.length - 1;
    let found = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const range = ranges[mid];
      if (range === undefined) break;
      if (cp < range[0]) hi = mid - 1;
      else if (cp > range[1]) lo = mid + 1;
      else { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * The face a string should be set in: the preferred one when it has every
 * glyph, else Inter of the matching weight, which also sets Greek and
 * Cyrillic. Scripts neither family sets (CJK, Arabic) keep Inter and print
 * the missing-glyph box, as Helvetica did before.
 */
export function faceFor(text: string, preferred: SheetFace): SheetFace {
  return covers(preferred, text) ? preferred : FALLBACK[preferred];
}
