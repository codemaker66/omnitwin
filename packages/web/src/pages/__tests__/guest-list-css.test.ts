import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Where the guest list page draws its keyboard focus, read from the stylesheet
// itself: happy-dom applies no stylesheet, so a page test cannot see a ring.
// The house accessibility audit reads the ring on the focused control itself,
// so the ring must be drawn by that control, and a person must still see the
// one ring they saw before: round the whole count tile, and round the date
// field at each of its stops.
// ---------------------------------------------------------------------------

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

const CSS = readFileSync(resolve("src/pages/GuestListPage.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
/** The page's own ring for every control it holds. */
const SHARED_RING = ".gl :is(button, input, select, textarea, a):focus-visible";

/** Where the braces that open at `open` close. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced braces in GuestListPage.css");
}

/** A selector list split at its top-level commas, so ":is(a, b)" stays whole. */
function selectorList(text: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (text[index] === "," && depth === 0) {
      selectors.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(text.slice(start).trim());
  return selectors.filter((selector) => selector !== "");
}

function rules(body: string): Rule[] {
  const found: Rule[] = [];
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const declarations = new Map<string, string>();
    for (const declaration of (match[2] ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    found.push({ selectors: selectorList(match[1] ?? ""), declarations });
  }
  return found;
}

/** The stylesheet with its @-blocks taken out, and each @-block's body by its prelude. */
function split(css: string): { readonly top: string; readonly blocks: ReadonlyMap<string, string> } {
  let top = "";
  const blocks = new Map<string, string>();
  let from = 0;
  for (let at = css.indexOf("@", from); at !== -1; at = css.indexOf("@", from)) {
    const open = css.indexOf("{", at);
    const close = closing(css, open);
    top += css.slice(from, at);
    blocks.set(css.slice(at, open).trim(), css.slice(open + 1, close));
    from = close + 1;
  }
  return { top: top + css.slice(from), blocks };
}

const SHEET = split(CSS);
const TOP = rules(SHEET.top);

function narrow(): Rule[] {
  const body = SHEET.blocks.get("@media (max-width: 900px)");
  if (body === undefined) throw new Error("GuestListPage.css has no 900px block");
  return rules(body);
}

/** The declarations rules matching `applies` end with, later rules winning. */
function cascaded(block: readonly Rule[], applies: (selector: string) => boolean): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const rule of block) {
    if (!rule.selectors.some(applies)) continue;
    for (const [property, value] of rule.declarations) merged.set(property, value);
  }
  return merged;
}

function exactly(selector: string): (candidate: string) => boolean {
  return (candidate) => candidate === selector;
}

describe("GuestListPage.css: the notices region", () => {
  it("stays in the page while empty, so a notice that arrives in it is announced, and takes no space then", () => {
    const notices = [...TOP, ...narrow()].filter((rule) => rule.selectors.some((selector) => selector.startsWith(".gl-notices")));
    expect(notices.length).toBeGreaterThan(0);
    for (const rule of notices) {
      expect(rule.declarations.get("display") ?? "").not.toMatch(/^none/u);
      expect(rule.declarations.get("visibility") ?? "").not.toMatch(/^hidden/u);
    }
    expect(cascaded(TOP, exactly(".gl-notices:empty")).get("margin-top")).toBe("0");
  });

  it("keeps a refused move's status region in the Moving group while empty, out of the group's flow", () => {
    const refusal = [...TOP, ...narrow()].filter((rule) => rule.selectors.some((selector) => selector.startsWith(".gl-moving__refusal")));
    for (const rule of refusal) {
      expect(rule.declarations.get("display") ?? "").not.toMatch(/^none/u);
      expect(rule.declarations.get("visibility") ?? "").not.toMatch(/^hidden/u);
    }
    // Visually hidden and out of the grid, so the group's gap does not open round it; still in the accessibility tree.
    const empty = cascaded(TOP, exactly(".gl-moving__refusal:empty"));
    expect([empty.get("position"), empty.get("width"), empty.get("height"), empty.get("overflow"), empty.get("clip-path")])
      .toEqual(["absolute", "1px", "1px", "hidden", "inset(50%)"]);
  });
});

describe("GuestListPage.css: the ledger at a laptop's window", () => {
  it("is never taller than the window less a margin, and hands the wheel on to the page at either end", () => {
    // The journey's wheel case shows it at 1366 x 641, 1536 x 704 and 1920 x 953; this keeps the rule that does it.
    const ledger = cascaded(TOP, exactly(".gl-ledger"));
    expect(ledger.get("overflow")).toBe("auto");
    // Its rows' screen-reader text (position: absolute) is placed against the ledger, not the page.
    expect(ledger.get("position")).toBe("relative");
    expect(ledger.get("max-height")).toBe("calc(100dvh - 48px)");
    expect(ledger.get("min-height")).toBe("min(440px, calc(100dvh - 48px))");
    const containing = [...TOP, ...narrow()]
      .filter((rule) => rule.selectors.some((selector) => selector.startsWith(".gl-ledger")))
      .flatMap((rule) => [...rule.declarations].filter(([property]) => property.startsWith("overscroll-behavior")));
    expect(containing).toEqual([]);
    // Under 900px the ledger keeps the bounds it had.
    const phone = cascaded(narrow(), exactly(".gl-ledger"));
    expect([phone.get("flex"), phone.get("min-height"), phone.get("max-height")]).toEqual(["none", "0", "70vh"]);
  });
});

describe("GuestListPage.css: keyboard focus", () => {
  it("draws the house ring on a focused count button itself, and on nothing else for it", () => {
    const ring = cascaded(TOP, (selector) => selector === SHARED_RING || /\.gl-count__button:focus-visible$/u.test(selector));
    expect(ring.get("outline")).toBe("var(--vv-focus-ring)");
    expect(ring.get("outline-offset")).toBe("2px");
    const elsewhere = [...TOP, ...narrow()].flatMap((rule) => rule.selectors).filter((selector) => selector.includes(":has(.gl-count__button:focus"));
    expect(elsewhere).toEqual([]);
  });

  it("lays the count button over its whole tile, the tile's left edge included, so its ring is the tile's ring", () => {
    const button = cascaded(TOP, exactly(".gl-count__button"));
    expect(button.get("position")).toBe("absolute");
    expect(button.get("inset")).toBe("0");
    // A tile with a 1px left edge has its button reach over that edge; a tile without one does not.
    expect(cascaded(TOP, exactly(".gl-count")).get("border-left")).toMatch(/^1px solid /u);
    expect(cascaded(TOP, exactly(".gl-count:first-child")).get("border-left")).toBe("0");
    expect(cascaded(TOP, exactly(".gl-count:not(:first-child) > dd > .gl-count__button")).get("left")).toBe("-1px");
    expect(cascaded(narrow(), exactly(".gl-count:nth-child(3)")).get("border-left")).toBe("0");
    expect(cascaded(narrow(), exactly(".gl-count:nth-child(3) > dd > .gl-count__button")).get("left")).toBe("0");
    // The number keeps the 44px it had as the button, so the tile, and the button over it, keep their height.
    expect(cascaded(TOP, exactly(".gl-count__value")).get("min-height")).toBe("44px");
  });

  it("keeps the house ring on the date field while any part of it has focus, its calendar icon included", () => {
    // Chromium measured (Task 12's probe): with the calendar icon focused, the field is the active element but
    // matches neither :focus nor :focus-visible, so only :focus-within reaches it there.
    const within = cascaded(TOP, exactly(".gl .gl-date__input:focus-within"));
    expect(within.get("outline")).toBe("var(--vv-focus-ring)");
    expect(within.get("outline-offset")).toBe("2px");
  });
});
