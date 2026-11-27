import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// a11y-1: global.css's reduced-motion block was written (T-469, June 2026) to
// quiet the hover pop and press dip every button then carried. It reset
// `transform` with !important on every button and role=button, and that also
// beat the inline translateX the When ribbon's bar follows the pointer by,
// so under Reduce Motion the bar stood still while it was dragged. The house
// rule: reduced motion never stops a visual that follows the pointer.
// happy-dom applies no stylesheet, so this reads the rules the browser will
// and asks the DOM which elements their selectors match.
// ---------------------------------------------------------------------------

let reduced = "";

beforeAll(async () => {
  const css = await readFile(resolve("src/global.css"), "utf8");
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThanOrEqual(0);
  // The block runs to the brace that closes the one it opens.
  let depth = 0;
  let end = start;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) { end = index; break; }
  }
  reduced = css.slice(css.indexOf("{", start) + 1, end);
});

/** A selector list's own selectors: commas inside :is(), :where() or :not() do not split it. */
function topLevelSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** Every selector, in the reduced-motion block, of a rule whose declarations match `body`. */
function selectorsWhere(body: RegExp): string[] {
  return [...reduced.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, , declarations = ""]) => body.test(declarations))
    .flatMap(([, selector = ""]) => topLevelSelectors(selector.replace(/\/\*[\s\S]*?\*\//gu, "")));
}

const TRANSFORM_RESET = /(?:^|[\s;])transform:\s*none\s*!important/u;

/** Whether any reduced-motion rule that resets transform would reach this element. */
function transformResetReaches(element: Element): boolean {
  return selectorsWhere(TRANSFORM_RESET).some((selector) => element.matches(selector));
}

function control(tag: "button" | "div", style: (declarations: CSSStyleDeclaration) => void = () => undefined): HTMLElement {
  const element = document.createElement(tag);
  if (tag === "div") element.setAttribute("role", "button");
  style(element.style);
  document.body.append(element);
  return element;
}

describe("global.css under Reduce Motion", () => {
  it("still stops the hover and press transforms of buttons and role=button controls", () => {
    expect(transformResetReaches(control("button"))).toBe(true);
    expect(transformResetReaches(control("div"))).toBe(true);
    // Other inline styles are no exemption: only a transform of its own is.
    expect(transformResetReaches(control("button", (style) => { style.textTransform = "uppercase"; style.willChange = "transform"; }))).toBe(true);
    expect(transformResetReaches(control("div", (style) => { style.transition = "transform 160ms ease"; style.transformOrigin = "left"; }))).toBe(true);
  });

  it("leaves a transform the control's own script set, as the When ribbon's bar follows the pointer by", () => {
    // As WhenRibbon sets it mid-drag: left and width from the booking, the
    // pointer's offset as an inline translateX.
    const ingot = control("div", (style) => { style.left = "120px"; style.width = "240px"; style.transform = "translateX(36px)"; });
    expect(ingot.getAttribute("style")).toBe("left: 120px; width: 240px; transform: translateX(36px);");
    expect(transformResetReaches(ingot)).toBe(false);
    expect(transformResetReaches(control("button", (style) => { style.transform = "translateX(-12px)"; }))).toBe(false);
  });

  it("still stops filters and transitions on every button and role=button control", () => {
    const filterReset = selectorsWhere(/filter:\s*none\s*!important/u);
    expect(filterReset).toEqual(expect.arrayContaining(["button", '[role="button"]']));
    const transitionReset = selectorsWhere(/transition-property:\s*none\s*!important/u);
    expect(transitionReset).toEqual(expect.arrayContaining(["*", "button", '[role="button"]']));
  });
});
