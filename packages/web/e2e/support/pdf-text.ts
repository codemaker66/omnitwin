import { inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// What Chromium painted on each page of a PDF it printed (page.pdf()), as
// text, page by page. Enough PDF for Chromium's own writer (Skia): numbered
// objects, the page tree, Flate streams, form XObjects, and text decoded
// through each font's ToUnicode map, with an /ActualText span read in place
// of its glyphs (Skia writes one where a glyph is not its character, as for
// tabular figures and ligatures). No object streams and no encryption: Skia
// writes neither, and this reads nothing else.
// ---------------------------------------------------------------------------

type Value =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "string"; readonly bytes: Buffer }
  | { readonly kind: "ref"; readonly id: number }
  | { readonly kind: "array"; readonly items: readonly Value[] }
  | { readonly kind: "dict"; readonly entries: ReadonlyMap<string, Value> }
  /** A keyword or a content-stream operator: obj, stream, R, Tf, Tj, BDC... */
  | { readonly kind: "word"; readonly value: string };

type Token = Value | { readonly kind: "punct"; readonly value: "[" | "]" | "<<" | ">>" };
type Dict = ReadonlyMap<string, Value>;

const SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set(Array.from("()<>[]{}/%", (c) => c.charCodeAt(0)));
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/u;
const ESCAPED: Readonly<Record<string, number>> = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c };

class Lexer {
  private readonly src: Buffer;
  pos: number;

  constructor(src: Buffer, pos = 0) {
    this.src = src;
    this.pos = pos;
  }

  private at(offset = 0): number | undefined {
    return this.src[this.pos + offset];
  }

  private regular(): string {
    const start = this.pos;
    for (let c = this.at(); c !== undefined && !SPACE.has(c) && !DELIMITER.has(c); c = this.at()) this.pos += 1;
    return this.src.toString("latin1", start, this.pos);
  }

  private hexString(): Token {
    const end = this.src.indexOf(0x3e, this.pos);
    const close = end === -1 ? this.src.length : end;
    const hex = this.src.toString("latin1", this.pos + 1, close).replace(/\s+/gu, "");
    this.pos = close + 1;
    return { kind: "string", bytes: Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, "hex") };
  }

  private literalString(): Token {
    const out: number[] = [];
    let depth = 0;
    this.pos += 1;
    for (let c = this.at(); c !== undefined; c = this.at()) {
      this.pos += 1;
      if (c === 0x29 && depth === 0) break;
      if (c === 0x28) depth += 1;
      if (c === 0x29) depth -= 1;
      if (c !== 0x5c) {
        out.push(c);
        continue;
      }
      const next = this.at() ?? 0;
      const letter = String.fromCharCode(next);
      this.pos += 1;
      if (/[0-7]/u.test(letter)) {
        let octal = letter;
        while (octal.length < 3 && /[0-7]/u.test(String.fromCharCode(this.at() ?? 0))) {
          octal += String.fromCharCode(this.at() ?? 0);
          this.pos += 1;
        }
        out.push(Number.parseInt(octal, 8) & 0xff);
      } else if (next === 0x0d || next === 0x0a) {
        if (next === 0x0d && this.at() === 0x0a) this.pos += 1;
      } else {
        out.push(ESCAPED[letter] ?? next);
      }
    }
    return { kind: "string", bytes: Buffer.from(out) };
  }

  token(): Token | null {
    for (let c = this.at(); c !== undefined && (SPACE.has(c) || c === 0x25); c = this.at()) {
      if (c === 0x25) while (this.at() !== undefined && this.at() !== 0x0a && this.at() !== 0x0d) this.pos += 1;
      else this.pos += 1;
    }
    const c = this.at();
    if (c === undefined) return null;
    if (c === 0x5b || c === 0x5d) {
      this.pos += 1;
      return { kind: "punct", value: c === 0x5b ? "[" : "]" };
    }
    if ((c === 0x3c || c === 0x3e) && this.at(1) === c) {
      this.pos += 2;
      return { kind: "punct", value: c === 0x3c ? "<<" : ">>" };
    }
    if (c === 0x3c) return this.hexString();
    if (c === 0x28) return this.literalString();
    if (c === 0x2f) {
      this.pos += 1;
      return { kind: "name", value: this.regular() };
    }
    const word = this.regular();
    if (word === "") {
      // A stray delimiter (")", "{", "}", ">"): nothing a page's text needs.
      this.pos += 1;
      return this.token();
    }
    return NUMBER.test(word) ? { kind: "number", value: Number(word) } : { kind: "word", value: word };
  }
}

