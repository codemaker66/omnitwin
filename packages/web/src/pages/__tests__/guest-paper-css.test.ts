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

/** Every size in px in a value: `14px`, or both ends of `clamp(18px, 1.9vw, 24px)`. */
function pxIn(value: string): readonly number[] {
  return [...value.matchAll(/(\d+(?:\.\d+)?)px/gu)].map((match) => Number(match[1]));
}

const A4 = { width: 210, height: 297 } as const;

const printBlocks = atBlocks("@media print");
const printBlock = printBlocks.join("\n");
const print = printBlocks.flatMap(rules);
/** Every rule outside the print blocks: what the screen shows. */
const screen = rules(printBlocks.reduce((rest, body) => rest.replace(body, ""), CSS));

describe("the paper page's stylesheet: the notices region", () => {
  it("stays in the page while empty, so a notice that arrives in it is announced, out of the tools' flow", () => {
    const notices = screen.filter((rule) => rule.selectors.some((selector) => selector.startsWith(".gp-tools__notices")));
    expect(notices.length).toBeGreaterThan(0);
    for (const rule of notices) expect(hides(rule)).toBe(false);
    const empty = cascaded(screen, ".gp-tools__notices:empty");
    // Out of flow, so the tools' gap does not open round it; visually hidden, yet in the accessibility tree.
    expect(empty.get("position")).toBe("absolute");
    expect(empty.get("width")).toBe("1px");
    expect(empty.get("height")).toBe("1px");
    expect(empty.get("overflow")).toBe("hidden");
    expect(empty.get("clip-path")).toBe("inset(50%)");
  });
});

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

  it("hides nothing on paper but the screen's tools, its decoration and the foot the repeated footer replaces", () => {
    const hidden = print.filter(hides).flatMap((rule) => rule.selectors);
    expect(hidden.sort()).toEqual([".gp-foot", ".gp-tools", ".gp::before"]);
  });

  it("repeats the version footer on every printed page of the three list sheets, with room kept for it", () => {
    // The frame is a real <table> (the page test checks the elements): its
    // <tfoot> (.gp-running) is what the browser repeats at the foot of every
    // printed page and lays out in the flow, so it never covers a name.
    // On screen the table and its parts are plain blocks and the footer is
    // hidden: the sheet shows its single foot.
    for (const part of [".gp-frame", ".gp-frame__body", ".gp-frame__row", ".gp-frame__cell"]) {
      const onScreen = cascaded(screen, part);
      expect(onScreen.get("display"), `${part} on screen`).toBe("block");
      expect(onScreen.get("padding"), `${part} on screen`).toBe("0");
      expect(onScreen.get("border"), `${part} on screen`).toBe("0");
    }
    expect(cascaded(screen, ".gp-running").get("display")).toBe("none");
    // On paper the table's own displays come back, the footer group with them.
    const frame = cascaded(print, ".gp-frame");
    expect(frame.get("display")).toBe("table");
    expect(frame.get("width")).toBe("100%");
    expect(frame.get("table-layout")).toBe("fixed");
    expect(cascaded(print, ".gp-frame__body").get("display")).toBe("table-row-group");
    expect(cascaded(print, ".gp-frame__row").get("display")).toBe("table-row");
    expect(cascaded(print, ".gp-frame__cell").get("display")).toBe("table-cell");
    expect(cascaded(print, ".gp-running").get("display")).toBe("table-footer-group");
    // Only a sheet's frame repeats it: the place cards, cut apart, carry no version line on paper.
    const runningSelectors = print.flatMap((rule) => rule.selectors).filter((selector) => selector.includes("gp-running"));
    expect(runningSelectors.length).toBeGreaterThan(0);
    for (const selector of runningSelectors) expect(selector).not.toMatch(/gp-card/u);
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
    expect(cascaded(print, ".gp-card").get("break-inside")).toBe("avoid");
    // Two columns of 90 mm fit across A4 inside the sheet's 14 mm side margins.
    expect(2 * mm(cascaded(print, "@page").get("margin")) + 2 * 90).toBeLessThanOrEqual(A4.width);
    // The cards' own page margins come from the page while it shows them (see
    // the page test), not from a named page, which some browsers ignore.
    expect(CSS).not.toMatch(/@page\s+[\w-]+/u);
    expect(CSS).not.toMatch(/(?:^|[;{\s])page\s*:/u);
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

  it("sets the paper's notes in ink, never in copper: copper marks a state with a dot and carries no text", () => {
    // Copper text on the sheet is 5.5:1 and on paper-white 6.1:1, under the client bar of 7:1.
    expect(cascaded(screen, ".gp-tools__gap").get("color")).toBe("var(--reg-text-1)");
    expect(cascaded(screen, ".gp-az__letter").get("color")).toBe("var(--reg-text-1)");
    expect(cascaded(screen, ".gp-tools__gap::before").get("background")).toBe("var(--house-copper-dot)");
    for (const rule of [...screen, ...print]) {
      const color = rule.declarations.get("color") ?? "";
      expect(color, `${rule.selectors.join(", ")} sets text in copper`).not.toMatch(/--reg-attention|--house-copper/u);
    }
  });

  it("sets the names at a size a guest can read at the door", () => {
    expect(pt(cascaded(print, ".gp-az").get("font-size"))).toBeGreaterThanOrEqual(12);
    expect(pt(cascaded(print, ".gp-table__seats li").get("font-size"))).toBeGreaterThanOrEqual(11);
    expect(pt(cascaded(print, ".gp-card__name").get("font-size"))).toBeGreaterThanOrEqual(18);
  });

  it("sets every name and fact at 14 px or more on screen and 10.5 pt or more on paper", () => {
    // The names and facts a reader takes from the page, each with a size of its
    // own. The version is the sheet's foot on screen and the repeated footer on paper.
    const namesAndFacts = [
      ".gp-eyebrow", ".gp-az", ".gp-az__letter", ".gp-table__head", ".gp-table__name", ".gp-table__seats li",
      ".gp-card__name", ".gp-card__table", ".gp-covers", ".gp-covers__note",
    ];
    for (const selector of [...namesAndFacts, ".gp-running__line"]) {
      expect(pt(cascaded(print, selector).get("font-size")), `${selector} on paper`).toBeGreaterThanOrEqual(10.5);
    }
    for (const selector of [...namesAndFacts, ".gp-foot"]) {
      const declared = cascaded(screen, selector);
      const size = declared.get("font-size") ?? declared.get("font") ?? "";
      expect(pxIn(size).length, `${selector} on screen`).toBeGreaterThan(0);
      for (const px of pxIn(size)) expect(px, `${selector} on screen`).toBeGreaterThanOrEqual(14);
    }
    // And no size set anywhere falls under the floor: the screen in px, paper in pt.
    const screenSizes = screen.flatMap((rule) => [...rule.declarations].filter(([property]) => property === "font-size" || property === "font"));
    for (const [, size] of screenSizes) for (const px of pxIn(size)) expect(px).toBeGreaterThanOrEqual(14);
    const paperSizes = print.flatMap((rule) => [...rule.declarations].filter(([property]) => property === "font-size"));
    expect(paperSizes.length).toBeGreaterThan(5);
    for (const [, size] of paperSizes) expect(pt(size)).toBeGreaterThanOrEqual(10.5);
  });
});
