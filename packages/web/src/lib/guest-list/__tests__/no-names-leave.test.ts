import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { foundWords, keepingLine, leftOutWords, seatedSentence, toSeatSentence } from "../../../components/guest-list/words.js";
import { memoryBackend, withBackend, type CacheBackend } from "../../idb-cache.js";
import { useGuestListStore } from "../../../stores/guest-list-store.js";
import { toCsv } from "../export.js";
import { GUESTS_MAX, emptyGuestList, repairGuestList, type GuestList } from "../model.js";
import { byTable, covers, markPrinted, placeCards, tablePlanAZ } from "../paper.js";
import { parsePaste, takeNames, type ColumnPick } from "../parse-paste.js";
import { addGuests, moveGuest, removeTable, renameGuest, seatEveryone, setTables, summary } from "../seating.js";
import { createGuestListStore } from "../store.js";

// ---------------------------------------------------------------------------
// The kit's central promise: no guest's name leaves the device and none reaches
// an error report, a log line, a class name, an address or a tag.
//
// Two kinds of proof. First the kit's source files are read as text (the list
// is made at test time, so a file added later is scanned too) and refused if
// they could carry a name out. Second a canary name is run through the kit's
// pure functions and a store whose storage refuses every call, and may appear
// only where it belongs. The scans are themselves tried on samples that break
// them, so a scan that has gone blind fails here.
// ---------------------------------------------------------------------------

const CANARY = "CANARY-Q7";

/** The web package's src folder; vitest runs from the package root, as the other source-reading tests assume. */
const SRC = resolve("src");

// ---------------------------------------------------------------------------
// Reading the kit's source
// ---------------------------------------------------------------------------

interface Source {
  /** Path from `src`, forward slashes: "pages/GuestListPage.tsx". */
  readonly path: string;
  /** The file with its comments blanked to spaces, so offsets and lines still match the file. */
  readonly code: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full);
    return [full];
  });
}

function filesIn(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

function fromSrc(file: string): string {
  return relative(SRC, file).replaceAll("\\", "/");
}

function isKitCode(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.(?:test|d)\.tsx?$/.test(file);
}

/** Every kit source file, found now: its libraries, components, store and pages. */
function kitPaths(): string[] {
  return [
    ...walk(join(SRC, "lib", "guest-list")),
    ...walk(join(SRC, "components", "guest-list")),
    ...filesIn(join(SRC, "stores"), /^guest-list-store(?:\..*)?\.tsx?$/),
    ...filesIn(join(SRC, "pages"), /^Guest.*\.tsx$/),
  ]
    .filter(isKitCode)
    .map(fromSrc)
    .sort();
}

const blank = (text: string): string => text.replace(/[^\n]/g, " ");

function parseSource(code: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const isJsDoc = (node: ts.Node): boolean => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

/**
 * Every token of the file (a node with no children), in order, with the JSX text
 * between tags set aside. The parser, not a pattern, decides what is a token:
 * `//` or `/*` inside a string, a regular expression, a template or JSX text is
 * not a comment to it.
 */
function leafTokens(file: ts.SourceFile): { readonly tokens: readonly ts.Node[]; readonly textStarts: ReadonlySet<number> } {
  const tokens: ts.Node[] = [];
  const textStarts = new Set<number>();
  const collect = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      textStarts.add(node.pos);
      return;
    }
    if (isJsDoc(node)) return;
    const children = node.getChildren(file);
    if (children.length === 0) tokens.push(node);
    else children.forEach(collect);
  };
  collect(file);
  return { tokens, textStarts };
}

/** The comments the parser sees: the trivia before and after each token, never JSX text. */
function commentRanges(file: ts.SourceFile): readonly ts.CommentRange[] {
  const { tokens, textStarts } = leafTokens(file);
  const ranges = new Map<number, ts.CommentRange>();
  for (const token of tokens) {
    for (const range of ts.getLeadingCommentRanges(file.text, token.pos) ?? []) ranges.set(range.pos, range);
    // Text right after a tag is JSX text, which can hold `//`; it is not trivia.
    if (!textStarts.has(token.end)) {
      for (const range of ts.getTrailingCommentRanges(file.text, token.end) ?? []) ranges.set(range.pos, range);
    }
  }
  return [...ranges.values()].sort((a, b) => a.pos - b.pos);
}

/** Comments out, as spaces: lines and offsets kept, everything else (strings, JSX text, regular expressions) untouched. */
function blankComments(text: string, path: string): string {
  let result = "";
  let at = 0;
  for (const range of commentRanges(parseSource(text, path))) {
    result += text.slice(at, range.pos) + blank(text.slice(range.pos, range.end));
    at = range.end;
  }
  return result + text.slice(at);
}

/** The text of every token, comments excluded: two texts that differ only in comments give the same list. */
function tokensOf(text: string, path: string): string[] {
  const file = parseSource(text, path);
  return leafTokens(file).tokens.map((token) => token.getText(file));
}

function readSource(path: string): Source {
  return { path, code: blankComments(readFileSync(join(SRC, path), "utf8"), path) };
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
// Reading literals and brackets, as far as the scans need
// ---------------------------------------------------------------------------

/** The index just past the string or template literal that opens at `at`. */
function endOfLiteral(text: string, at: number): number {
  const quote = text.charAt(at);
  let i = at + 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "\\") {
      i += 2;
    } else if (c === quote) {
      return i + 1;
    } else if (quote === "`" && c === "$" && text.charAt(i + 1) === "{") {
      i = endOfBracket(text, i + 1) + 1;
    } else {
      i += 1;
    }
  }
  return text.length;
}

/** The index of the bracket that closes the one opening at `open`, skipping literals. */
function endOfBracket(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"' || c === "'" || c === "`") {
      i = endOfLiteral(text, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length;
}

// ---------------------------------------------------------------------------
// The scans. Each returns what it found as "path:line: what", nothing when clean.
// ---------------------------------------------------------------------------

type Scan = (source: Source) => string[];

function found(source: Source, index: number, what: string): string {
  return `${source.path}:${String(lineOf(source.code, index))}: ${what}`;
}

function matches(source: Source, pattern: RegExp, what: string): string[] {
  return [...source.code.matchAll(pattern)].map((m) => found(source, m.index, what));
}

/** An argument that is nothing, or one plain string with nothing joined into it. */
function isFixedWords(argument: string): boolean {
  return /^\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`$\\]|\\.)*`)?\s*$/.test(argument);
}

