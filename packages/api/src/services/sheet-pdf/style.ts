import { WORKSPACE_COLOURS } from "@omnitwin/types";
import { faceFor, type SheetFace } from "./fonts.js";

// ---------------------------------------------------------------------------
// The sheet's House register on paper: the desk's ink, rules and copper on
// white, Newsreader for names and numerals, Inter for the working text.
// Colour never carries meaning alone; every alert also says it in words, so
// a mono laser print loses nothing.
//
// Text is wrapped here, not by pdfkit, so a block is measured and drawn by
// the same rule and a paragraph can break across pages line by line.
// ---------------------------------------------------------------------------

export type Doc = PDFKit.PDFDocument;

export const INK = {
  primary: WORKSPACE_COLOURS["ink-1"],
  secondary: WORKSPACE_COLOURS["ink-2"],
  quiet: WORKSPACE_COLOURS["ink-3"],
  rule: WORKSPACE_COLOURS.rule,
  ruleStrong: WORKSPACE_COLOURS["rule-strong"],
  edge: WORKSPACE_COLOURS.edge,
  accent: WORKSPACE_COLOURS["copper-text"],
  alert: WORKSPACE_COLOURS["brick-text"],
  panel: WORKSPACE_COLOURS.paper,
  forest: WORKSPACE_COLOURS.forest,
  tableFill: WORKSPACE_COLOURS["sheet-hover"],
  stageFill: WORKSPACE_COLOURS["slate-wash"],
  chairLine: WORKSPACE_COLOURS["slate-dot"],
  /** Keep in view on page 1: the care panel's wash. */
  brickWash: WORKSPACE_COLOURS["brick-wash"],
  /** The rail beside the setup steps. */
  rail: WORKSPACE_COLOURS.sheet,
} as const;

export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 40,
  contentWidth: 595.28 - 80,
  /** Lowest point body content may reach; the footer lives below it. */
  contentBottom: 841.89 - 46,
  /** Top of the footer's text. */
  footerTop: 841.89 - 30,
} as const;

export interface TextStyle {
  readonly face: SheetFace;
  readonly size: number;
  readonly color: string;
  /** Letter spacing in points. */
  readonly tracking?: number;
  /** Extra space between wrapped lines, in points. */
  readonly lineGap?: number;
  /** Tabular figures, for times and counts that sit in columns. */
  readonly tnum?: boolean;
  readonly upper?: boolean;
}

