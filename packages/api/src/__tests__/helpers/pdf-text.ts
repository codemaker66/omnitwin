import { inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Read text back out of a pdfkit PDF whose fonts are embedded subsets.
//
// pdfkit writes each run as Identity-H glyph codes (two bytes each) and gives
// every font a ToUnicode range map and a /W width array. This reads the same
// bytes a viewer would: no browser, no font substitution. It understands what
// pdfkit writes (one content stream per page, BT … Tm … Tf … Tc … TJ … ET),
// not every PDF.
// ---------------------------------------------------------------------------

export interface PdfLine {
  readonly text: string;
  /** Left edge, PDF points from the page's left. */
  readonly x: number;
  /** Baseline, PDF points from the page's bottom. */
  readonly y: number;
  readonly size: number;
  /** BaseFont, e.g. "CZZZZZ+InterSheet-SemiBold". */
  readonly font: string;
  /** Advance width in points, from the font's /W array, spacing and kerning. */
  readonly width: number;
  /** Where the run ends, after any rotation the page applied. */
  readonly x2: number;
  readonly y2: number;
}

/** A PDF matrix [a b c d e f]; a point maps as (a·x + c·y + e, b·x + d·y + f). */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `cm` concatenates: the new matrix applies first, then the current one. */
function concat(m: Matrix, ctm: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = ctm;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

function apply(ctm: Matrix, x: number, y: number): [number, number] {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
}

interface FontInfo {
  readonly base: string;
  readonly unicode: ReadonlyMap<number, string>;
  readonly widths: ReadonlyMap<number, number>;
  readonly defaultWidth: number;
}

function objectsOf(buf: Buffer): Map<string, string> {
  const source = buf.toString("latin1");
  return new Map([...source.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/gu)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

/**
 * A stream's bytes: exactly its /Length after the "stream" line. Its end is
 * never found by "\r?\nendstream", which eats a final 0x0D byte of the data.
 */
function streamOf(body: string): string {
  const start = /stream\r?\n/u.exec(body);
  if (start === null) throw new Error("PDF object has no stream");
  const from = start.index + start[0].length;
  const length = /\/Length (\d+)(?! \d+ R)/u.exec(body.slice(0, start.index))?.[1];
  if (length === undefined) throw new Error("PDF stream has no direct /Length");
  const bytes = Buffer.from(body.slice(from, from + Number(length)), "latin1");
  return (/\/FlateDecode/u.test(body) ? inflateSync(bytes) : bytes).toString("latin1");
}

function refOf(body: string, key: string): string | undefined {
  return new RegExp(`/${key} (\\d+) 0 R`, "u").exec(body)?.[1];
}

function hexUnits(hex: string): string {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  return out;
}

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const range of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/giu)) {
    const lo = Number.parseInt(range[1] ?? "0", 16);
    const entries = [...(range[3] ?? "").matchAll(/<([0-9a-f\s]+)>/giu)].map((entry) => hexUnits((entry[1] ?? "").replace(/\s+/gu, "")));
    entries.forEach((value, index) => { map.set(lo + index, value); });
  }
  // The <lo> <hi> <start> form, read with the bracketed lists removed so their
  // entries are not mistaken for ranges.
  const outsideLists = cmap.replace(/\[[^\]]*\]/gu, " ");
  for (const range of outsideLists.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu)) {
    const lo = Number.parseInt(range[1] ?? "0", 16);
    const hi = Number.parseInt(range[2] ?? "0", 16);
    const start = Number.parseInt(range[3] ?? "0", 16);
    for (let code = lo; code <= hi; code++) map.set(code, String.fromCharCode(start + code - lo));
  }
  return map;
}

function parseWidths(descendant: string): { widths: Map<number, number>; defaultWidth: number } {
  const widths = new Map<number, number>();
  const defaultWidth = Number(/\/DW ([\d.]+)/u.exec(descendant)?.[1] ?? 1000);
  const w = /\/W \[([\s\S]*?)\]\s*\n/u.exec(descendant)?.[1] ?? "";
  const tokens = [...w.matchAll(/\[|\]|-?[\d.]+/gu)].map((token) => token[0]);
  let i = 0;
  while (i < tokens.length) {
    const first = Number(tokens[i]);
    if (tokens[i + 1] === "[") {
      i += 2;
      let code = first;
      while (i < tokens.length && tokens[i] !== "]") { widths.set(code, Number(tokens[i])); code++; i++; }
      i++;
    } else {
      const last = Number(tokens[i + 1]);
      const width = Number(tokens[i + 2]);
      for (let code = first; code <= last; code++) widths.set(code, width);
      i += 3;
    }
  }
  return { widths, defaultWidth };
}

function fontsOf(objects: ReadonlyMap<string, string>, resources: string): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const fontDict = /\/Font\s*<<([\s\S]*?)>>/u.exec(resources)?.[1] ?? "";
  for (const entry of fontDict.matchAll(/\/(\w+) (\d+) 0 R/gu)) {
    const body = objects.get(entry[2] ?? "") ?? "";
    const base = /\/BaseFont \/(\S+)/u.exec(body)?.[1] ?? "";
    const toUnicode = refOf(body, "ToUnicode");
    const descendant = /\/DescendantFonts \[(\d+) 0 R\]/u.exec(body)?.[1];
    const unicode = toUnicode === undefined ? new Map<number, string>() : parseToUnicode(streamOf(objects.get(toUnicode) ?? ""));
    const { widths, defaultWidth } = parseWidths(objects.get(descendant ?? "") ?? "");
    fonts.set(entry[1] ?? "", { base, unicode, widths, defaultWidth });
  }
  return fonts;
}