/** One whole value (an array or a dictionary with all it holds), or null at the end. */
function readValue(lexer: Lexer, first?: Token | null): Value | null {
  const token = first ?? lexer.token();
  if (token === null) return null;
  if (token.kind === "punct") {
    if (token.value === "[") {
      const items: Value[] = [];
      for (let next = lexer.token(); next !== null && !(next.kind === "punct" && next.value === "]"); next = lexer.token()) {
        const item = readValue(lexer, next);
        if (item !== null) items.push(item);
      }
      return { kind: "array", items };
    }
    if (token.value === "<<") {
      const entries = new Map<string, Value>();
      for (let key = lexer.token(); key !== null && !(key.kind === "punct" && key.value === ">>"); key = lexer.token()) {
        const item = readValue(lexer);
        if (key.kind === "name" && item !== null) entries.set(key.value, item);
      }
      return { kind: "dict", entries };
    }
    return readValue(lexer);
  }
  if (token.kind === "number" && Number.isInteger(token.value)) {
    // "12 0 R" is a reference; anything else leaves the number on its own.
    const back = lexer.pos;
    const generation = lexer.token();
    const r = generation?.kind === "number" ? lexer.token() : null;
    if (r?.kind === "word" && r.value === "R") return { kind: "ref", id: token.value };
    lexer.pos = back;
  }
  return token;
}

interface PdfObject {
  readonly value: Value;
  readonly stream: Buffer | null;
}

function readObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString("latin1");
  const head = /(\d+)\s+\d+\s+obj\b/gu;
  const objects = new Map<number, PdfObject>();
  for (let match = head.exec(text); match !== null; match = head.exec(text)) {
    const lexer = new Lexer(pdf, match.index + match[0].length);
    const value = readValue(lexer);
    if (value === null) break;
    const after = lexer.pos;
    const word = lexer.token();
    let stream: Buffer | null = null;
    if (word?.kind === "word" && word.value === "stream") {
      let start = lexer.pos;
      if (pdf[start] === 0x0d) start += 1;
      if (pdf[start] === 0x0a) start += 1;
      const length = value.kind === "dict" ? value.entries.get("Length") : undefined;
      const end = length?.kind === "number" ? start + length.value : text.indexOf("endstream", start);
      stream = pdf.subarray(start, end);
      head.lastIndex = end;
    } else {
      head.lastIndex = after;
    }
    objects.set(Number(match[1]), { value, stream });
  }
  return objects;
}

function nameOf(value: Value | undefined): string | null {
  return value?.kind === "name" ? value.value : null;
}

function utf16be(bytes: Buffer): string {
  let out = "";
  for (let at = 0; at + 1 < bytes.length; at += 2) out += String.fromCharCode(bytes.readUInt16BE(at));
  return out;
}

/** A PDF text string: UTF-16BE behind its byte-order mark, otherwise PDFDocEncoding (read as Latin-1). */
function textString(bytes: Buffer): string {
  return bytes[0] === 0xfe && bytes[1] === 0xff ? utf16be(bytes.subarray(2)) : bytes.toString("latin1");
}

interface FontReader {
  /** Bytes a character code takes in a shown string. */
  readonly width: number;
  readonly toUnicode: ReadonlyMap<number, string>;
  /** A simple font with no ToUnicode map: its codes read as Latin-1. */
  readonly latin1: boolean;
}

function codeOf(bytes: Buffer): number {
  return bytes.reduce((code, byte) => code * 256 + byte, 0);
}