export const TYPE = {
  overline: { face: "Inter-SemiBold", size: 6.6, color: INK.quiet, tracking: 0.85, upper: true },
  overlineAccent: { face: "Inter-SemiBold", size: 6.6, color: INK.accent, tracking: 0.85, upper: true },
  overlineAlert: { face: "Inter-SemiBold", size: 6.6, color: INK.alert, tracking: 0.85, upper: true },
  title: { face: "Newsreader-Regular", size: 25, color: INK.primary },
  /** The event's name heading the setup's own page: smaller than page 1's title. */
  runningTitle: { face: "Newsreader-Regular", size: 18, color: INK.primary },
  lede: { face: "Inter-Regular", size: 9.5, color: INK.secondary },
  status: { face: "Inter-Medium", size: 7.8, color: INK.secondary, lineGap: 1 },
  statusAlert: { face: "Inter-Medium", size: 7.8, color: INK.alert, lineGap: 1 },
  numeral: { face: "Newsreader-DisplayLight", size: 30, color: INK.primary, tnum: true },
  numeralAccent: { face: "Newsreader-DisplayLight", size: 30, color: INK.accent, tnum: true },
  numeralAlert: { face: "Newsreader-DisplayLight", size: 30, color: INK.alert, tnum: true },
  factName: { face: "Newsreader-Regular", size: 18.6, color: INK.primary },
  section: { face: "Newsreader-Regular", size: 13.5, color: INK.primary },
  step: { face: "Newsreader-DisplayLight", size: 19, color: INK.accent, tnum: true },
  label: { face: "Inter-Regular", size: 7.5, color: INK.quiet, lineGap: 0.5 },
  labelAlert: { face: "Inter-Regular", size: 7.5, color: INK.alert, lineGap: 0.5 },
  body: { face: "Inter-Regular", size: 8.8, color: INK.primary, lineGap: 1.2 },
  bodyDim: { face: "Inter-Regular", size: 8.8, color: INK.secondary, lineGap: 1.2 },
  bodyQuiet: { face: "Inter-Regular", size: 8.8, color: INK.quiet, lineGap: 1.2 },
  strong: { face: "Inter-SemiBold", size: 8.8, color: INK.primary, lineGap: 1.2 },
  paragraph: { face: "Inter-Regular", size: 9.4, color: INK.primary, lineGap: 2 },
  detail: { face: "Inter-Regular", size: 8, color: INK.secondary, lineGap: 0.8 },
  detailAccent: { face: "Inter-Medium", size: 7.6, color: INK.accent },
  detailAlert: { face: "Inter-SemiBold", size: 8, color: INK.alert, lineGap: 0.8 },
  item: { face: "Inter-Medium", size: 9.6, color: INK.primary, lineGap: 1 },
  itemPlain: { face: "Inter-Regular", size: 9.6, color: INK.primary, lineGap: 1 },
  qty: { face: "Inter-SemiBold", size: 10.5, color: INK.primary, tnum: true },
  time: { face: "Inter-Medium", size: 9.2, color: INK.primary, tnum: true },
  timeAccent: { face: "Inter-SemiBold", size: 9.2, color: INK.accent, tnum: true },
  dayTitle: { face: "Inter-Regular", size: 9.2, color: INK.primary, lineGap: 0.8 },
  dayTitleStrong: { face: "Inter-SemiBold", size: 9.2, color: INK.primary, lineGap: 0.8 },
  note: { face: "Newsreader-Italic", size: 9.2, color: INK.secondary, lineGap: 0.5 },
  where: { face: "Inter-Regular", size: 7.6, color: INK.quiet, lineGap: 0.5 },
  small: { face: "Inter-Regular", size: 6.8, color: INK.quiet, lineGap: 0.6 },
  footer: { face: "Inter-Regular", size: 6.8, color: INK.quiet },
  footerStrong: { face: "Inter-Medium", size: 6.8, color: INK.secondary, tnum: true },
  storeGroup: { face: "Inter-SemiBold", size: 7.6, color: INK.quiet },
  contactName: { face: "Inter-SemiBold", size: 10, color: INK.primary, lineGap: 0.5 },
  phone: { face: "Inter-Medium", size: 11, color: INK.primary, tnum: true },
  // Keep in view: a care fact's place in ink, its words in brick.
  carePlace: { face: "Inter-SemiBold", size: 9, color: INK.primary, lineGap: 1 },
  careWords: { face: "Inter-Regular", size: 9, color: INK.alert, lineGap: 1 },
  phoneLarge: { face: "Inter-Medium", size: 13, color: INK.primary, tnum: true },
  // The setup's progress rail (D).
  railMark: { face: "Inter-SemiBold", size: 9, color: INK.primary, tnum: true },
  railLabel: { face: "Inter-Medium", size: 8.2, color: INK.secondary },
  railLabelAccent: { face: "Inter-SemiBold", size: 8.2, color: INK.accent },
  railTime: { face: "Newsreader-Regular", size: 12, color: INK.accent, tnum: true },
  railTimeQuiet: { face: "Newsreader-Regular", size: 12, color: INK.quiet, tnum: true },
  // A setup step's head (D).
  stepNumeral: { face: "Newsreader-DisplayLight", size: 30, color: INK.accent, tnum: true },
  stepName: { face: "Newsreader-Regular", size: 15, color: INK.primary },
  stepDeadline: { face: "Newsreader-Regular", size: 13, color: INK.accent, tnum: true },
  stepDeadlineAlert: { face: "Newsreader-Regular", size: 13, color: INK.alert, tnum: true },
  stepReason: { face: "Newsreader-Italic", size: 9.4, color: INK.secondary, lineGap: 0.5 },
} as const satisfies Record<string, TextStyle>;