/** Errors carry fixed words only: no template or joined text, no variable, in an Error, a rejection or a throw. */
const errorsAreFixedWords: Scan = (source) => {
  const calls = /\bnew\s+[A-Za-z]*Error\s*\(|(?<![\w.])Error\s*\(|\bPromise\s*\.\s*reject\s*\(|(?<![\w.])reject\s*\(/g;
  const out: string[] = [];
  for (const call of source.code.matchAll(calls)) {
    const open = call.index + call[0].length - 1;
    const argument = source.code.slice(open + 1, endOfBracket(source.code, open));
    // A rejection may hold a new Error: that call is checked on its own turn.
    const rejectsAnError =
      /reject/.test(call[0]) &&
      /^\s*new\s+[A-Za-z]*Error\s*\(/.test(argument) &&
      endOfBracket(argument, argument.indexOf("(")) === argument.trimEnd().length - 1;
    if (!isFixedWords(argument) && !rejectsAnError) out.push(found(source, call.index, "an error or rejection carries more than fixed words"));
  }
  for (const thrown of source.code.matchAll(/\bthrow\b([^;\n]*)/g)) {
    if (!/^\s*new\s+[A-Za-z]*Error\s*\(/.test(thrown[1] ?? "")) {
      out.push(found(source, thrown.index, "a throw that is not a new Error with fixed words"));
    }
  }
  out.push(...matches(source, /\bcatch\s*\(/g, "a caught value is bound to a name; the kit's catch keeps nothing"));
  return out;
};

const nothingIsLogged: Scan = (source) => matches(source, /\bconsole\b/g, "a console call");

const nothingIsReported: Scan = (source) => [
  ...matches(source, /\b(?:reportFailure|captureWarning|captureException|captureMessage)\s*\(/g, "a failure report"),
  ...matches(source, /\bSentry\b|@sentry\//g, "the error reporter"),
];

/**
 * Every way the page could send something out or move itself somewhere with
 * something on the end: `fetch` in any position (called, held in a variable, on
 * window or globalThis), the other transports, an assignment to the location
 * (a declaration of a variable named location is not one), a picture or audio
 * made to load, a new URL, navigation helpers, `mailto:` and its kin.
 *
 * Reading the location (`useLocation`, `location.pathname`) is not a way out.
 * `link.href = blobUrl` for the download is not one either: the file never
 * leaves the device.
 */
const WAYS_OUT = new RegExp(
  [
    String.raw`\bfetch\b`,
    String.raw`\bXMLHttpRequest\b`,
    String.raw`\bsendBeacon\b`,
    String.raw`\bWebSocket\b`,
    String.raw`\bEventSource\b`,
    String.raw`\bpostMessage\b`,
    String.raw`\bnavigator\s*\.\s*share\b`,
    String.raw`\bwindow\s*\.\s*open\b`,
    String.raw`(?<!\b(?:const|let|var)\s+)\b(?:(?:window|document|globalThis|self)\s*\.\s*)?location\s*(?:\.\s*(?:href|search|hash|pathname)\s*)?=(?!=)`,
    String.raw`\blocation\s*\.\s*(?:assign|replace|reload)\b`,
    String.raw`\b(?:pushState|replaceState)\b`,
    String.raw`\.(?:src|srcset|poster)\s*=(?!=)`,
    String.raw`\bnew\s+(?:Image|Audio|URL)\b`,
    String.raw`\bnavigate\s*\(`,
    String.raw`\buseNavigate\b`,
    String.raw`\bNavigate\b`,
    String.raw`\b(?:useSearchParams|setSearchParams)\b`,
    String.raw`\b(?:mailto|tel|sms):`,
  ].join("|"),
  "g",
);

const nothingGoesOverTheNetwork: Scan = (source) => matches(source, WAYS_OUT, "a way to send something out or to move the page");

/** The kit's switch is the one thing it keeps in web storage, and only under its own key. */
const KIT_SWITCH = "lib/guest-list/kit-switch.ts";
const DEVICE_STORE = "lib/guest-list/store.ts";
const storageIsKeptToItsPlace: Scan = (source) => {
  const out: string[] = [];
  const web = [...source.code.matchAll(/\b(?:localStorage|sessionStorage)\b/g)];
  if (source.path !== KIT_SWITCH) {
    out.push(...web.map((m) => found(source, m.index, "web storage outside the kit switch")));
  } else {
    const own = [...source.code.matchAll(/\bwindow\.localStorage\.(?:setItem|removeItem|getItem)\(KIT_STORAGE_KEY\b/g)];
    if (own.length !== web.length) out.push(found(source, web[0]?.index ?? 0, "web storage used for something other than the switch's own key"));
  }
  if (source.path !== DEVICE_STORE) {
    out.push(...matches(source, /\bindexedDB\b|\bopenCache\b|\bdocument\s*\.\s*cookie\b/g, "storage outside the device store"));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Attributes and addresses, read from the syntax tree
//
// The scans below follow the names a piece of code refers to, so a bare
// `className={guest.name}`, a helper's answer and a template are all seen
// the same way. Every name a class, id, tag or address may be built from is
// on a list here with the reason it is not a guest's text; a name that is on
// no list fails, and a name on a list that nothing uses fails too.
// ---------------------------------------------------------------------------

/**
 * Every name the code refers to, in order: `guest`, `count.view`, `String`,
 * `.join` (a method on something that is not a plain name). String, template
 * text and number literals refer to nothing.
 */
function referencesIn(node: ts.Node): string[] {
  const plainChain = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
    if (ts.isPropertyAccessExpression(expression)) {
      const root = plainChain(expression.expression);
      return root === null ? null : `${root}.${expression.name.text}`;
    }
    return null;
  };
  const out: string[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) {
      out.push(current.text);
    } else if (ts.isConditionalExpression(current)) {
      // The condition picks a value; it is never the value. Only the two branches can be what is built.
      visit(current.whenTrue);
      visit(current.whenFalse);
    } else if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      // `a && b` is b, or a when a is empty or false: nothing of a's content gets through.
      visit(current.right);
    } else if (ts.isPropertyAccessExpression(current)) {
      const chain = plainChain(current);
      if (chain !== null) {
        out.push(chain);
      } else {
        visit(current.expression);
        out.push(`.${current.name.text}`);
      }
    } else {
      ts.forEachChild(current, visit);
    }
  };
  visit(node);
  return out;
}

interface Allowance {
  /** Why the name is not a guest's text. */
  readonly why: string;
  /** The files it may be used in; null for any. */
  readonly files: readonly string[] | null;
}

type Allowed = ReadonlyMap<string, Allowance>;

function isAllowed(allowed: Allowed, reference: string, path: string): boolean {
  const allowance = allowed.get(reference);
  return allowance !== undefined && (allowance.files === null || allowance.files.includes(path));
}

/** One name an attribute or an address is built from, and where. */
interface Reference {
  readonly what: string;
  readonly reference: string;
  /** "path:line: ", ready to put before a finding. */
  readonly at: string;
}

function referenceAt(source: Source, file: ts.SourceFile, node: ts.Node, what: string, reference: string): Reference {
  return { what, reference, at: found(source, node.getStart(file), "") };
}

/**
 * The attributes that become a class, an id, a tag or a pointer to an id in the page.
 * Left out on purpose, each for its reason, so nobody "fixes" them later:
 *  - `aria-label`, `title`, `alt`, `placeholder`, `value`, `aria-valuetext` and the like carry text that is
 *    meant to be read, and a reader of the list is meant to read a guest's name in them;
 *  - `key` is React's own and never reaches the page.
 */
const DOM_ATTRIBUTES: ReadonlySet<string> = new Set([
  "className",
  "id",
  "htmlFor",
  "name",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
]);

const isDomAttribute = (name: string): boolean => DOM_ATTRIBUTES.has(name) || name.startsWith("data-");

/** The attributes that hold an address. */
const ADDRESS_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "srcSet", "poster", "to", "action", "formAction", "xlinkHref"]);

/** The names every class, id, tag or pointer to an id is built from, as they stand. */
const ID_FILES = [
  "components/guest-list/GuestPanel.tsx",
  "components/guest-list/GuestPaste.tsx",
  "components/guest-list/GuestRows.tsx",
  "components/guest-list/GuestTables.tsx",
  "pages/GuestListPage.tsx",
] as const;

const ALLOWED_IN_ATTRIBUTES: Allowed = new Map<string, Allowance>([
  ["id", { why: "React's useId value, an opaque string React makes (each file is checked for `const id = useId()`); the text beside it is fixed", files: ID_FILES }],
  ["titleId", { why: "React's useId value in the paper page (checked for `const titleId = useId()`)", files: ["pages/GuestPaperPage.tsx"] }],
  ["String", { why: "turns a number to text; its argument is listed on its own, so `String(guest.name)` still fails", files: ["components/guest-list/GuestRows.tsx"] }],
  ["at", { why: "the position of a letter group in the A to Z list, a number, inside an id", files: ["components/guest-list/GuestRows.tsx"] }],
  ["undefined", { why: "leaves the attribute off", files: null }],
  ["count.view", { why: "one of the list page's four fixed view words (all, seated, to-seat, tables), inside an id", files: ["pages/GuestListPage.tsx"] }],
  ["count.tone", { why: "a fixed tone word from the list page's own table (settled, owed) or nothing", files: ["pages/GuestListPage.tsx"] }],
  ["notice.kind", { why: "the kind of a notice, a fixed word of the store's KitNotice type (repaired, other-tab)", files: ["pages/GuestListPage.tsx"] }],
]);

/** The names every address is built from. */
const ALLOWED_IN_ADDRESSES: Allowed = new Map<string, Allowance>([
  ["planId", { why: "the plan's own id, from the address the planner is already on", files: null }],
  ["sheet", { why: "one of the four fixed sheet words (the Sheet type)", files: ["components/guest-list/GuestPanel.tsx", "pages/GuestPaperPage.tsx"] }],
  ["sheet.sheet", { why: "the sheet word in the panel's own table of the four sheets", files: ["components/guest-list/GuestPanel.tsx"] }],
  ["entry.sheet", { why: "the sheet word in the paper page's own table of the four sheets", files: ["pages/GuestPaperPage.tsx"] }],
  ["paperAddress", { why: "the panel's address helper: built from the plan id and a sheet word only, its template is checked here too", files: ["components/guest-list/GuestPanel.tsx"] }],
  ["listAddress", { why: "the paper page's address helper: built from the plan id and the kit word only, its template is checked here too", files: ["pages/GuestPaperPage.tsx"] }],
  ["sheetAddress", { why: "the paper page's address helper: plan id, the address's own query and a sheet word, its template is checked here too", files: ["pages/GuestPaperPage.tsx"] }],
  ["params.toString", { why: "the address's own query after only the kit switch and the sheet word have been set on it", files: ["pages/GuestPaperPage.tsx"] }],
  ["KIT_PARAM", { why: "the fixed word kit", files: ["pages/GuestPaperPage.tsx"] }],
  ["SHEET_PARAM", { why: "the fixed word sheet", files: ["pages/GuestPaperPage.tsx"] }],
  ["search", { why: "the address's own query string, read from the router or the window: an address, not a guest", files: ["lib/guest-list/kit-switch.ts", "pages/GuestPaperPage.tsx"] }],
]);

/** Every name a class, id, tag or pointer to an id in the file is built from; a spread onto a DOM element counts as one. */
function domAttributeReferences(source: Source): Reference[] {
  const file = parseSource(source.code, source.path);
  const out: Reference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      const value = node.initializer;
      if (isDomAttribute(name) && value !== undefined && ts.isJsxExpression(value) && value.expression !== undefined) {
        for (const reference of referencesIn(value.expression)) out.push(referenceAt(source, file, node, name, reference));
      }
    } else if (ts.isJsxSpreadAttribute(node)) {
      const element = node.parent.parent;
      const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(file) : "";
      if (/^[a-z]/.test(tag)) out.push(referenceAt(source, file, node, "a spread onto an element", `...${node.expression.getText(file)}`));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      // `element.className = x`, `element.id = x`, `element.dataset.key = x`
      const target = node.left.name.text;
      const onDataset = ts.isPropertyAccessExpression(node.left.expression) && node.left.expression.name.text === "dataset";
      if (isDomAttribute(target) || onDataset) {
        for (const reference of referencesIn(node.right)) out.push(referenceAt(source, file, node, `.${target} =`, reference));
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      // `element.setAttribute("data-x", x)`, `element.classList.add(x)`
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const [first] = node.arguments;
      if (method === "setAttribute") {
        const fixedName = first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
        const watched = fixedName === null || fixedName === "class" || fixedName === "for" || isDomAttribute(fixedName);
        if (watched) for (const argument of node.arguments) for (const reference of referencesIn(argument)) out.push(referenceAt(source, file, node, "setAttribute", reference));
      } else if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === "classList") {
        for (const argument of node.arguments) for (const reference of referencesIn(argument)) out.push(referenceAt(source, file, node, `classList.${method}`, reference));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const attributesAreNotBuiltFromData: Scan = (source) =>
  domAttributeReferences(source)
    .filter(({ reference }) => !isAllowed(ALLOWED_IN_ATTRIBUTES, reference, source.path))
    .map(({ what, reference, at }) => `${at}${what} is built from ${reference}`);

/** A template that begins like an address: a path, a scheme, a query or a fragment. */
const ADDRESS_HEAD = /^(?:\/|https?:|mailto:|tel:|sms:|\?|#|\.{1,2}\/)/;

/** The receivers whose `set` and `append` write into an address's query. */
const QUERY_RECEIVER = /^(?:params|searchParams|query|url\.searchParams)$/;

/** Every name an address is built from: address attributes, address-like templates and query writes. */
function addressReferences(source: Source): Reference[] {
  const file = parseSource(source.code, source.path);
  const out: Reference[] = [];
  const take = (node: ts.Node, what: string, from: ts.Node): void => {
    for (const reference of referencesIn(from)) out.push(referenceAt(source, file, node, what, reference));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      const value = node.initializer;
      if (ADDRESS_ATTRIBUTES.has(name) && value !== undefined && ts.isJsxExpression(value) && value.expression !== undefined) {
        take(node, `${name} (an address)`, value.expression);
      }
    } else if (ts.isTemplateExpression(node) && ADDRESS_HEAD.test(node.head.text)) {
      take(node, "an address", node);
    } else if (ts.isNewExpression(node) && node.expression.getText(file) === "URLSearchParams") {
      for (const argument of node.arguments ?? []) take(node, "a query", argument);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if ((method === "set" || method === "append") && QUERY_RECEIVER.test(node.expression.expression.getText(file))) {
        for (const argument of node.arguments) take(node, "a query", argument);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const addressesAreNotBuiltFromData: Scan = (source) =>
  addressReferences(source)
    .filter(({ reference }) => !isAllowed(ALLOWED_IN_ADDRESSES, reference, source.path))
    .map(({ what, reference, at }) => `${at}${what} is built from ${reference}`);

// ---------------------------------------------------------------------------
// Fields a browser may send to a spelling service
// ---------------------------------------------------------------------------

/**
 * The kinds of `<input>` that hold no text a person types, each with why it may
 * go without `spellCheck={false}` and `autoComplete="off"`. Every other input,
 * and every `<textarea>`, can hold a guest's name (a party is a household's
 * surname, a table or an event is often named for people): with a browser's
 * cloud spelling service on, its text would go to that service, and an
 * autofill store would keep it.
 */
const INPUT_TYPES_WITH_NO_TEXT: ReadonlyMap<string, string> = new Map([
  ["date", "holds a calendar day, never a name; no browser spells a date or offers to keep one as text"],
  ["number", "holds a count (tables, seats); no browser spells a number"],
  ["checkbox", "holds a yes or no; there is no text in it"],
]);

/** Every text `<input>` and every `<textarea>` carries `spellCheck={false}` and `autoComplete="off"`. */
const nameFieldsOptOut: Scan = (source) => {
  const file = parseSource(source.code, source.path);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (tag === "input" || tag === "textarea") {
        const at = (what: string): string => found(source, node.getStart(file), `a <${tag}> ${what}`);
        const attributes = node.attributes.properties;
        if (attributes.some((attribute) => ts.isJsxSpreadAttribute(attribute))) {
          out.push(at("takes a spread, so what it carries cannot be read here"));
        } else {
          const value = (name: string): string | null => {
            const attribute = attributes.find((a) => ts.isJsxAttribute(a) && a.name.getText(file) === name);
            if (attribute === undefined || !ts.isJsxAttribute(attribute) || attribute.initializer === undefined) return null;
            return attribute.initializer.getText(file);
          };
          const type = tag === "input" ? value("type") : null;
          const noText = type !== null && INPUT_TYPES_WITH_NO_TEXT.has(type.replace(/^"|"$/g, ""));
          if (!noText) {
            if (value("spellCheck") !== "{false}") out.push(at("that can hold a name lacks spellCheck={false}"));
            if (value("autoComplete") !== '"off"') out.push(at('that can hold a name lacks autoComplete="off"'));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
};

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

interface Import {
  readonly spec: string;
  readonly typeOnly: boolean;
  /** The names taken from it, `type` markers and `as` aliases left off. */
  readonly names: readonly string[];
  readonly index: number;
}

function importsOf(source: Source): Import[] {
  const out: Import[] = [];
  for (const m of source.code.matchAll(/\b(?:import|export)\s+(type\s+)?([^;"'`]*?)\bfrom\s*(["'])([^"']+)\3/g)) {
    const names = (m[2] ?? "")
      .replace(/[{}*]/g, " ")
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim() ?? "")
      .filter((name) => name !== "");
    out.push({ spec: m[4] ?? "", typeOnly: m[1] !== undefined, names, index: m.index });
  }
  for (const m of source.code.matchAll(/\bimport\s*(["'])([^"']+)\1/g)) {
    out.push({ spec: m[2] ?? "", typeOnly: false, names: [], index: m.index });
  }
  for (const m of source.code.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
    out.push({ spec: m[2] ?? "", typeOnly: false, names: [], index: m.index });
  }
  return out;
}

/** Where a relative import lands, from `src`, without its extension; null for a package. */
function landing(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return fromSrc(resolve(dirname(join(SRC, from)), spec)).replace(/\.(?:js|ts|tsx)$/, "");
}

/** The packages the kit may import. A new one is a decision, not an accident. */
const ALLOWED_PACKAGES = ["react", "react-dom", "react-router-dom", "zod", "zustand", "@omnitwin/types"];

const RESPONSIBLE_FOR_THE_READ = "pages/GuestListPage.tsx";
const TYPE_ONLY_FROM_THE_PLAN = "lib/guest-list/plan-tables.ts";

const importsAreOnlyWhatIsAllowed: Scan = (source) => {
  const out: string[] = [];
  for (const imported of importsOf(source)) {
    const at = landing(source.path, imported.spec);
    const what = `import of "${imported.spec}"`;
    if (at === null) {
      const known = ALLOWED_PACKAGES.some((pkg) => imported.spec === pkg || imported.spec.startsWith(`${pkg}/`));
      if (!known || /(?:^|\/)api\//.test(imported.spec)) out.push(found(source, imported.index, `${what} is not a package the kit may use`));
      continue;
    }
    if (at === "api/client" || at.startsWith("api/client/")) {
      out.push(found(source, imported.index, `${what} reaches the API client`));
    } else if (at.startsWith("api/")) {
      const readsThePlan = at === "api/configurations";
      const allowedValue = readsThePlan && !imported.typeOnly && source.path === RESPONSIBLE_FOR_THE_READ;
      const allowedType = readsThePlan && imported.typeOnly && source.path === TYPE_ONLY_FROM_THE_PLAN;
      if (!allowedValue && !allowedType) out.push(found(source, imported.index, `${what} reaches the API`));
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Reading the kit, now
// ---------------------------------------------------------------------------

const PATHS = kitPaths();
const SOURCES = PATHS.map(readSource);

/** Allowances that nothing uses, or that name a file that does not use them. */
function staleAllowances(allowed: Allowed, referencesOf: (source: Source) => readonly Reference[]): string[] {
  const used = new Set<string>();
  for (const source of SOURCES) {
    for (const { reference } of referencesOf(source)) {
      if (isAllowed(allowed, reference, source.path)) used.add(`${reference} in ${source.path}`);
    }
  }
  const usedAnywhere = (reference: string): boolean => [...used].some((entry) => entry.startsWith(`${reference} in `));
  return [...allowed].flatMap(([reference, { files }]) =>
    files === null
      ? usedAnywhere(reference) ? [] : [reference]
      : files.filter((path) => !used.has(`${reference} in ${path}`)).map((path) => `${reference} in ${path}`),
  );
}

function scanAll(scan: Scan): string[] {
  return SOURCES.flatMap(scan);
}

describe("the kit's source, read as text", () => {
  it("is found by listing the kit's folders, and includes the pages, the store and the device store", () => {
    expect(PATHS.length).toBeGreaterThan(0);
    for (const known of [
      "pages/GuestListPage.tsx",
      "pages/GuestPaperPage.tsx",
      "stores/guest-list-store.ts",
      DEVICE_STORE,
      KIT_SWITCH,
      "lib/guest-list/seating.ts",
      "components/guest-list/GuestPanel.tsx",
    ]) {
      expect(PATHS, `${known} is among the files scanned`).toContain(known);
    }
    expect(PATHS.some((path) => path.includes("__tests__") || /\.test\./.test(path))).toBe(false);
  });

  it("no source file of the kit builds an error, a rejection or a throw from data", () => {
    expect(scanAll(errorsAreFixedWords)).toEqual([]);
  });

  it("no source file of the kit logs anything", () => {
    expect(scanAll(nothingIsLogged)).toEqual([]);
  });

  it("no source file of the kit sends a failure to a report", () => {
    expect(scanAll(nothingIsReported)).toEqual([]);
  });

  it("no source file of the kit can send anything out: no fetch, XMLHttpRequest, beacon, socket or new address", () => {
    expect(scanAll(nothingGoesOverTheNetwork)).toEqual([]);
  });

  it("web storage is used only by the kit switch, only under its own key; IndexedDB only by the device store", () => {
    expect(scanAll(storageIsKeptToItsPlace)).toEqual([]);
  });

  it("no class name, id or tag is built from data, apart from the few state words allowed here", () => {
    expect(scanAll(attributesAreNotBuiltFromData)).toEqual([]);
  });

  it("every allowance for attributes is still used, in every file it names, so none has gone stale", () => {
    expect(staleAllowances(ALLOWED_IN_ATTRIBUTES, domAttributeReferences)).toEqual([]);
  });

  it("an id taken from useId really is one in every file that uses it", () => {
    for (const source of SOURCES) {
      for (const name of ["id", "titleId"]) {
        const used = domAttributeReferences(source).some(({ reference }) => reference === name);
        if (used) expect(source.code, `${source.path} makes ${name} with useId`).toMatch(new RegExp(String.raw`\bconst ${name} = useId\(\);`));
      }
    }
  });

  it("no address is built from data, apart from the plan's id, the sheet word and the address's own query", () => {
    expect(scanAll(addressesAreNotBuiltFromData)).toEqual([]);
  });

  it("every allowance for addresses is still used, in every file it names, so none has gone stale", () => {
    expect(staleAllowances(ALLOWED_IN_ADDRESSES, addressReferences)).toEqual([]);
  });

  it("every field that can hold a name opts out of spelling services and autofill: spellCheck={false}, autoComplete=\"off\"", () => {
    expect(scanAll(nameFieldsOptOut)).toEqual([]);
    // The scan is not blind: the kit's name field, party field, paste box, table name and event title are all text fields.
    const fields = SOURCES.flatMap((source) => [...source.code.matchAll(/<(?:input|textarea)\b/g)].map(() => source.path));
    expect(fields.length).toBeGreaterThanOrEqual(5);
  });

  it("no source file of the kit imports the API client, except the one read of the plan", () => {
    expect(scanAll(importsAreOnlyWhatIsAllowed)).toEqual([]);
  });

  it("only pages/GuestListPage.tsx imports from api/configurations, and takes only getPublicConfig; plan-tables.ts imports a type from it", () => {
    const fromConfigurations = SOURCES.flatMap((source) =>
      importsOf(source)
        .filter((imported) => landing(source.path, imported.spec) === "api/configurations")
        .map((imported) => ({ path: source.path, typeOnly: imported.typeOnly, names: imported.names })),
    );
    expect(fromConfigurations).toEqual([
      // Value import: the one read of the plan.
      { path: RESPONSIBLE_FOR_THE_READ, typeOnly: false, names: ["getPublicConfig"] },
      // `import type` is erased when the kit is built; it only names the shape of a placed object.
      { path: TYPE_ONLY_FROM_THE_PLAN, typeOnly: true, names: ["PlacedObject"] },
    ].sort((a, b) => a.path.localeCompare(b.path)));
    const read = SOURCES.find((source) => source.path === RESPONSIBLE_FOR_THE_READ);
    expect([...(read?.code.matchAll(/\bgetPublicConfig\s*\(([^)]*)\)/g) ?? [])].map((m) => m[1]?.trim())).toEqual([
      "planId, controller.signal",
    ]);
  });

  it("nothing the kit imports, apart from that one read, leads to a file under api/", () => {
    const reached = new Set<string>();
    const unresolved: string[] = [];
    const visit = (path: string): void => {
      if (reached.has(path)) return;
      reached.add(path);
      for (const imported of importsOf(readSource(path))) {
        const at = landing(path, imported.spec);
        if (at === null || at === "api/configurations" || /\.(?:css|json|svg|png|jpe?g|glb)$/.test(imported.spec)) continue;
        const file = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ending) => `${at}${ending}`).find((candidate) => existsSync(join(SRC, candidate)));
        if (file === undefined) unresolved.push(`${path} imports "${imported.spec}", which was not found`);
        else visit(file);
      }
    };
    for (const path of PATHS) visit(path);
    expect(unresolved).toEqual([]);
    expect([...reached].filter((path) => path.startsWith("api/"))).toEqual([]);
    expect(reached.size).toBeGreaterThan(PATHS.length);
  });
});

describe("the scans catch what they claim to", () => {
  const sample = (code: string, path = "components/guest-list/Sample.tsx"): Source => ({ path, code: blankComments(code, path) });

  it("refuses an error built from data and accepts one made of fixed words", () => {
    expect(errorsAreFixedWords(sample("throw new Error(`bad ${name}`);"))).toHaveLength(1);
    expect(errorsAreFixedWords(sample('throw new TypeError("bad " + name);'))).toHaveLength(1);
    expect(errorsAreFixedWords(sample("reject(new Error(name));"))).toHaveLength(1);
    expect(errorsAreFixedWords(sample("return Promise.reject(error);"))).toHaveLength(1);
    expect(errorsAreFixedWords(sample("throw name;"))).toHaveLength(1);
    expect(errorsAreFixedWords(sample("try { x(); } catch (error) { keep(error); }"))).toHaveLength(1);
    expect(errorsAreFixedWords(sample('throw new Error("storage unavailable");'))).toEqual([]);
    expect(errorsAreFixedWords(sample('const refuse = () => Promise.reject(new Error("storage unavailable"));'))).toEqual([]);
    expect(errorsAreFixedWords(sample("if (isError(x)) { try { y(); } catch { z(); } }"))).toEqual([]);
  });

  it("refuses a text field without both opt-outs, and lets a date, a number and a checkbox go without", () => {
    expect(nameFieldsOptOut(sample('<input value={v} spellCheck={false} autoComplete="off" />'))).toEqual([]);
    expect(nameFieldsOptOut(sample('<textarea value={v} autoComplete="off" spellCheck={false}></textarea>'))).toEqual([]);
    expect(nameFieldsOptOut(sample('<input value={v} autoComplete="off" />'))).toHaveLength(1);
    expect(nameFieldsOptOut(sample("<input value={v} spellCheck={false} />"))).toHaveLength(1);
    expect(nameFieldsOptOut(sample("<textarea value={v} />"))).toHaveLength(2);
    expect(nameFieldsOptOut(sample('<input type="text" value={v} spellCheck={true} autoComplete="off" />'))).toHaveLength(1);
    expect(nameFieldsOptOut(sample('<input value={v} spellCheck={false} autoComplete="name" />'))).toHaveLength(1);
    expect(nameFieldsOptOut(sample("<input {...props} />"))).toHaveLength(1);
    expect(nameFieldsOptOut(sample('<input type="date" value={v} />'))).toEqual([]);
    expect(nameFieldsOptOut(sample('<input type="number" value={v} />'))).toEqual([]);
    expect(nameFieldsOptOut(sample('<input type="checkbox" checked={v} />'))).toEqual([]);
    expect(nameFieldsOptOut(sample("<input type={kind} value={v} />"))).toHaveLength(2);
  });

  it("refuses a log line, a failure report and a way out, and ignores them in comments", () => {
    expect(nothingIsLogged(sample("console.log(x);"))).toHaveLength(1);
    expect(nothingIsLogged(sample("// console.log(x);\n/* console.warn(y) */"))).toEqual([]);
    expect(nothingIsReported(sample("reportFailure(e);"))).toHaveLength(1);
    expect(nothingIsReported(sample("captureWarning(e);"))).toHaveLength(1);
    expect(nothingIsReported(sample("Sentry.captureException(e);")).length).toBeGreaterThan(0);
    expect(nothingGoesOverTheNetwork(sample("await fetch(url);"))).toHaveLength(1);
    expect(nothingGoesOverTheNetwork(sample("new XMLHttpRequest();"))).toHaveLength(1);
    expect(nothingGoesOverTheNetwork(sample("navigator.sendBeacon(u, d);"))).toHaveLength(1);
    expect(nothingGoesOverTheNetwork(sample("new WebSocket(u);"))).toHaveLength(1);
    expect(nothingGoesOverTheNetwork(sample("const prefetch = 1; const refetched = 2;"))).toEqual([]);
  });

  it("refuses web storage outside the switch and any key but the switch's own", () => {
    expect(storageIsKeptToItsPlace(sample("window.localStorage.setItem(KIT_STORAGE_KEY, ON);", KIT_SWITCH))).toEqual([]);
    expect(storageIsKeptToItsPlace(sample("window.localStorage.setItem(`guest-${name}`, ON);", KIT_SWITCH))).toHaveLength(1);
    expect(storageIsKeptToItsPlace(sample("window.sessionStorage.getItem(KIT_STORAGE_KEY);", KIT_SWITCH))).toHaveLength(1);
    expect(storageIsKeptToItsPlace(sample("localStorage.setItem(KIT_STORAGE_KEY, ON);"))).toHaveLength(1);
    expect(storageIsKeptToItsPlace(sample("indexedDB.open(name);"))).toHaveLength(1);
    expect(storageIsKeptToItsPlace(sample("indexedDB.open(name);", DEVICE_STORE))).toEqual([]);
  });

  it("refuses an attribute built from data, and passes the allowed state words", () => {
    expect(attributesAreNotBuiltFromData(sample("<li className={`row ${guest.name}`} />"))).toHaveLength(1);
    expect(attributesAreNotBuiltFromData(sample("<li id={`row-${guest.name}`} />"))).toHaveLength(1);
    expect(attributesAreNotBuiltFromData(sample("<li data-who={`w-${name}`} />"))).toHaveLength(1);
    expect(attributesAreNotBuiltFromData(sample('<li className={"row " + name} />'))).toHaveLength(1);
    expect(attributesAreNotBuiltFromData(sample("<li aria-labelledby={`${name}-x`} />"))).toHaveLength(1);
    const listPage = "pages/GuestListPage.tsx";
    expect(attributesAreNotBuiltFromData(sample("<li id={`${id}-name`} htmlFor={`${id}-${count.view}-label`} />", listPage))).toEqual([]);
    expect(attributesAreNotBuiltFromData(sample("<li id={open ? `${id}-detail` : undefined} />", listPage))).toEqual([]);
    // An allowance holds only in the files it names: the same words in another file are refused.
    expect(attributesAreNotBuiltFromData(sample("<li id={`${id}-${count.view}`} />"))).toHaveLength(2);
    expect(attributesAreNotBuiltFromData(sample('<li className="row" data-tone="copper" />'))).toEqual([]);
    expect(attributesAreNotBuiltFromData(sample("<li>{`Hello ${guest.name}`}</li>"))).toEqual([]);
  });

  it("refuses an address built from data", () => {
    expect(addressesAreNotBuiltFromData(sample("`/plan/${planId}/guests?q=${guest.name}`"))).toHaveLength(1);
    expect(addressesAreNotBuiltFromData(sample("`/plan/${planId}/guests/paper?${params.toString()}`", "pages/GuestPaperPage.tsx"))).toEqual([]);
  });

  it("refuses an import that reaches the API client in any relative form, and one that is not the page's", () => {
    const at = (path: string, code: string): string[] => importsAreOnlyWhatIsAllowed(sample(code, path));
    expect(at("pages/GuestListPage.tsx", 'import { api } from "../api/client.js";')).toHaveLength(1);
    expect(at("components/guest-list/GuestPanel.tsx", 'import { api } from "../../api/client";')).toHaveLength(1);
    expect(at("lib/guest-list/store.ts", 'import { api } from "../../api/client.js";')).toHaveLength(1);
    expect(at("lib/guest-list/store.ts", 'export { api } from "../../api/client.js";')).toHaveLength(1);
    expect(at("lib/guest-list/store.ts", 'const later = import("../../api/client.js");')).toHaveLength(1);
    expect(at("pages/GuestPaperPage.tsx", 'import { getPublicConfig } from "../api/configurations.js";')).toHaveLength(1);
    expect(at("pages/GuestListPage.tsx", 'import { updatePublicThumbnail } from "../api/configurations.js";')).toEqual([]);
    expect(at("pages/GuestListPage.tsx", 'import { getPublicConfig } from "../api/configurations.js";')).toEqual([]);
    expect(at("pages/GuestListPage.tsx", 'import type { Configuration } from "../api/auth.js";')).toHaveLength(1);
    expect(at("lib/guest-list/plan-tables.ts", 'import type { PlacedObject } from "../../api/configurations.js";')).toEqual([]);
    expect(at("lib/guest-list/plan-tables.ts", 'import { getPublicConfig } from "../../api/configurations.js";')).toHaveLength(1);
    expect(at("lib/guest-list/other.ts", 'import type { PlacedObject } from "../../api/configurations.js";')).toHaveLength(1);
    expect(at("lib/guest-list/other.ts", 'import axios from "axios";')).toHaveLength(1);
    expect(at("lib/guest-list/other.ts", 'import { useState } from "react";')).toEqual([]);
  });

  // Fix round 1, I1: an attribute is built from data in its simplest form too, a bare name or a helper's answer.
  it("refuses a class, id, name or data attribute that is a bare expression or a helper's answer", () => {
    for (const code of [
      "<li className={guest.name} />",
      "<li data-name={guest.name} />",
      "<li id={guest.name} />",
      "<li className={cx('row', guest.name)} />",
      "<li className={['row', name].join(' ')} />",
      "<li htmlFor={guest.name} />",
      "<input name={guest.name} />",
      "<li aria-owns={guest.name} />",
      "<li aria-activedescendant={guest.name} />",
      "<li data-who={`w-${guest.name}`} />",
      // The same mistake made on an element built in code.
      "element.className = guest.name;",
      "element.id = `row-${guest.name}`;",
      "element.dataset.who = guest.name;",
      'element.setAttribute("data-who", guest.name);',
      'element.setAttribute("class", guest.name);',
      "element.setAttribute(attribute, value);",
      "element.classList.add(guest.name);",
    ]) {
      expect(attributesAreNotBuiltFromData(sample(code)), code).not.toEqual([]);
    }
    // Spread onto a DOM element can carry any attribute; onto a component it is only props.
    expect(attributesAreNotBuiltFromData(sample("<li {...guest} />")), "spread on li").not.toEqual([]);
    expect(attributesAreNotBuiltFromData(sample("<TableRow {...props} />")), "spread on a component").toEqual([]);
  });

  it("lets the attribute forms the kit uses pass, and leaves out the attributes that are read as text", () => {
    for (const code of [
      '<li className="row" data-tone="copper" id="x" />',
      "<li id={`${id}-detail`} htmlFor={`${id}-name`} aria-describedby={refused ? `${id}-refused` : undefined} />",
      "<li aria-controls={open ? `${id}-detail` : undefined} />",
      // The text-like attributes carry a guest's name on purpose: it is what a reader is meant to read.
      "<button aria-label={guest.name} title={guest.name} />",
      '<img alt={guest.name} /><input placeholder={guest.name} value={guest.name} />',
      // key is React's own and never reaches the DOM.
      "<li key={guest.id} />",
      // A condition picks a value and is never the value.
      '<li data-none={entry.seat === null ? "true" : undefined} data-open={open && "true"} />',
      // Elements built in code from fixed words.
      'robots.name = "robots"; robots.content = guest.name; link.download = "guest-list.csv"; link.href = url;',
      'element.setAttribute("title", guest.name); element.classList.add("row");',
    ]) {
      expect(attributesAreNotBuiltFromData(sample(code, "components/guest-list/GuestRows.tsx")), code).toEqual([]);
    }
  });

  // Fix round 1, I2: the ordinary ways out, and addresses built outside /plan.
  it("refuses every way of calling fetch, of moving the page, of loading a picture and of writing an address", () => {
    for (const code of [
      "window.fetch(url)",
      "globalThis.fetch(url)",
      "const send = fetch; send(url)",
      "window.location = url",
      "document.location = url",
      "location = url",
      "location.href = url",
      "location.assign(url)",
      "new Image().src = url",
      "img.src = url",
      "const link = `mailto:?body=${name}`",
      "navigate(`?q=${name}`)",
      "const go = useNavigate()",
      "setSearchParams({ q: name })",
      "new URL(address)",
    ]) {
      expect(nothingGoesOverTheNetwork(sample(code)), code).not.toEqual([]);
    }
    for (const code of [
      "const prefetch = 1; const refetched = 2;",
      "const location = useLocation();",
      "const { search } = useLocation(); if (location.pathname === x) {}",
      "document.title = title;",
    ]) {
      expect(nothingGoesOverTheNetwork(sample(code)), code).toEqual([]);
    }
  });

  it("refuses an address built from data in any attribute that holds one, and any template that looks like one", () => {
    for (const code of [
      "<a href={`mailto:?body=${name}`} />",
      "<Link to={`?q=${guest.name}`} />",
      "<Link to={`${base}?q=${guest.name}`} />",
      "<a href={guest.name} />",
      "<form action={target} />",
      "<img src={`/pic/${guest.name}`} />",
      "const where = `/elsewhere/${guest.name}`;",
      "const where = `?q=${guest.name}`;",
      "const where = `https://example.com/${guest.name}`;",
      "params.set(KIT_PARAM, guest.name);",
      "new URLSearchParams(guest.name)",
    ]) {
      expect(addressesAreNotBuiltFromData(sample(code)), code).not.toEqual([]);
    }
    for (const code of [
      '<Link to="/plan">Open</Link>',
      "<Link to={`/plan/${planId}`}>Open</Link>",
      "<Link to={sheetAddress(planId, search, entry.sheet)}>Sheet</Link>",
      "return `/plan/${planId}/guests/paper?${params.toString()}`;",
      'params.set(KIT_PARAM, "on"); params.set(SHEET_PARAM, sheet);',
      "const params = new URLSearchParams(search);",
      "<Link to={open ? listAddress(planId) : sheetAddress(planId, search, sheet)}>Back</Link>",
    ]) {
      expect(addressesAreNotBuiltFromData(sample(code, "pages/GuestPaperPage.tsx")), code).toEqual([]);
    }
    expect(addressesAreNotBuiltFromData(sample('<Link to={paperAddress(planId, "table-plan")}>Print</Link>', "components/guest-list/GuestPanel.tsx"))).toEqual([]);
    // An address helper is allowed in the file that has it, and nowhere else.
    expect(addressesAreNotBuiltFromData(sample('<Link to={paperAddress(planId, "table-plan")}>Print</Link>', "pages/GuestPaperPage.tsx"))).toHaveLength(1);
  });

  // Fix round 1, I3: comments are found by the TypeScript parser, so live code is never blanked.
  it("blanks real comments only, and never live code after a look-alike", () => {
    const jsdoc = '<input accept="text/*" />;\nconsole.log(name);\n/** a later doc comment */';
    const inString = 'const s = "a // b"; console.log(name);';
    const insideComment = "// note: /* open\nconsole.log(name);\n/* later */";
    const inText = "<p>see // there</p>; console.log(name);";
    const inTextTwo = "<p>a /* b */ c</p>; console.log(name);";
    const inTemplate = "const t = `x // y ${1}`; console.log(name);";
    const inRegex = "const r = /a\\/*b/; console.log(name);";
    for (const code of [jsdoc, inString, insideComment, inText, inTextTwo, inTemplate, inRegex]) {
      expect(nothingIsLogged(sample(code)), code).toHaveLength(1);
    }
    // Real comments of every shape are blanked, and lines and offsets stay where they were.
    const commented = "/* console.log(1) */ // console.warn(2)\n{/* console.log(3) */}\n/** console.log(4) */\nlet a = 1; // console.log(5)\n";
    expect(nothingIsLogged(sample(commented))).toEqual([]);
    expect(blankComments(commented, "x.tsx")).toHaveLength(commented.length);
    expect(blankComments(commented, "x.tsx").split("\n")).toHaveLength(commented.split("\n").length);
    expect(blankComments(commented, "x.tsx")).toContain("let a = 1;");
  });

  it("keeps every line and every token of every kit file, and takes out only comments", () => {
    for (const path of PATHS) {
      const original = readFileSync(join(SRC, path), "utf8");
      const stripped = blankComments(original, path);
      expect(stripped.length, `${path} keeps its length`).toBe(original.length);
      expect(stripped.split("\n").length, `${path} keeps its lines`).toBe(original.split("\n").length);
      expect(tokensOf(stripped, path), `${path} keeps all its tokens`).toEqual(tokensOf(original, path));
    }
  });
});

// ---------------------------------------------------------------------------
// The canary journey
// ---------------------------------------------------------------------------

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLAN = uuid(1);
const TABLE_A = uuid(101);
const TABLE_B = uuid(102);
const NOW = "2026-11-14T10:00:00.000Z";

const PASTE = ["Name\tParty", `${CANARY}\tThe Canaries`, "Ailsa Fraser\tThe Canaries", "Bram Stoker\tStokers"].join("\n");

/** Where a canary appears in a value, as paths like "groups[0].entries[0].label". */
function canaryPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") return value.includes(CANARY) ? [path === "" ? "(the value itself)" : path] : [];
  if (Array.isArray(value)) return value.flatMap((item: unknown, at) => canaryPaths(item, `${path}[${String(at)}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      key.includes(CANARY) ? [`${path}.${key}`] : canaryPaths(item, path === "" ? key : `${path}.${key}`),
    );
  }
  return [];
}

function carriesCanary(value: unknown): boolean {
  return canaryPaths(value).length > 0;
}

function noThrow<T>(run: () => T): T {
  try {
    return run();
  } catch (thrown) {
    return expect.unreachable(`something threw: ${carriesCanary(thrown) || String(thrown).includes(CANARY) ? "(and it carried the canary)" : "(without the canary)"}`);
  }
}

async function noReject<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (thrown) {
    return expect.unreachable(`something rejected: ${String(thrown).includes(CANARY) ? "(and it carried the canary)" : "(without the canary)"}`);
  }
}

/** Storage that refuses every call, with a message that carries the canary: the store must not pass it on. */
function refusingBackend(): CacheBackend {
  const refuse = (): Promise<never> => Promise.reject(new Error(`storage refused ${CANARY}`));
  return { get: refuse, put: refuse, delete: refuse, list: refuse };
}

function pickFrom(parsed: ReturnType<typeof parsePaste>): ColumnPick {
  return {
    nameColumn: parsed.nameColumn,
    secondNameColumn: parsed.secondNameColumn,
    secondFirst: false,
    partyColumn: parsed.partyColumn,
  };
}

function guestNamed(list: GuestList, name: string): GuestList["guests"][number] {
  const guest = list.guests.find((entry) => entry.name === name);
  return guest ?? expect.unreachable("the guest was not on the list");
}

afterEach(() => {
  useGuestListStore.getState().reset();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "sendBeacon");
});

describe("a canary name through the kit", () => {
  it("is taken from a paste and added to the list, and refused names leave no trace", () => {
    const parsed = noThrow(() => parsePaste(PASTE));
    expect(parsed.hadHeader).toBe(true);
    const taken = noThrow(() => takeNames(parsed, pickFrom(parsed), GUESTS_MAX));
    expect(taken.guests.map((guest) => guest.name)).toEqual([CANARY, "Ailsa Fraser", "Bram Stoker"]);
    expect(canaryPaths(taken)).toEqual(["guests[0].name"]);

    // Over the name limit: refused and counted, and the result holds only counts.
    const long = parsePaste(`${CANARY} ${"x".repeat(80)}`);
    const refused = noThrow(() => takeNames(long, pickFrom(long), GUESTS_MAX));
    expect(refused.skipped).toEqual({ blank: 0, tooLong: 1, overLimit: 0 });
    expect(refused.guests).toEqual([]);
    expect(carriesCanary(refused)).toBe(false);
    // No room left: counted, not kept.
    const noRoom = noThrow(() => takeNames(parsed, pickFrom(parsed), 0));
    expect(noRoom.skipped.overLimit).toBe(3);
    expect(carriesCanary(noRoom)).toBe(false);
    // The words the page shows about a paste never carry a name.
    expect(carriesCanary([foundWords(taken.guests.length, taken.droppedColumns), leftOutWords(refused.skipped), leftOutWords(noRoom.skipped)])).toBe(false);

    const list = noThrow(() => addGuests(emptyGuestList(PLAN, NOW), taken.guests, [uuid(201), uuid(202), uuid(203)]));
    expect(canaryPaths(list)).toEqual(["guests[0].name"]);
    // A name over the limit is ignored by addGuests, silently, with nothing to carry it.
    const ignored = noThrow(() => addGuests(emptyGuestList(PLAN, NOW), [{ name: `${CANARY} ${"x".repeat(80)}`, party: "" }], [uuid(204)]));
    expect(ignored.guests).toEqual([]);
  });

  it("is seated, refused a seat, and printed, and appears only where it belongs", () => {
    const fetchSpy = vi.fn();
    const requestSpy = vi.fn();
    const socketSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", requestSpy);
    vi.stubGlobal("WebSocket", socketSpy);
    Object.defineProperty(navigator, "sendBeacon", { value: beaconSpy, configurable: true, writable: true });

    const parsed = parsePaste(PASTE);
    const taken = takeNames(parsed, pickFrom(parsed), GUESTS_MAX);
    const added = noThrow(() => addGuests(emptyGuestList(PLAN, NOW), taken.guests, [uuid(201), uuid(202), uuid(203)]));
    const tabled = noThrow(() => setTables(added, 2, 2, [TABLE_A, TABLE_B]));
    expect(tabled.tables).toHaveLength(2);
    const seated = noThrow(() => seatEveryone(tabled));
    expect(summary(seated)).toEqual({ guests: 3, seated: 3, toSeat: 0, tables: 2, freeSeats: 1 });
    expect(canaryPaths(seated)).toEqual(["guests[0].name"]);
    const canaryGuest = guestNamed(seated, CANARY);
    const neighbour = guestNamed(seated, "Ailsa Fraser");

    // Every refusal is a fixed word, never the guest's text.
    const refusals = [
      noThrow(() => moveGuest(seated, uuid(999), TABLE_A)),
      noThrow(() => moveGuest(seated, canaryGuest.id, uuid(998))),
      noThrow(() => moveGuest(seated, canaryGuest.id, neighbour.tableId, neighbour.seat ?? undefined)),
      noThrow(() => moveGuest(seated, canaryGuest.id, neighbour.tableId, 99)),
      noThrow(() => renameGuest(seated, canaryGuest.id, `${CANARY} ${"x".repeat(80)}`, "")),
      noThrow(() => renameGuest(seated, canaryGuest.id, "   ", "")),
    ];
    const full = noThrow(() => seatEveryone(setTables(addGuests(emptyGuestList(PLAN, NOW), [{ name: CANARY, party: "" }, { name: "Other", party: "" }], [uuid(301), uuid(302)]), 1, 1, [TABLE_A])));
    refusals.push(noThrow(() => moveGuest(full, full.guests.find((guest) => guest.tableId === null)?.id ?? "", TABLE_A)));
    expect(refusals).toEqual([
      { refused: "no-such-guest" },
      { refused: "no-such-table" },
      { refused: "seat-taken" },
      { refused: "seat-taken" },
      { refused: "name" },
      { refused: "name" },
      { refused: "table-full" },
    ]);
    expect(carriesCanary(refusals)).toBe(false);

    // Taking a table away sends its guests back to "to seat", and says nothing of who they are.
    const removed = noThrow(() => removeTable(seated, TABLE_A));
    expect(canaryPaths(removed)).toEqual(["guests[0].name"]);
    expect(noThrow(() => repairGuestList(removed)).unseated).toBe(0);

    // The paper: the name is in the name fields, and nowhere else.
    const plan = noThrow(() => tablePlanAZ(seated));
    expect(canaryPaths(plan)).toHaveLength(1);
    expect(canaryPaths(plan)[0]).toMatch(/^groups\[\d+\]\.entries\[\d+\]\.label$/);
    expect(plan.notSeated).toBe(0);
    const tables = noThrow(() => byTable(seated));
    expect(canaryPaths(tables)).toHaveLength(1);
    expect(canaryPaths(tables)[0]).toMatch(/^\[\d+\]\.guests\[\d+\]\.name$/);
    const cards = noThrow(() => placeCards(seated));
    expect(canaryPaths(cards)).toHaveLength(1);
    expect(canaryPaths(cards)[0]).toMatch(/^\[\d+\]\.name$/);
    // Covers are counts of seats, and carry no name at all.
    const counts = noThrow(() => covers(seated));
    expect(counts.total).toBe(3);
    expect(carriesCanary(counts)).toBe(false);
    for (const other of seated.guests) expect(JSON.stringify(counts)).not.toContain(other.name);
    // A printed list changes only its own counters.
    const printed = noThrow(() => markPrinted(seated, NOW));
    expect(canaryPaths(printed)).toEqual(["guests[0].name"]);

    // The download: the name is in one row, in the first cell.
    const csv = noThrow(() => toCsv(seated));
    const rows = csv.split("\r\n").filter((row) => row.includes(CANARY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startsWith(`"${CANARY}",`)).toBe(true);

    // The words on the page are made from counts.
    const words = [seatedSentence(3, 3), toSeatSentence(0), keepingLine(seated)];
    expect(carriesCanary(words)).toBe(false);

    // Nothing was sent anywhere along the way.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it("is kept by a device store whose storage refuses every call, and no refusal passes its message on", async () => {
    const parsed = parsePaste(PASTE);
    const list = seatEveryone(setTables(addGuests(emptyGuestList(PLAN, NOW), takeNames(parsed, pickFrom(parsed), GUESTS_MAX).guests, [uuid(201), uuid(202), uuid(203)]), 2, 2, [TABLE_A, TABLE_B]));
    const store = createGuestListStore(withBackend<unknown>(refusingBackend()));

    await noReject(() => store.erase(PLAN));
    const answers = {
      opened: await noReject(() => store.open(PLAN)),
      saved: await noReject(() => store.save(list, null)),
      swept: await noReject(() => store.sweep(Date.now())),
    };
    expect(answers).toEqual({ opened: { kind: "not-kept" }, saved: "not-kept", swept: 0 });
    expect(carriesCanary(answers)).toBe(false);
  });

  it("is not echoed back when what is stored is not a list", async () => {
    const parsed = parsePaste(PASTE);
    const list = addGuests(emptyGuestList(PLAN, NOW), takeNames(parsed, pickFrom(parsed), GUESTS_MAX).guests, [uuid(201), uuid(202), uuid(203)]);
    const [first, ...rest] = list.guests;
    expect(first).toBeDefined();
    const backend = memoryBackend();
    const handle = withBackend<unknown>(backend);
    const store = createGuestListStore(handle);

    // Not a list at all, and a list whose guest carries a field a guest may not have.
    for (const stored of [{ notes: CANARY }, { ...list, guests: [{ ...first, email: CANARY }, ...rest] }]) {
      await handle.put(PLAN, stored);
      const opened = await noReject(() => store.open(PLAN));
      expect(opened).toEqual({ kind: "unreadable" });
      expect(carriesCanary(opened)).toBe(false);
    }
  });

  it("goes through the page's store without reaching its state, its notice or its kept flag", async () => {
    const parsed = parsePaste(PASTE);
    const taken = takeNames(parsed, pickFrom(parsed), GUESTS_MAX);
    const store = createGuestListStore(withBackend<unknown>(refusingBackend()));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await noReject(() => useGuestListStore.getState().open(PLAN, store, () => NOW));
    useGuestListStore.getState().apply((current) => addGuests(current, taken.guests, [uuid(201), uuid(202), uuid(203)]));
    await noReject(() => useGuestListStore.getState().flush());

    const state = useGuestListStore.getState();
    expect(state.kept).toBe(false);
    expect(state.phase).toBe("ready");
    expect(canaryPaths(state.list)).toEqual(["guests[0].name"]);
    expect(carriesCanary({ planId: state.planId, phase: state.phase, kept: state.kept, notice: state.notice, canUndo: state.canUndo })).toBe(false);

    await noReject(() => useGuestListStore.getState().eraseList());
    expect(carriesCanary(useGuestListStore.getState().list)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