function pageIds(objects: ReadonlyMap<string, string>): string[] {
  const root = [...objects.values()].find((body) => /\/Type \/Pages\b/u.test(body) && !/\/Parent /u.test(body));
  const kids = /\/Kids \[([^\]]*)\]/u.exec(root ?? "")?.[1] ?? "";
  return [...kids.matchAll(/(\d+) 0 R/gu)].map((match) => match[1] ?? "");
}

/** Every text run on every page, in drawing order. */
export function pdfPages(buf: Buffer): PdfLine[][] {
  const objects = objectsOf(buf);
  return pageIds(objects).map((id) => {
    const page = objects.get(id) ?? "";
    const resourcesRef = refOf(page, "Resources");
    const resources = resourcesRef === undefined ? page : objects.get(resourcesRef) ?? "";
    const fonts = fontsOf(objects, resources);
    const content = streamOf(objects.get(refOf(page, "Contents") ?? "") ?? "");
    const lines: PdfLine[] = [];
    let ctm: Matrix = IDENTITY;
    const saved: Matrix[] = [];
    for (const op of content.matchAll(/(?<![\w/])([qQ])(?![\w])|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm|\bBT\b([\s\S]*?)\bET\b/gu)) {
      if (op[1] === "q") { saved.push(ctm); continue; }
      if (op[1] === "Q") { ctm = saved.pop() ?? IDENTITY; continue; }
      if (op[2] !== undefined) {
        ctm = concat([Number(op[2]), Number(op[3]), Number(op[4]), Number(op[5]), Number(op[6]), Number(op[7])], ctm);
        continue;
      }
      const body = op[8] ?? "";
      let x = 0; let y = 0; let font: FontInfo | undefined; let size = 0; let spacing = 0;
      for (const op of body.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm|\/(\w+) ([\d.]+) Tf|(-?[\d.]+) Tc|\[([^\]]*)\] TJ/gu)) {
        if (op[5] !== undefined) { x = Number(op[5]); y = Number(op[6]); }
        else if (op[7] !== undefined) { font = fonts.get(op[7]); size = Number(op[8]); }
        else if (op[9] !== undefined) spacing = Number(op[9]);
        else if (op[10] !== undefined && font !== undefined) {
          let text = ""; let width = 0;
          for (const part of op[10].matchAll(/<([0-9a-f]*)>|(-?[\d.]+)/giu)) {
            if (part[1] !== undefined) {
              for (let i = 0; i + 4 <= part[1].length; i += 4) {
                const code = Number.parseInt(part[1].slice(i, i + 4), 16);
                text += font.unicode.get(code) ?? "�";
                width += ((font.widths.get(code) ?? font.defaultWidth) / 1000) * size + spacing;
              }
            } else width -= (Number(part[2]) / 1000) * size;
          }
          const [startX, startY] = apply(ctm, x, y);
          const [endX, endY] = apply(ctm, x + width, y);
          lines.push({ text, x: startX, y: startY, x2: endX, y2: endY, size, font: font.base, width });
        }
      }
    }
    return lines;
  });
}

export interface PdfRule {
  /** Left and right ends, PDF points from the page's left. */
  readonly x: number;
  readonly x2: number;
  /** Height, PDF points from the page's bottom (as a text line's baseline). */
  readonly y: number;
}

const STRAIGHT_STROKE = /(?<![\w/])([qQ])(?![\w])|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm|(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\s+(?!-?[\d.]+ -?[\d.]+ l)/gu;

/**
 * Every horizontal line drawn as one segment, page by page: the sheet's
 * rules. A segment that carries on into another (a shape's edge) is not one.
 */
export function pdfRules(buf: Buffer): PdfRule[][] {
  const objects = objectsOf(buf);
  return pageIds(objects).map((id) => {
    const content = streamOf(objects.get(refOf(objects.get(id) ?? "", "Contents") ?? "") ?? "");
    const rules: PdfRule[] = [];
    let ctm: Matrix = IDENTITY;
    const saved: Matrix[] = [];
    for (const op of content.matchAll(STRAIGHT_STROKE)) {
      if (op[1] === "q") { saved.push(ctm); continue; }
      if (op[1] === "Q") { ctm = saved.pop() ?? IDENTITY; continue; }
      if (op[2] !== undefined) {
        ctm = concat([Number(op[2]), Number(op[3]), Number(op[4]), Number(op[5]), Number(op[6]), Number(op[7])], ctm);
        continue;
      }
      const [x1, y1] = apply(ctm, Number(op[8]), Number(op[9]));
      const [x2, y2] = apply(ctm, Number(op[10]), Number(op[11]));
      if (Math.abs(y1 - y2) < 0.01) rules.push({ x: Math.min(x1, x2), x2: Math.max(x1, x2), y: y1 });
    }
    return rules;
  });
}

/** All text, runs joined by single spaces, as a reader would search it. */
export function pdfText(buf: Buffer): string {
  return pdfPages(buf).flat().map((line) => line.text).join(" ").replace(/\s+/gu, " ").trim();
}

export function pdfPageSizes(buf: Buffer): { width: number; height: number }[] {
  const objects = objectsOf(buf);
  return pageIds(objects).map((id) => {
    const box = /\/MediaBox \[([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)\]/u.exec(objects.get(id) ?? "");
    return { width: Number(box?.[3] ?? 0), height: Number(box?.[4] ?? 0) };
  });
}

/** Images drawn on the pages; an image's transparency (its /SMask) is not counted. */
export function pdfImageCount(buf: Buffer): number {
  const objects = objectsOf(buf);
  const masks = new Set([...objects.values()].flatMap((body) => [...body.matchAll(/\/SMask (\d+) 0 R/gu)].map((match) => match[1] ?? "")));
  return [...objects].filter(([id, body]) => /\/Subtype \/Image\b/u.test(body) && !masks.has(id)).length;
}