/** The string as it prints: upper-cased overlines. */
function printed(style: TextStyle, text: string): string {
  return style.upper === true ? text.toLocaleUpperCase("en-GB") : text;
}

/** The part of pdfkit's EmbeddedFont that holds the widths it writes to /W. */
interface EmbeddedWidths {
  readonly widths: number[];
  readonly scale: number;
  readonly font: { getGlyph(id: number): { readonly advanceWidth: number } };
}

function isEmbeddedWidths(value: unknown): value is EmbeddedWidths {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof EmbeddedWidths, unknown>>;
  const font = candidate.font as { getGlyph?: unknown } | null | undefined;
  return Array.isArray(candidate.widths) && typeof candidate.scale === "number" && typeof font?.getGlyph === "function";
}

const scaledMissingGlyph = new WeakSet();

/**
 * pdfkit 0.18 seeds the missing-glyph width unscaled (EmbeddedFont's
 * constructor: `this.widths = [this.font.getGlyph(0).advanceWidth]`, where
 * every other glyph is `advanceWidth * this.scale`). A viewer then advances
 * each missing-glyph box twice as far as the text was measured, so a CJK name
 * or an emoji in a note runs over the next column or off the page. Scale it
 * once per font, as pdfkit scales the rest.
 */
function scaleMissingGlyph(doc: Doc): void {
  // pdfkit keeps the selected font on a private field; read it as unknown.
  const font: unknown = Reflect.get(doc, "_font");
  if (!isEmbeddedWidths(font) || scaledMissingGlyph.has(font)) return;
  font.widths[0] = font.font.getGlyph(0).advanceWidth * font.scale;
  scaledMissingGlyph.add(font);
}

/** Select the face (falling back to Inter for scripts Newsreader lacks), size and colour. */
function apply(doc: Doc, style: TextStyle, text: string): void {
  doc.font(faceFor(text, style.face)).fontSize(style.size).fillColor(style.color);
  scaleMissingGlyph(doc);
}

function options(style: TextStyle, extra: PDFKit.Mixins.TextOptions = {}): PDFKit.Mixins.TextOptions {
  return {
    lineBreak: false,
    characterSpacing: style.tracking ?? 0,
    ...(style.tnum === true ? { features: ["tnum"] as PDFKit.Mixins.OpenTypeFeatures[] } : {}),
    ...extra,
  };
}

export function textWidth(doc: Doc, style: TextStyle, text: string): number {
  const value = printed(style, text);
  apply(doc, style, value);
  return doc.widthOfString(value, options(style));
}

/** A box in font units, y up, as fontkit gives a glyph's or a run's. */
interface FontBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** The part of pdfkit's EmbeddedFont that reads glyph outlines: fontkit's font, and where the baseline sits. */
interface EmbeddedOutlines {
  readonly ascender: number;
  readonly font: {
    readonly unitsPerEm: number;
    layout(text: string, features?: readonly string[]): {
      readonly bbox: FontBox;
      readonly glyphs: readonly { readonly bbox: FontBox; readonly codePoints: readonly number[] }[];
      readonly positions: readonly { readonly xAdvance: number; readonly xOffset: number; readonly yOffset: number }[];
    };
  };
}

function isEmbeddedOutlines(value: unknown): value is EmbeddedOutlines {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof EmbeddedOutlines, unknown>>;
  const font = candidate.font as { unitsPerEm?: unknown; layout?: unknown } | null | undefined;
  return typeof candidate.ascender === "number" && typeof font?.unitsPerEm === "number" && typeof font.layout === "function";
}

/**
 * The ink of one line as it prints, from its glyphs' own outlines: their box
 * against the line's left edge and its top, y down the page, as drawLine sets
 * a line (pdfkit puts the baseline the face's ascender below the top). A name
 * with no descenders inks only down to its baseline. Null for a face with no
 * outlines to read, or nothing to ink.
 */