/** A ToUnicode CMap: its code width and its bfchar and bfrange entries. */
function readCMap(data: Buffer, width: number): FontReader {
  const lexer = new Lexer(data);
  const toUnicode = new Map<number, string>();
  let codeWidth = width;
  let operands: Value[] = [];
  for (let value = readValue(lexer); value !== null; value = readValue(lexer)) {
    if (value.kind !== "word") {
      operands.push(value);
      continue;
    }
    const strings = operands;
    operands = [];
    if (value.value === "endcodespacerange" && strings[0]?.kind === "string") codeWidth = strings[0].bytes.length;
    if (value.value === "endbfchar") {
      for (let at = 0; at + 1 < strings.length; at += 2) {
        const [code, unicode] = [strings[at], strings[at + 1]];
        if (code?.kind === "string" && unicode?.kind === "string") toUnicode.set(codeOf(code.bytes), utf16be(unicode.bytes));
      }
    }
    if (value.value === "endbfrange") {
      for (let at = 0; at + 2 < strings.length; at += 3) {
        const [low, high, target] = [strings[at], strings[at + 1], strings[at + 2]];
        if (low?.kind !== "string" || high?.kind !== "string") continue;
        const from = codeOf(low.bytes);
        for (let code = from; code <= Math.min(codeOf(high.bytes), from + 0xffff); code += 1) {
          if (target?.kind === "array") {
            const item = target.items[code - from];
            if (item?.kind === "string") toUnicode.set(code, utf16be(item.bytes));
          } else if (target?.kind === "string") {
            const units = Array.from({ length: target.bytes.length / 2 }, (_, i) => target.bytes.readUInt16BE(i * 2));
            const last = units.length - 1;
            if (last >= 0) units[last] = (units[last] ?? 0) + code - from;
            toUnicode.set(code, String.fromCharCode(...units));
          }
        }
      }
    }
  }
  return { width: codeWidth, toUnicode, latin1: false };
}

function decode(font: FontReader, bytes: Buffer): string {
  let out = "";
  for (let at = 0; at + font.width <= bytes.length; at += font.width) {
    const code = codeOf(bytes.subarray(at, at + font.width));
    out += font.toUnicode.get(code) ?? (font.latin1 ? String.fromCharCode(code) : "");
  }
  return out;
}

export interface PdfPage {
  /** The page's text in the order it was painted; spacing is whatever the PDF gives. */
  readonly text: string;
  readonly widthPt: number;
  readonly heightPt: number;
}

class PdfReader {
  private readonly objects: ReadonlyMap<number, PdfObject>;
  private readonly fonts = new Map<number, FontReader>();

  constructor(pdf: Buffer) {
    this.objects = readObjects(pdf);
  }

  private resolve(value: Value | undefined): Value | undefined {
    let at = value;
    for (let hops = 0; at?.kind === "ref" && hops < 32; hops += 1) at = this.objects.get(at.id)?.value;
    return at;
  }

  private dict(value: Value | undefined): Dict | null {
    const resolved = this.resolve(value);
    return resolved?.kind === "dict" ? resolved.entries : null;
  }

  private stream(value: Value | undefined): Buffer {
    const object = value?.kind === "ref" ? this.objects.get(value.id) : undefined;
    if (object === undefined || object.stream === null) return Buffer.alloc(0);
    const filter = object.value.kind === "dict" ? object.value.entries.get("Filter") : undefined;
    let data = object.stream;
    for (const step of filter === undefined ? [] : filter.kind === "array" ? filter.items : [filter]) {
      if (nameOf(step) !== "FlateDecode") throw new Error("The PDF uses a stream filter this reader does not know.");
      data = inflateSync(data);
    }
    return data;
  }

  private font(value: Value): FontReader {
    const cached = value.kind === "ref" ? this.fonts.get(value.id) : undefined;
    if (cached !== undefined) return cached;
    const font = this.dict(value);
    const composite = nameOf(font?.get("Subtype")) === "Type0";
    const toUnicode = font?.get("ToUnicode");
    const reader = toUnicode === undefined
      ? { width: composite ? 2 : 1, toUnicode: new Map<number, string>(), latin1: !composite }
      : readCMap(this.stream(toUnicode), composite ? 2 : 1);
    if (value.kind === "ref") this.fonts.set(value.id, reader);
    return reader;
  }

