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

/** Wrapped lines per document, so a block measured and then drawn wraps once. */
const wrapped = new WeakMap<Doc, Map<string, readonly string[]>>();

/**
 * Greedy wrap at spaces, keeping the writer's own line breaks; a word wider
 * than the line (an email address, a link) breaks between characters.
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
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter((part) => part.length > 0)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (fits(candidate)) { line = candidate; continue; }
      if (line.length > 0) out.push(line);
      if (fits(word)) { line = word; continue; }
      const broken = breakWord(doc, style, word, width);
      out.push(...broken.lines);
      line = broken.rest;
    }
    out.push(line);
  }
  cache.set(key, out);
  return out;
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