export function inkBox(doc: Doc, style: TextStyle, text: string): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null {
  const value = printed(style, text);
  apply(doc, style, value);
  // pdfkit keeps the selected font on a private field; read it as unknown.
  const font: unknown = Reflect.get(doc, "_font");
  if (!isEmbeddedOutlines(font)) return null;
  const box = font.font.layout(value, style.tnum === true ? ["tnum"] : undefined).bbox;
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return null;
  const scale = style.size / font.font.unitsPerEm;
  const baseline = font.ascender / 1000 * style.size;
  // Tracking moves each later glyph along by its spacing, counted as pdfkit counts it (the string's length).
  const tracking = (style.tracking ?? 0) * Math.max(0, value.length - 1);
  return { left: box.minX * scale, top: baseline - box.maxY * scale, right: box.maxX * scale + tracking, bottom: baseline - box.minY * scale };
}

/** One glyph's ink: its box against the line's left edge and top, y down the page. */
export interface InkRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/**
 * The ink of one line glyph by glyph, as inkBox reads the whole line: each
 * inked glyph's box from its own outline, where the run sets it, at inkBox's
 * scale and baseline, each later glyph moved along by the tracking pdfkit
 * counts before it. A glyph with nothing to ink (a space) has no box. Null
 * for a face with no outlines to read, or nothing to ink.
 */
export function inkGlyphs(doc: Doc, style: TextStyle, text: string): readonly InkRect[] | null {
  const value = printed(style, text);
  apply(doc, style, value);
  // pdfkit keeps the selected font on a private field; read it as unknown.
  const font: unknown = Reflect.get(doc, "_font");
  if (!isEmbeddedOutlines(font)) return null;
  const run = font.font.layout(value, style.tnum === true ? ["tnum"] : undefined);
  // The layout's shape is pdfkit's fontkit's, read at run time: glyphs and their positions, one for one.
  const shapes: readonly unknown[] = [run.glyphs, run.positions];
  if (!shapes.every((list) => Array.isArray(list)) || run.glyphs.length !== run.positions.length) return null;
  const scale = style.size / font.font.unitsPerEm;
  const baseline = font.ascender / 1000 * style.size;
  const tracking = style.tracking ?? 0;
  const glyphs: InkRect[] = [];
  let x = 0;
  let units = 0;
  for (const [index, glyph] of run.glyphs.entries()) {
    const at = run.positions[index];
    if (at === undefined) return null;
    const box = glyph.bbox;
    if ([box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite) && box.maxX > box.minX) {
      const shift = tracking * units;
      glyphs.push({
        left: (x + at.xOffset + box.minX) * scale + shift, top: baseline - (at.yOffset + box.maxY) * scale,
        right: (x + at.xOffset + box.maxX) * scale + shift, bottom: baseline - (at.yOffset + box.minY) * scale,
      });
    }
    x += at.xAdvance;
    units += glyph.codePoints.reduce((sum, point) => sum + (point > 0xFFFF ? 2 : 1), 0);
  }
  return glyphs.length === 0 ? null : glyphs;
}

/** One wrapped line's advance: the face's line height plus the style's gap. */
export function lineHeight(doc: Doc, style: TextStyle, sample = "Ag"): number {
  apply(doc, style, sample);
  return doc.currentLineHeight(false) + (style.lineGap ?? 0);
}

/** Draw one line with no wrapping. Align to `width` when given. */
export function drawLine(doc: Doc, style: TextStyle, text: string, x: number, y: number, align?: { readonly width: number; readonly to: "right" | "center" }): number {
  const value = printed(style, text);
  const w = align === undefined ? 0 : textWidth(doc, style, value);
  const left = align === undefined ? x : align.to === "right" ? x + align.width - w : x + (align.width - w) / 2;
  apply(doc, style, value);
  doc.text(value, left, y, options(style));
  return y + lineHeight(doc, style, value);
}