  /** Appends the text one content stream shows, entering the form XObjects it draws. */
  private content(data: Buffer, resources: Dict | null, out: string[], depth: number): void {
    const fonts = this.dict(resources?.get("Font"));
    const xobjects = this.dict(resources?.get("XObject"));
    const lexer = new Lexer(data);
    /** One entry a marked-content sequence; true while it is an /ActualText span. */
    const spans: boolean[] = [];
    let operands: Value[] = [];
    let font: FontReader | null = null;
    const show = (shown: Value | undefined): void => {
      if (shown?.kind === "string" && font !== null && !spans.includes(true)) out.push(decode(font, shown.bytes));
    };
    for (let value = readValue(lexer); value !== null; value = readValue(lexer)) {
      if (value.kind !== "word") {
        operands.push(value);
        continue;
      }
      const given = operands;
      operands = [];
      const last = given[given.length - 1];
      switch (value.value) {
        case "Tf": {
          const ref = fonts?.get(nameOf(given[0]) ?? "");
          font = ref === undefined ? null : this.font(ref);
          break;
        }
        case "Tj":
        case "'":
        case "\"":
          show(last);
          break;
        case "TJ":
          if (last?.kind === "array") for (const item of last.items) show(item);
          break;
        case "BDC": {
          const actual = this.dict(last)?.get("ActualText");
          if (actual?.kind === "string" && !spans.includes(true)) out.push(textString(actual.bytes));
          spans.push(actual?.kind === "string");
          break;
        }
        case "BMC":
          spans.push(false);
          break;
        case "EMC":
          spans.pop();
          break;
        case "ET":
          out.push("\n");
          break;
        case "Do": {
          const ref = xobjects?.get(nameOf(last) ?? "");
          const form = this.dict(ref);
          if (form !== null && nameOf(form.get("Subtype")) === "Form" && depth < 8) {
            this.content(this.stream(ref), this.dict(form.get("Resources")) ?? resources, out, depth + 1);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private collect(node: Dict, inherited: { readonly resources: Dict | null; readonly box: Value | undefined }, found: PdfPage[], depth: number): void {
    const resources = this.dict(node.get("Resources")) ?? inherited.resources;
    const box = node.get("MediaBox") ?? inherited.box;
    if (nameOf(node.get("Type")) === "Pages") {
      const kids = this.resolve(node.get("Kids"));
      if (kids?.kind !== "array" || depth > 32) return;
      for (const kid of kids.items) {
        const child = this.dict(kid);
        if (child !== null) this.collect(child, { resources, box }, found, depth + 1);
      }
      return;
    }
    const raw = node.get("Contents");
    const contents = this.resolve(raw);
    const out: string[] = [];
    for (const part of contents?.kind === "array" ? contents.items : raw === undefined ? [] : [raw]) {
      this.content(this.stream(part), resources, out, 0);
    }
    const edges = this.resolve(box);
    const [x0, y0, x1, y1] = edges?.kind === "array" ? edges.items.map((edge) => (edge.kind === "number" ? edge.value : 0)) : [];
    found.push({ text: out.join(""), widthPt: (x1 ?? 0) - (x0 ?? 0), heightPt: (y1 ?? 0) - (y0 ?? 0) });
  }

  pages(): PdfPage[] {
    const catalog = [...this.objects.values()].find((object) => object.value.kind === "dict" && nameOf(object.value.entries.get("Type")) === "Catalog");
    const root = catalog?.value.kind === "dict" ? this.dict(catalog.value.entries.get("Pages")) : null;
    if (root === null) throw new Error("The PDF has no page tree.");
    const found: PdfPage[] = [];
    this.collect(root, { resources: null, box: undefined }, found, 0);
    return found;
  }
}

/** Each page of a PDF Chromium printed, with the text painted on it, in page order. */
export function readPdfPages(pdf: Buffer): PdfPage[] {
  return new PdfReader(pdf).pages();
}

/** Text with every space and line end taken out, so a line reads the same however the PDF spaced its glyphs. */
export function squashed(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** How many times `line` is painted on each page, spacing ignored. */
export function timesOnEachPage(pages: readonly PdfPage[], line: string): number[] {
  const wanted = squashed(line);
  return pages.map((page) => (wanted === "" ? 0 : squashed(page.text).split(wanted).length - 1));
}
