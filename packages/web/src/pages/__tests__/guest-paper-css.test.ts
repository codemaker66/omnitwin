import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// What the paper page's stylesheet promises on paper, read from the
// stylesheet itself: happy-dom lays nothing out and prints nothing, so a page
// test can show an element is there but not that a rule keeps it whole on an
// A4 page. Read as day-board-css.test.ts reads the Day Board's.
// ---------------------------------------------------------------------------

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

const CSS = readFileSync(resolve("src/pages/GuestPaperPage.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");

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
  throw new Error("Unbalanced braces in GuestPaperPage.css");
}

/** The body of every top-level block whose prelude is `prelude`. */
function atBlocks(prelude: string): readonly string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(prelude, from);
    if (at === -1) return bodies;
    const open = CSS.indexOf("{", at);
    bodies.push(braced(CSS, open));
    from = open + 1;
  }
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
    found.push({ selectors: (match[1] ?? "").split(",").map((selector) => selector.trim()).filter((selector) => selector !== ""), declarations });
  }
  return found;
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

function hides(rule: Rule): boolean {
  return rule.declarations.get("display")?.startsWith("none") === true
    || rule.declarations.get("visibility")?.startsWith("hidden") === true;
}

/** Millimetres in a length written in mm. */
function mm(value: string | undefined): number {
  const match = /^([0-9.]+)mm$/u.exec(value ?? "");
  if (match === null) throw new Error(`Not a length in mm: ${String(value)}`);
  return Number(match[1]);
}

/** Points in a font size written in pt. */
function pt(value: string | undefined): number {
  const match = /^([0-9.]+)pt$/u.exec(value ?? "");
  if (match === null) throw new Error(`Not a size in pt: ${String(value)}`);
  return Number(match[1]);
}

const A4 = { width: 210, height: 297 } as const;

const printBlocks = atBlocks("@media print");
const printBlock = printBlocks.join("\n");
const print = printBlocks.flatMap(rules);
/** Every rule outside the print blocks: what the screen shows. */
const screen = rules(printBlocks.reduce((rest, body) => rest.replace(body, ""), CSS));

describe("the paper page's stylesheet, on paper", () => {
  it("on paper the tools are hidden, the ground is white and a card never splits across pages", () => {
    expect(printBlock).toMatch(/\.gp-tools\s*\{[^}]*display:\s*none/);
    expect(printBlock).toMatch(/break-inside:\s*avoid/);
    expect(cascaded(print, ".gp").get("background")).toBe("#ffffff");
    // The body's ivory is overridden on this page only.
    expect(cascaded(print, "body:has(.gp)").get("background")).toBe("#ffffff !important");
    expect(cascaded(print, "html:has(.gp)").get("background")).toBe("#ffffff !important");
    expect(cascaded(print, ".gp-card").get("break-inside")).toBe("avoid");
  });

  it("hides nothing on paper but the screen's tools and its decoration", () => {
    const hidden = print.filter(hides).flatMap((rule) => rule.selectors);
    expect(hidden.sort()).toEqual([".gp-tools", ".gp::before"]);
  });

  it("prints on A4 with 14 mm margins, in near-black ink", () => {
    const page = cascaded(print, "@page");
    expect(page.get("size")).toBe("A4");
    expect(page.get("margin")).toBe("14mm");
    expect(cascaded(print, ".gp *").get("color")).toBe("#111111 !important");
    expect(cascaded(print, ".gp").get("color")).toBe("#111111 !important");
  });

  it("keeps a letter's heading with its first name, each name whole and each table's block whole", () => {
    expect(cascaded(print, ".gp-az__lead").get("break-inside")).toBe("avoid");
    expect(cascaded(print, ".gp-az__entry").get("break-inside")).toBe("avoid");
    expect(cascaded(print, ".gp-table").get("break-inside")).toBe("avoid");
  });

  it("puts ten cards of 90 by 55 mm on each A4 page, two columns of five, a new page after each tenth", () => {
    const card = cascaded(print, ".gp-card");
    expect(mm(card.get("width"))).toBe(90);
    expect(mm(card.get("height"))).toBe(55);
    const cardsPage = cascaded(print, ".gp-cards-page");
    expect(cardsPage.get("grid-template-columns")).toBe("90mm 90mm");
    expect(cardsPage.get("grid-auto-rows")).toBe("55mm");
    expect(cascaded(print, ".gp-cards-page:not(:last-child)").get("break-after")).toBe("page");
    // The cards and their foot share one named page, whose margins leave room for five rows.
    expect(cascaded(print, ".gp-cards-sheet").get("page")).toBe("gp-cards");
    const named = cascaded(print, "@page gp-cards");
    expect(named.get("size")).toBe("A4");
    const [vertical, horizontal] = (named.get("margin") ?? "").split(/\s+/u).map((part) => mm(part));
    expect(2 * (vertical ?? A4.height) + 5 * 55).toBeLessThanOrEqual(A4.height);
    expect(2 * (horizontal ?? A4.width) + 2 * 90).toBeLessThanOrEqual(A4.width);
  });

  it("draws a card's cut marks on paper only, in ink, at its four corners", () => {
    expect(cascaded(screen, ".gp-cut").get("display")).toBe("none");
    expect(cascaded(print, ".gp-cut").get("display")).toBe("block");
    const corners = [".gp-card::before", ".gp-card::after", ".gp-cut::before", ".gp-cut::after"];
    for (const corner of corners) {
      const mark = cascaded(print, corner);
      expect(mark.get("content")).toBe("\"\"");
      expect(mark.get("border-color")).toBe("#111111");
    }
  });

  it("sets the names at a size a guest can read at the door, and nothing under the house floor", () => {
    expect(pt(cascaded(print, ".gp-az").get("font-size"))).toBeGreaterThanOrEqual(12);
    expect(pt(cascaded(print, ".gp-table__seats li").get("font-size"))).toBeGreaterThanOrEqual(11);
    expect(pt(cascaded(print, ".gp-card__name").get("font-size"))).toBeGreaterThanOrEqual(18);
    // 11 px is 8.25 pt: every size set on paper stays above it.
    const sizes = print.flatMap((rule) => [...rule.declarations].filter(([property]) => property === "font-size"));
    expect(sizes.length).toBeGreaterThan(5);
    for (const [, size] of sizes) expect(pt(size)).toBeGreaterThan(8.25);
  });
});