/**
 * Break a word wider than the line (a pasted link, a paragraph of Chinese)
 * between characters. Each character is measured once and the cut found by
 * walking those widths, then checked against the real measure (kerning), so
 * the work grows with the word's length, not its square. A cut always moves
 * on by at least one character, and never inside a surrogate pair.
 */
function breakWord(doc: Doc, style: TextStyle, word: string, width: number): { lines: string[]; rest: string } {
  const chars = Array.from(word);
  const widths = chars.map((char) => textWidth(doc, style, char));
  const lines: string[] = [];
  let start = 0;
  for (;;) {
    let end = start;
    let sum = 0;
    while (end < chars.length && sum + (widths[end] ?? 0) <= width) { sum += widths[end] ?? 0; end++; }
    if (end === start) end = start + 1;
    while (end - start > 1 && textWidth(doc, style, chars.slice(start, end).join("")) > width) end--;
    const piece = chars.slice(start, end).join("");
    if (end >= chars.length) return { lines, rest: piece };
    lines.push(piece);
    start = end;
  }
}

/** The no-break space that ties what the sheet keeps on one line ("13 (10 each)"). */
const TIE = "\u00A0";

/**
 * Break a tied unit wider than the line ("Family-of-the-groom (8 each)", its
 * parts tied by no-break spaces) at its own ties first: its end stays whole as
 * far as it fits on a line (the count at each, in its brackets), and what comes
 * before breaks the same way. Only a part still wider than the line breaks
 * between characters (breakWord), the last resort.
 */
function breakTied(doc: Doc, style: TextStyle, word: string, width: number): { lines: string[]; rest: string } {
  const parts = word.split(TIE);
  if (parts.length < 2) return breakWord(doc, style, word, width);
  const fits = (text: string): boolean => textWidth(doc, style, text) <= width;
  // The longest end that fits a line of its own; at least the last part, fitting or not.
  let from = parts.length - 1;
  while (from > 1 && fits(parts.slice(from - 1).join(TIE))) from--;
  const head = parts.slice(0, from).join(TIE);
  const tail = parts.slice(from).join(TIE);
  const lines: string[] = [];
  if (fits(head)) {
    if (head.length > 0) lines.push(head);
  } else {
    const broken = breakTied(doc, style, head, width);
    lines.push(...broken.lines, broken.rest);
  }
  if (fits(tail)) return { lines, rest: tail };
  const broken = breakWord(doc, style, tail, width);
  return { lines: [...lines, ...broken.lines], rest: broken.rest };
}

/** Wrapped lines per document, so a block measured and then drawn wraps once. */
const wrapped = new WeakMap<Doc, Map<string, readonly string[]>>();

/** Whitespace a line may break at, other than the plain space: \s less the tie (U+00A0). */
const BREAKING_SPACE = /[^\S \u00A0]/gu;

/** A run of spaces of any kind (a tab, a no-break, figure or narrow no-break space, a doubled space), short of a line break. */
const SPACE_RUN = /[^\S\r\n]+/gu;

/**
 * The sheet's data as it prints: every run of spaces in its words read as the
 * one plain space it prints as, the writer's line breaks kept. A planner's
 * text comes from calendars, word processors and web pages: a narrow no-break
 * space before "AM", which no House face sets (a missing-glyph box, and the
 * line drops out of its face); a no-break space for every space, one word the
 * wrap cannot break; an HTML double space. Read so where the sheet's data comes
 * in (generateSheetPdfV2), the only ties a sheet prints are the ones it sets
 * itself (the seat note's). The data is a validated sheet, plain JSON: each
 * string is read again, nothing else changes.
 */
export function spacesAsPrinted<T>(data: T): T {
  return plainSpacedValue(data) as T;
}

function plainSpacedValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SPACE_RUN, " ");
  if (Array.isArray(value)) return value.map(plainSpacedValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainSpacedValue(item)]));
  }
  return value;
}

/**
 * Greedy wrap at spaces, keeping the writer's own line breaks. A word wider
 * than the line (an email address, a link) breaks between characters; a tied
 * unit wider than the line breaks at its own ties first (breakTied).
 */
