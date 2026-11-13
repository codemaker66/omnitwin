import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The house rules for the planner's chrome (T-671, slice 1 of the final
// direction Blake chose on 20 Oct 2026).
//
// Everything under components/planner-chrome/ is the new chrome, and it is
// held to the design's own laws from its first file: Newsreader and Inter
// only, eight type sizes, five radii, no blur or filter (the cockpit shell
// forbids both as a GPU guard), no !important, no colour typed by hand (every
// colour is a var(--house-*) token, alpha steps derived from it), no inline
// style in JSX (F-59), and none of the retired or engineering words in what a
// person reads (spec section 13). The house-wide guards in
// src/__tests__/house-tokens.test.ts (the gold band, the 11px floor) already
// cover this folder too.
//
// Each rule is a function over source text, so it is proved against a sample
// that breaks it before it is trusted to find nothing in the folder.
// ---------------------------------------------------------------------------

const FOLDER = resolve("src/components/planner-chrome");

/** The type scale (spec 7.1): one display size, seven working sizes. */
const TYPE_SIZES_PX = new Set([11, 12, 14, 16, 20, 28, 48, 72]);

/** The radii (spec 7.3): key, tile and field well, surface, phone sheet, pill. */
const RADII_PX = new Set([0, 4, 6, 10, 16, 999]);
const RADIUS_TOKENS = new Set(["--house-radius-key", "--house-radius-surface", "--house-radius-pill"]);

/** The two faces, by token; `inherit` lets a control take its parent's. */
const FAMILY_VALUES = new Set(["var(--house-serif)", "var(--house-sans)", "inherit"]);

/**
 * What a person must never read in the planner (spec section 13, rules 1 and
 * 4): the retired names, the engineering words and the cheerleading.
 */
const RETIRED_COPY: readonly (readonly [RegExp, string])[] = [
  [/\bAuto-fill\b/i, "Auto-fill is Lay out"],
  [/\bLaser\b/i, "Laser is Draw"],
  [/\bShowcase\b/i, "Showcase is Present"],
  [/\bsplats?\b/i, "splat is an engineering word"],
  [/\bX \(m\)/, "X (m) is an engineering label; name the wall"],
  [/\bPlanner Note\b/i, "Planner Note is the note for the hallkeeper"],
  [/\bGreat\b/, "no praise"],
  [/\bAlmost there\b/i, "no cheerleading"],
  [/\bGot it\b/i, "no cheerleading"],
];

interface RuleHit {
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

/** Block comments blanked out, newlines kept, so line numbers survive. */
function blankBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Line comments blanked out too (TS/TSX only: `//` is not a comment in CSS). */
function blankLineComments(source: string): string {
  return source.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_match, lead: string) => lead);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function hitsOf(source: string, pattern: RegExp, rule: string): RuleHit[] {
  const out: RuleHit[] = [];
  for (const match of source.matchAll(pattern)) {
    out.push({ line: lineOf(source, match.index), rule, text: match[0].trim() });
  }
  return out;
}

/**
 * Every `#` token that is a colour: only hex digits, three, four, six or eight
 * of them. An anchor such as `#main-content` is a word, not a colour.
 */
