import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

/** Comments out; lines and offsets kept. Strings are not touched (`//` after a colon is a URL, not a comment). */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<=^|\s)\/\/[^\n]*/gm, blank);
}

function readSource(path: string): Source {
  return { path, code: blankComments(readFileSync(join(SRC, path), "utf8")) };
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

/** The text of each `${...}` in a template literal (backticks included in `literal`). */
function interpolations(literal: string): string[] {
  const found: string[] = [];
  let i = 1;
  while (i < literal.length - 1) {
    if (literal.charAt(i) === "\\") {
      i += 2;
    } else if (literal.charAt(i) === "$" && literal.charAt(i + 1) === "{") {
      const close = endOfBracket(literal, i + 1);
      found.push(literal.slice(i + 2, close).trim());
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/** The interpolations of every template literal in an expression, and whether it joins pieces with `+`. */
function inspectExpression(expression: string): { readonly interpolated: readonly string[]; readonly joins: boolean } {
  const interpolated: string[] = [];
  let joins = false;
  let i = 0;
  while (i < expression.length) {
    const c = expression.charAt(i);
    if (c === "`") {
      const end = endOfLiteral(expression, i);
      interpolated.push(...interpolations(expression.slice(i, end)));
      i = end;
    } else if (c === '"' || c === "'") {
      i = endOfLiteral(expression, i);
    } else {
      if (c === "+") joins = true;
      i += 1;
    }
  }
  return { interpolated, joins };
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

const nothingGoesOverTheNetwork: Scan = (source) =>
  matches(
    source,
    /(?<![\w.])fetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bwindow\s*\.\s*open\b|\blocation\s*\.\s*(?:assign|replace)\b|\blocation\s*\.\s*href\s*=|\b(?:pushState|replaceState)\b/g,
    "a way to send something out",
  );

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

/** What an attribute built from data may contain, and why that is not a guest's text. */
const ALLOWED_IN_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["id", "React's useId value, an opaque string React makes; the suffix beside it is fixed words"],
  ["String(at)", "the position of a letter group in the list, a number, in an id"],
  ["count.view", "one of the list page's four fixed view words, in an id"],
]);

const ATTRIBUTE = /(?<![\w-])(className|id|htmlFor|data-[\w-]+|aria-labelledby|aria-describedby|aria-controls)\s*=\s*\{/g;

/** Every `${...}` in an attribute the allowance list let through, counted, so a stale allowance is seen. */
function attributeInterpolations(source: Source): { readonly attribute: string; readonly expression: string; readonly index: number }[] {
  const out: { attribute: string; expression: string; index: number }[] = [];
  for (const m of source.code.matchAll(ATTRIBUTE)) {
    const open = m.index + m[0].length - 1;
    const { interpolated } = inspectExpression(source.code.slice(open + 1, endOfBracket(source.code, open)));
    for (const expression of interpolated) out.push({ attribute: m[1] ?? "", expression, index: m.index });
  }
  return out;
}

const attributesAreNotBuiltFromData: Scan = (source) => {
  const out: string[] = [];
  for (const m of source.code.matchAll(ATTRIBUTE)) {
    const open = m.index + m[0].length - 1;
    const { interpolated, joins } = inspectExpression(source.code.slice(open + 1, endOfBracket(source.code, open)));
    if (joins) out.push(found(source, m.index, `${m[1] ?? "an attribute"} joins text with +`));
    for (const expression of interpolated) {
      if (!ALLOWED_IN_ATTRIBUTES.has(expression)) {
        out.push(found(source, m.index, `${m[1] ?? "an attribute"} is built from \${${expression}}`));
      }
    }
  }
  return out;
};

/** What an address built here may carry, and why that is not a guest's text. */
const ALLOWED_IN_ADDRESSES: ReadonlyMap<string, string> = new Map([
  ["planId", "the plan's own id, from the address the planner is already on"],
  ["sheet", "one of the four fixed sheet words"],
  ["params.toString()", "the address's own query with only the kit switch and the sheet word set"],
  ["KIT_PARAM", "the fixed word kit"],
]);

function addressInterpolations(source: Source): { readonly expression: string; readonly index: number }[] {
  const out: { expression: string; index: number }[] = [];
  let from = source.code.indexOf("`/plan");
  while (from !== -1) {
    const literal = source.code.slice(from, endOfLiteral(source.code, from));
    for (const expression of interpolations(literal)) out.push({ expression, index: from });
    from = source.code.indexOf("`/plan", from + 1);
  }
  return out;
}

const addressesAreNotBuiltFromData: Scan = (source) =>
  addressInterpolations(source)
    .filter(({ expression }) => !ALLOWED_IN_ADDRESSES.has(expression))
    .map(({ expression, index }) => found(source, index, `an address is built from \${${expression}}`));

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

  it("every allowance for attributes is still used, so none has gone stale", () => {
    const used = new Set(SOURCES.flatMap((source) => attributeInterpolations(source).map(({ expression }) => expression)));
    expect([...ALLOWED_IN_ATTRIBUTES.keys()].filter((expression) => !used.has(expression))).toEqual([]);
  });

  it("no address is built from data, apart from the plan's id, the sheet word and the address's own query", () => {
    expect(scanAll(addressesAreNotBuiltFromData)).toEqual([]);
  });

  it("every allowance for addresses is still used, so none has gone stale", () => {
    const used = new Set(SOURCES.flatMap((source) => addressInterpolations(source).map(({ expression }) => expression)));
    expect([...ALLOWED_IN_ADDRESSES.keys()].filter((expression) => !used.has(expression))).toEqual([]);
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
  const sample = (code: string, path = "components/guest-list/Sample.tsx"): Source => ({ path, code: blankComments(code) });

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
    expect(attributesAreNotBuiltFromData(sample("<li id={`${id}-name`} htmlFor={`${id}-${count.view}-label`} />"))).toEqual([]);
    expect(attributesAreNotBuiltFromData(sample("<li id={open ? `${id}-detail` : undefined} />"))).toEqual([]);
    expect(attributesAreNotBuiltFromData(sample('<li className="row" data-tone="copper" />'))).toEqual([]);
    expect(attributesAreNotBuiltFromData(sample("<li>{`Hello ${guest.name}`}</li>"))).toEqual([]);
  });

  it("refuses an address built from data", () => {
    expect(addressesAreNotBuiltFromData(sample("`/plan/${planId}/guests?q=${guest.name}`"))).toHaveLength(1);
    expect(addressesAreNotBuiltFromData(sample("`/plan/${planId}/guests/paper?${params.toString()}`"))).toEqual([]);
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