export function wrapLines(doc: Doc, style: TextStyle, text: string, width: number): readonly string[] {
  const key = `${style.face}|${String(style.size)}|${String(style.tracking ?? 0)}|${style.upper === true ? "U" : ""}${style.tnum === true ? "T" : ""}|${String(width)}|${text}`;
  let cache = wrapped.get(doc);
  if (cache === undefined) { cache = new Map(); wrapped.set(doc, cache); }
  const known = cache.get(key);
  if (known !== undefined) return known;

  const out: string[] = [];
  const fits = (candidate: string): boolean => textWidth(doc, style, candidate) <= width;
  for (const paragraph of printed(style, text).split(/\r?\n/u)) {
    // Lines break only at a plain space (U+0020), so a no-break space (U+00A0)
    // holds what it ties ("13 (10 each)"); JavaScript's \s would match it. By
    // here the sheet's own ties are the only ones (spacesAsPrinted reads a
    // planner's as plain spaces where the data comes in). Any other space (a
    // tab, a narrow no-break space no House face sets) breaks as a plain one.
    // A middle dot keeps to the word before it, so no line starts with one.
    const words: string[] = [];
    for (const word of paragraph.replace(BREAKING_SPACE, " ").split(/ +/u).filter((part) => part.length > 0)) {
      if (word === "·" && words.length > 0) words[words.length - 1] = `${words[words.length - 1] ?? ""} ·`;
      else words.push(word);
    }
    let line = "";
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (fits(candidate)) { line = candidate; continue; }
      if (line.length > 0) out.push(line);
      if (fits(word)) { line = word; continue; }
      // A word too long for the line breaks at its own ties, else between
      // characters; a middle dot kept with it stays on its last piece, so it
      // cannot start a line.
      const dotted = word.endsWith(" ·");
      const bare = dotted ? word.slice(0, -2) : word;
      const broken = breakTied(doc, style, bare, dotted ? Math.max(1, width - textWidth(doc, style, " ·")) : width);
      out.push(...broken.lines);
      line = dotted ? `${broken.rest} ·` : broken.rest;
    }
    out.push(line);
  }
  cache.set(key, out);
  return out;
}

/**
 * The text wrapped with its lines evened out: the narrowest width that keeps
 * the line count `width` gives, and every word as `width` keeps it, so a short
 * last word never sits alone and no word is broken to even the lines. Text on
 * one line stays as it is.
 */
export function balancedLines(doc: Doc, style: TextStyle, text: string, width: number): readonly string[] {
  const lines = wrapLines(doc, style, text, width);
  if (lines.length < 2) return lines;
  const words = lines.join(" ");
  const keeps = (trial: readonly string[]): boolean => trial.length === lines.length && trial.join(" ") === words;
  let low = width / 2;
  let high = width;
  for (let step = 0; step < 8; step++) {
    const middle = (low + high) / 2;
    if (keeps(wrapLines(doc, style, text, middle))) high = middle;
    else low = middle;
  }
  return wrapLines(doc, style, text, high);
}

export function blockHeight(doc: Doc, style: TextStyle, text: string, width: number): number {
  return wrapLines(doc, style, text, width).length * lineHeight(doc, style, text);
}

/** Draw a wrapped block; returns the y below its last line. */
export function drawBlock(doc: Doc, style: TextStyle, text: string, x: number, y: number, width: number): number {
  const height = lineHeight(doc, style, text);
  let cursor = y;
  for (const line of wrapLines(doc, style, text, width)) {
    apply(doc, style, line);
    doc.text(line, x, cursor, options(style));
    cursor += height;
  }
  return cursor;
}

export function hairline(doc: Doc, x1: number, y: number, x2: number, color: string = INK.rule, weight = 0.6): void {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(weight).strokeColor(color).stroke().restore();
}

export function upright(doc: Doc, x: number, y1: number, y2: number, color: string = INK.rule, weight = 0.6): void {
  doc.save().moveTo(x, y1).lineTo(x, y2).lineWidth(weight).strokeColor(color).stroke().restore();
}
