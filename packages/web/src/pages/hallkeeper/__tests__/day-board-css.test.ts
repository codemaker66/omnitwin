import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// What the Day Board's stylesheet promises the floor, read from the
// stylesheet itself: jsdom lays nothing out, so a page test can show an
// element is there but not that a rule keeps it in view or on paper.
//   - On a phone this hallkeeper's next action stays at the top while the
//     rooms scroll under it (D7).
//   - "Print today" prints every room and every slot in words: paper hides
//     the screen's chrome, never a room, a slot or what it says.
// ---------------------------------------------------------------------------

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

const CSS = readFileSync(resolve("src/pages/hallkeeper/day-board.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

/** The text inside the braces that open at `open`, braces balanced. */
function braced(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  throw new Error("Unbalanced braces in day-board.css");
}

/** The body of every block whose prelude matches `prelude`, a pattern that
 *  allows any whitespace: "@media (max-width:760px)" is the same block. */
function atBlocks(prelude: RegExp): readonly string[] {
  return [...CSS.matchAll(new RegExp(prelude.source, "gu"))]
    .map((match) => braced(CSS, CSS.indexOf("{", match.index)));
}

/** The plain rules in a block: "a, b { x: y; }". */
function rules(body: string): readonly Rule[] {
  const found: Rule[] = [];
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const declarations = new Map<string, string>();
    for (const declaration of (match[2] ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    // A selector's whitespace collapsed, so a selector split over lines is
    // the selector a test names.
    found.push({ selectors: (match[1] ?? "").split(",").map((selector) => selector.trim().replaceAll(/\s+/gu, " ")).filter((selector) => selector !== ""), declarations });
  }
  return found;
}

/** Every rule in the sheet, inside a media block or not. */
const SHEET: readonly Rule[] = rules(CSS);

/** What an element selector hides: the last class of its last compound, or
 *  the whole selector when that compound names no class (`> *`, a tag, an
 *  attribute), so no hiding rule can slip past the lists below unnamed. */
function hiddenTarget(selector: string): string {
  const compound = selector.split(/\s+|>|\+|~/u).filter((part) => part !== "").pop() ?? "";
  const classes = [...compound.matchAll(/\.([\w-]+)/gu)].map((match) => match[1] ?? "");
  return classes.pop() ?? selector;
}

/** The declarations a selector ends with in a block, later rules winning. */
function cascaded(block: readonly Rule[], selector: string): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const rule of block) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations) merged.set(property, value);
  }
  return merged;
}

/** A declared value as the cascade compares it: no !important, lower case. */
function plain(value: string | undefined): string {
  return (value ?? "").replace(/!\s*important\s*$/iu, "").trim().toLowerCase();
}

/** Nothing: 0, 0px, .0em, 0%. */
function zero(value: string | undefined): boolean {
  return /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?$/u.test(plain(value));
}

/** A colour with nothing to see: transparent, or any colour whose alpha is
 *  nothing (#0000, #ffffff00, rgba(0, 0, 0, 0), rgb(0 0 0 / 0)). */