function hexColours(text: string): readonly (readonly [string, number])[] {
  const out: (readonly [string, number])[] = [];
  for (const match of text.matchAll(/#([\w-]+)/g)) {
    const token = match[1] ?? "";
    if (/^[0-9a-f]+$/i.test(token) && [3, 4, 6, 8].includes(token.length)) out.push([match[0], match.index]);
  }
  return out;
}

/** Selectors blanked out, so `button:hover {` is never read as a declaration. */
function ruleBodies(css: string): string {
  return css.replace(/[^{}]*\{/g, (head) => head.replace(/[^\n{]/g, " "));
}

/** The declarations of a stylesheet (selectors already blanked) as [property, value, index]. */
function declarations(bodies: string): readonly (readonly [string, string, number])[] {
  const out: (readonly [string, string, number])[] = [];
  for (const match of bodies.matchAll(/(^|[;{\s])(-?-?[a-z][a-z0-9-]*)\s*:\s*([^;{}]+?)\s*(?=;|\})/gi)) {
    out.push([(match[2] ?? "").toLowerCase(), match[3] ?? "", match.index + (match[1] ?? "").length]);
  }
  return out;
}

function cssViolations(source: string): RuleHit[] {
  const css = blankBlockComments(source);
  const hits: RuleHit[] = [];
  const flag = (index: number, rule: string, text: string): void => {
    hits.push({ line: lineOf(css, index), rule, text });
  };

  const bodies = ruleBodies(css);
  for (const [property, value, index] of declarations(bodies)) {
    const text = `${property}: ${value}`;
    if (property === "font-family" && !FAMILY_VALUES.has(value)) {
      flag(index, "font-family is var(--house-serif) or var(--house-sans)", text);
    }
    if (property === "font" && value !== "inherit") {
      if (/(var\(--house-(?:serif|sans)\)|inherit)\s*$/.exec(value) === null) {
        flag(index, "the font shorthand ends in var(--house-serif) or var(--house-sans)", text);
      }
      const size = /(?:^|\s)([0-9.]+)(px|rem|em|%)(?:\/|\s)/.exec(`${value} `);
      if (size === null || size[2] !== "px" || !TYPE_SIZES_PX.has(Number(size[1]))) {
        flag(index, "type sizes are 11, 12, 14, 16, 20, 28, 48 or 72 px", text);
      }
    }
    if (property === "font-size" && value !== "inherit") {
      const size = /^([0-9.]+)px$/.exec(value);
      if (size === null || !TYPE_SIZES_PX.has(Number(size[1]))) {
        flag(index, "type sizes are 11, 12, 14, 16, 20, 28, 48 or 72 px", text);
      }
    }
    if (/^border(-[a-z]+)*-radius$/.test(property)) {
      for (const part of value.split(/\s+/).filter((piece) => piece !== "/")) {
        const token = /^var\((--house-radius-[a-z]+)\)$/.exec(part);
        if (token !== null && RADIUS_TOKENS.has(token[1] ?? "")) continue;
        const px = /^([0-9.]+)(px)?$/.exec(part);
        if (px !== null && RADII_PX.has(Number(px[1]))) continue;
        flag(index, "radii are 4, 6, 10, 16 or 999 px", text);
        break;
      }
    }
    if (property === "backdrop-filter" || property === "-webkit-backdrop-filter") {
      flag(index, "no backdrop-filter: the shell forbids blur over the room", text);
    }
    if (property === "filter") flag(index, "no CSS filter: the shell forbids it over the room", text);
  }

  hits.push(...hitsOf(css, /!important/g, "no !important"));
  for (const [colour, index] of hexColours(bodies)) flag(index, "no colour typed by hand: use a var(--house-*) token", colour);
  hits.push(...hitsOf(bodies, /\b(?:rgba?|hsla?)\(\s*[0-9.]+/gi, "no colour typed by hand: derive alpha from a token"));
  return hits.sort((a, b) => a.line - b.line);
}

/** Every string literal and JSX text run in a TS/TSX source, with its index. */
function readableText(code: string): readonly (readonly [string, number])[] {
  const out: (readonly [string, number])[] = [];
  for (const match of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    out.push([match[1] ?? match[2] ?? match[3] ?? "", match.index]);
  }
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    if ((match[1] ?? "").trim() !== "") out.push([match[1] ?? "", match.index]);
  }
  return out;
}

function scriptViolations(source: string, path: string): RuleHit[] {
  // Module paths are not copy: an import names a file, not a feature.
  const code = blankLineComments(blankBlockComments(source))
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gmu, (statement) => statement.replace(/[^\n]/gu, " "));
  const hits: RuleHit[] = [];
  if (path.endsWith(".tsx")) {
    hits.push(...hitsOf(code, /\sstyle=\{/g, "no inline style in JSX (F-59): use a class, or write a per-frame value through a ref"));
    hits.push(...hitsOf(code, /<(?:filter|feGaussianBlur)\b|\sfilter=["{]/g, "no SVG filter or blur"));
  }
  for (const [text, index] of readableText(code)) {
    if (hexColours(text).length > 0) {
      hits.push({ line: lineOf(code, index), rule: "no colour typed by hand: use a var(--house-*) token", text });
    }
    if (/\b(?:rgba?|hsla?)\(\s*[0-9.]+/i.test(text)) {
      hits.push({ line: lineOf(code, index), rule: "no colour typed by hand: derive alpha from a token", text });
    }
    for (const [pattern, reason] of RETIRED_COPY) {
      if (pattern.test(text)) hits.push({ line: lineOf(code, index), rule: `copy: ${reason}`, text });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

async function chromeSources(): Promise<readonly (readonly [string, string])[]> {
  const out: (readonly [string, string])[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") await walk(full);
      } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
        out.push([full.slice(FOLDER.length + 1).replaceAll("\\", "/"), await readFile(full, "utf-8")]);
      }
    }
  }
  await walk(FOLDER);
  return out;
}

describe("the planner chrome's house rules catch what they forbid", () => {
  it("flags a third face, a size off the scale and a radius off the set", () => {
    const rules = cssViolations(`.a { font-family: Georgia, serif; font-size: 13px; border-radius: 12px; }`).map((hit) => hit.rule);
    expect(rules).toContain("font-family is var(--house-serif) or var(--house-sans)");
    expect(rules).toContain("type sizes are 11, 12, 14, 16, 20, 28, 48 or 72 px");
    expect(rules).toContain("radii are 4, 6, 10, 16 or 999 px");
  });

  it("flags the font shorthand by its size and by its family", () => {
    expect(cssViolations(`.a { font: 600 13px/1.2 var(--house-sans); }`).map((hit) => hit.rule))
      .toEqual(["type sizes are 11, 12, 14, 16, 20, 28, 48 or 72 px"]);
    expect(cssViolations(`.a { font: 600 12px/1.2 "Fraunces", serif; }`).map((hit) => hit.rule))
      .toEqual(["the font shorthand ends in var(--house-serif) or var(--house-sans)"]);
    expect(cssViolations(`.a { font: 300 48px/1 var(--house-serif); }`)).toEqual([]);
  });

  it("flags blur, filters and !important", () => {
    const rules = cssViolations(`.a { backdrop-filter: blur(8px); filter: brightness(1.1); color: var(--house-cream) !important; }`).map((hit) => hit.rule);
    expect(rules).toContain("no backdrop-filter: the shell forbids blur over the room");
    expect(rules).toContain("no CSS filter: the shell forbids it over the room");
    expect(rules).toContain("no !important");
  });

  it("flags colour typed by hand, in hex and in rgb(), but not a token's own alpha", () => {
    expect(cssViolations(`.a { color: #dca475; background: rgba(24, 38, 31, 0.95); }`)).toHaveLength(2);
    expect(cssViolations(`.a { background: rgb(var(--house-scrim-room) / 0.46); color: color-mix(in srgb, var(--house-cream) 7.5%, transparent); }`)).toEqual([]);
    // In scripts too, however the hex begins; an anchor is a word, not a colour.
    const script = scriptViolations(`const a = "#dca475"; const b = "#0e1712"; const c = "#main-content";`, "a.ts");
    expect(script.map((hit) => hit.text)).toEqual(["#dca475", "#0e1712"]);
  });

  it("reads selectors as selectors, so a hover is not a declaration", () => {
    expect(cssViolations(`.a:hover, .a:focus-visible { color: var(--house-cream); border-radius: var(--house-radius-surface) var(--house-radius-surface) 0 0; }`)).toEqual([]);
  });

  it("ignores what a comment says", () => {
    expect(cssViolations(`/* was #dca475 with filter: blur(4px) !important */ .a { color: var(--house-cream); }`)).toEqual([]);
    expect(scriptViolations(`// Laser was the old name; Showcase too\nexport const a = 1;`, "a.ts")).toEqual([]);
  });

  it("flags inline style and SVG blur in JSX", () => {
    const rules = scriptViolations(`export const A = () => <div style={{ color: "red" }}><svg><filter id="b" /></svg></div>;`, "A.tsx").map((hit) => hit.rule);
    expect(rules).toContain("no inline style in JSX (F-59): use a class, or write a per-frame value through a ref");
    expect(rules).toContain("no SVG filter or blur");
  });

  it("flags the retired and engineering words a person would read, and the cheerleading", () => {
    const sample = [
      `const a = "Auto-fill the room";`,
      `const b = <button>Laser</button>;`,
      `const c = \`Showcase\`;`,
      `const d = "Gaussian splats";`,
      `const e = "X (m)";`,
      `const f = "Planner Note";`,
      `const g = "Great job";`,
      `const h = "Almost there";`,
      `const i = "Got it";`,
    ].join("\n");
    const hits = scriptViolations(sample, "copy.tsx").filter((hit) => hit.rule.startsWith("copy:"));
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("reads venue words as venue words", () => {
    const venue = `const a = <p>Seat 10 more</p>; const b = "Send to the client"; const c = "1.4 m to Table 7"; const d = "#main-content";`;
    expect(scriptViolations(venue, "venue.tsx")).toEqual([]);
  });
});

describe("components/planner-chrome/ keeps the house rules", () => {
  it("has no rule broken in any stylesheet or script", async () => {
    const report: string[] = [];
    for (const [path, text] of await chromeSources()) {
      const hits = path.endsWith(".css") ? cssViolations(text) : scriptViolations(text, path);
      for (const hit of hits) report.push(`${path}:${String(hit.line)} ${hit.rule} — ${hit.text}`);
    }
    expect(report).toEqual([]);
  });
});