function transparent(value: string | undefined): boolean {
  const colour = plain(value);
  if (colour === "transparent" || /^#(?:[\da-f]{3}0|[\da-f]{6}00)$/u.test(colour)) return true;
  const inside = /^[a-z-]+\((.*)\)$/u.exec(colour)?.[1];
  if (inside === undefined) return false;
  const commas = inside.split(",");
  const alpha = inside.includes("/") ? inside.split("/").pop() : commas.length === 4 ? commas.pop() : undefined;
  return alpha !== undefined && zero(alpha);
}

/** Whether a rule hides what `selector` selects, in any of the ways a sheet
 *  can: no box (display), no paint (visibility, opacity, a transparent
 *  colour or text fill), no glyphs (a zero font size), nothing rendered
 *  inside it (content-visibility), or a box with no height or width whose
 *  overflow is not visible (paper cannot scroll), set in this rule or in
 *  any other for the same selector. */
function hides(rule: Rule, selector: string): boolean {
  const value = (property: string): string => plain(rule.declarations.get(property));
  if (value("display") === "none" || value("visibility") === "hidden" || value("visibility") === "collapse") return true;
  if (zero(rule.declarations.get("opacity")) || zero(rule.declarations.get("font-size"))) return true;
  if (transparent(rule.declarations.get("color")) || transparent(rule.declarations.get("-webkit-text-fill-color"))) return true;
  if (value("content-visibility") === "hidden") return true;
  const overflow = cascaded(SHEET, selector);
  const clipped = (properties: readonly string[]): boolean =>
    properties.some((property) => /\b(?:hidden|clip|auto|scroll)\b/u.test(plain(overflow.get(property))));
  const flat = ["height", "max-height", "block-size", "max-block-size"].some((property) => zero(rule.declarations.get(property)));
  const narrow = ["width", "max-width", "inline-size", "max-inline-size"].some((property) => zero(rule.declarations.get(property)));
  return (flat && clipped(["overflow", "overflow-y", "overflow-block"]))
    || (narrow && clipped(["overflow", "overflow-x", "overflow-inline"]));
}

describe("the Day Board's stylesheet", () => {
  it("keeps this hallkeeper's next action at the top of a phone while the rooms scroll under it", () => {
    const phone = atBlocks(/@media\s*\(\s*max-width\s*:\s*760px\s*\)\s*\{/u).flatMap(rules);
    const sticky = cascaded(phone, ".dayboard[data-layout=\"phone\"] .dayboard-next");
    expect(sticky.get("position")).toBe("sticky");
    expect(sticky.get("top")).toBe("0");
    // Nothing elsewhere in the sheet takes it back (rules() reads every
    // rule, inside a media block or not).
    expect(rules(CSS).filter((rule) => rule.selectors.includes(".dayboard[data-layout=\"phone\"] .dayboard-next"))).toHaveLength(1);
  });

  it("sets a count's note in line with its label's words, not under the label's dot", () => {
    const px = (value: string | undefined): number => Number.parseFloat(value ?? "");
    const dot = cascaded(SHEET, ".dayboard-stage-dot").get("width");
    const gap = cascaded(SHEET, ".dayboard-stage > span").get("gap");
    expect(px(cascaded(SHEET, ".dayboard-stage-note").get("padding-left"))).toBe(px(dot) + px(gap));
  });

  it("gives the wall's height to its rooms, not to a note on counts that filter nothing", () => {
    expect(cascaded(rules(CSS), ".dayboard[data-register=\"wall\"] .dayboard-stage-note").get("display")).toBe("none");
  });

  it("prints every room and every slot in words, hiding only the screen's chrome", () => {
    const print = atBlocks(/@media\s+print\s*\{/u).flatMap(rules);
    const hidden = new Set(print
      .flatMap((rule) => rule.selectors.filter((selector) => hides(rule, selector)))
      // A pseudo-element is a decoration, not a word.
      .filter((selector) => !selector.includes("::"))
      .map(hiddenTarget));
    const operational = [
      "dayboard-rooms", "dayboard-room-item", "dayboard-room", "dayboard-room-main", "dayboard-room-head",
      "dayboard-room-name", "dayboard-room-count", "dayboard-slab", "dayboard-slab-head", "dayboard-slab-title",
      "dayboard-verb", "dayboard-verb-words", "dayboard-slab-time", "dayboard-slab-notes", "dayboard-gap-words",
      "dayboard-slab-why", "dayboard-slab-seen", "dayboard-line", "dayboard-line-items", "dayboard-line-label",
      "dayboard-free", "dayboard-summary", "dayboard-title", "dayboard-print-note", "dayboard-stale",
    ];
    expect(operational.filter((name) => hidden.has(name))).toEqual([]);
    // What paper does hide is the screen's own furniture.
    expect([...hidden].sort()).toEqual([
      "dayboard-announcer", "dayboard-bar", "dayboard-days", "dayboard-detail-frame", "dayboard-legend", "dayboard-next",
      "dayboard-panel", "dayboard-plane", "dayboard-print", "dayboard-rail", "dayboard-ring", "dayboard-room-field",
      "dayboard-room-photo", "dayboard-scale", "dayboard-status", "dayboard-tools", "dayboard-wall-foot",
    ]);
    // A room is never split across two pages, and the wall's rooms are not
    // held to one screen's height on paper.
    const item = print.find((rule) => rule.selectors.includes(".dayboard-room-item"));
    expect(item?.declarations.get("break-inside")).toBe("avoid");
    const wallItems = print.find((rule) => rule.selectors.includes(".dayboard[data-register=\"wall\"] .dayboard-room-item"));
    expect(wallItems?.declarations.get("display")).toBe("block");
    expect(wallItems?.declarations.get("overflow")).toBe("visible");
  });
});
